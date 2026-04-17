"""
tests/backend/test_barge_in.py
------------------------------
Layer 3 — Barge-in / SSE + WebSocket combo tests.

These tests require a *live* uvicorn server (provided by the `live_server_url`
fixture in conftest.py) because they must hold a WebSocket connection to
/ws/control while simultaneously consuming an SSE stream from /api/chat_stream.
ASGITransport does not support this concurrent multi-connection pattern.

All LLM and TTS (Cartesia) dependencies are replaced with fast in-process fakes
so the tests run offline, quickly, and without consuming API credits.

Test coverage
  - Control: audio chunks arrive when no barge-in is sent
  - Core:    audio stops after barge_in fires mid-stream
  - Clean close: stream always ends with a 'done' event
  - Metrics: done event contains server_metrics even after early termination
  - Recovery: the next request after a barge-in works normally (Fix #2)
  - Isolation: barge-in on session A does not affect concurrent session B
"""

import asyncio
import json

import httpx
import pytest
from websockets.asyncio.client import connect as ws_connect

_HOST = "127.0.0.1"
_PORT = 8988


# ─────────────────────────────────────────────────────────────────────────────
# SSE collection helper
# ─────────────────────────────────────────────────────────────────────────────

async def _collect_sse(
    response: httpx.Response,
    barge_in_fn=None,
    barge_in_after: int = 0,
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Drain an SSE response, optionally injecting a barge-in mid-stream.

    Args:
        response:       A streaming httpx response.
        barge_in_fn:    An async callable to invoke when triggering barge-in
                        (typically sends the WS message and sleeps briefly).
        barge_in_after: Number of audio_chunk events to observe before
                        calling barge_in_fn.  0 means never trigger.

    Returns:
        (all_payloads, audio_before, audio_after)
        - all_payloads:  every parsed SSE payload received
        - audio_before:  audio_chunk payloads *before* barge-in fired
        - audio_after:   audio_chunk payloads *after* barge-in fired
    """
    all_payloads: list[dict] = []
    audio_before: list[dict] = []
    audio_after:  list[dict] = []
    barge_in_fired = False

    async for line in response.aiter_lines():
        line = line.strip()
        if not line.startswith("data: "):
            continue
        body = line[6:].strip()
        if body in ("[DONE]", ""):
            continue
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            continue

        all_payloads.append(payload)

        if payload["type"] == "done":
            break

        if not barge_in_fired:
            if payload["type"] == "audio_chunk":
                audio_before.append(payload)
                if barge_in_fn and barge_in_after and len(audio_before) >= barge_in_after:
                    await barge_in_fn()
                    barge_in_fired = True
        else:
            if payload["type"] == "audio_chunk":
                audio_after.append(payload)

    return all_payloads, audio_before, audio_after


# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestBargeIn:

    # ── Control test ──────────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_control_audio_arrives_without_barge_in(self, live_server_url):
        """
        Baseline: without a barge-in the stream delivers audio_chunk events
        from the fake Cartesia connection.
        """
        async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
            async with client.stream(
                "POST", "/api/chat_stream",
                json={"message": "Start quiz", "session_id": "ctrl_no_barge"},
            ) as r:
                payloads, audio_before, audio_after = await _collect_sse(r)

        total_audio = audio_before + audio_after
        assert len(total_audio) > 0, (
            "Control test failed: no audio_chunk events received at all"
        )
        event_types = [p["type"] for p in payloads]
        assert "done" in event_types

    # ── Core barge-in test ────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_barge_in_stops_audio_chunks(self, live_server_url):
        """
        Core test: after a barge_in message is sent through /ws/control,
        significantly fewer audio_chunk events must arrive.

        The fake Cartesia emits 6 chunks at 50 ms intervals (~300 ms total).
        We trigger barge-in after 2 chunks.  Thanks to Fix #4 (server-side
        queue drain) and Fix #1/#3 (client guard + VAD trigger), at most
        1 extra chunk may arrive due to event-loop scheduling jitter.
        """
        session_id = "barge_stops_audio"
        ws_url = f"ws://{_HOST}:{_PORT}/ws/control?session_id={session_id}"

        async with ws_connect(ws_url) as ws:

            async def do_barge_in():
                await ws.send(json.dumps({"type": "barge_in"}))
                # Give the server event loop time to process the WS message
                # and set cancel_event before the SSE generator polls again.
                await asyncio.sleep(0.15)

            async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
                async with client.stream(
                    "POST", "/api/chat_stream",
                    json={"message": "Start quiz", "session_id": session_id},
                ) as r:
                    payloads, audio_before, audio_after = await _collect_sse(
                        r, barge_in_fn=do_barge_in, barge_in_after=2
                    )

        assert len(audio_before) >= 2, (
            "Barge-in was never triggered — stream ended before 2 audio chunks"
        )
        # Allow ≤ 1 chunk after barge-in to account for the event-loop race window
        assert len(audio_after) <= 1, (
            f"Expected ≤ 1 audio chunk after barge-in, got {len(audio_after)}"
        )
        # Total must be well below the 6 the mock would produce uninterrupted
        assert len(audio_before) + len(audio_after) < 6, (
            "All 6 chunks arrived despite barge-in — cancellation did not work"
        )

    # ── Clean termination ─────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_stream_ends_with_done_after_barge_in(self, live_server_url):
        """
        After a barge-in the SSE stream must still terminate with a 'done'
        event so the client can clean up state reliably.
        """
        session_id = "barge_clean_done"
        ws_url = f"ws://{_HOST}:{_PORT}/ws/control?session_id={session_id}"

        async with ws_connect(ws_url) as ws:

            async def do_barge_in():
                await ws.send(json.dumps({"type": "barge_in"}))

            async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
                async with client.stream(
                    "POST", "/api/chat_stream",
                    json={"message": "Start quiz", "session_id": session_id},
                ) as r:
                    payloads, _, _ = await _collect_sse(
                        r, barge_in_fn=do_barge_in, barge_in_after=1
                    )

        event_types = [p["type"] for p in payloads]
        assert "done" in event_types, (
            "Stream did not close with a 'done' event after barge-in"
        )
        assert event_types[-1] == "done", (
            f"Last event was '{event_types[-1]}', expected 'done'"
        )

    # ── Server metrics preserved ──────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_done_event_has_server_metrics_after_barge_in(self, live_server_url):
        """
        The 'done' event must include server_metrics regardless of whether the
        stream was interrupted by a barge-in.
        """
        session_id = "barge_metrics"
        ws_url = f"ws://{_HOST}:{_PORT}/ws/control?session_id={session_id}"

        async with ws_connect(ws_url) as ws:

            async def do_barge_in():
                await ws.send(json.dumps({"type": "barge_in"}))

            async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
                async with client.stream(
                    "POST", "/api/chat_stream",
                    json={"message": "Start quiz", "session_id": session_id},
                ) as r:
                    payloads, _, _ = await _collect_sse(
                        r, barge_in_fn=do_barge_in, barge_in_after=1
                    )

        done_events = [p for p in payloads if p["type"] == "done"]
        assert done_events, "No 'done' event found in payloads"
        metrics = done_events[0].get("server_metrics", {})
        assert "t_first_token" in metrics, "server_metrics missing t_first_token"
        assert "t_llm_done" in metrics, "server_metrics missing t_llm_done"

    # ── Recovery — Fix #2 regression guard ───────────────────────────────────

    @pytest.mark.asyncio
    async def test_next_request_succeeds_after_barge_in(self, live_server_url):
        """
        After a barge-in, the cancel_event must be cleared at the start of the
        next chat_stream_generator call so the new response is not prematurely
        cancelled.  This directly validates Fix #2.
        """
        session_id = "barge_then_recover"
        ws_url = f"ws://{_HOST}:{_PORT}/ws/control?session_id={session_id}"

        # First request — interrupt it
        async with ws_connect(ws_url) as ws:

            async def do_barge_in():
                await ws.send(json.dumps({"type": "barge_in"}))
                await asyncio.sleep(0.1)

            async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
                async with client.stream(
                    "POST", "/api/chat_stream",
                    json={"message": "First", "session_id": session_id},
                ) as r:
                    await _collect_sse(r, barge_in_fn=do_barge_in, barge_in_after=1)

        # Second request — must complete fully with audio
        async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
            async with client.stream(
                "POST", "/api/chat_stream",
                json={"message": "Second", "session_id": session_id},
            ) as r:
                payloads, audio_before, audio_after = await _collect_sse(r)

        event_types = [p["type"] for p in payloads]
        assert "done" in event_types, "Second request did not complete with 'done'"
        assert "chunk" in event_types, "Second request produced no text chunks"
        total_audio = len(audio_before) + len(audio_after)
        assert total_audio > 0, (
            "Second request produced no audio — cancel_event was not cleared "
            "(Fix #2 may be broken)"
        )

    # ── Session isolation ──────────────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_session_isolation(self, live_server_url):
        """
        A barge-in targeted at session A must not affect session B's
        concurrent stream.  Both sessions run in parallel; only A is
        interrupted.
        """
        session_a = "iso_barge_a"
        session_b = "iso_barge_b"
        ws_a_url = f"ws://{_HOST}:{_PORT}/ws/control?session_id={session_a}"

        results: dict[str, int] = {"a_audio": 0, "b_audio": 0}

        async def run_session_a():
            async with ws_connect(ws_a_url) as ws:

                async def do_barge_in():
                    await ws.send(json.dumps({"type": "barge_in"}))
                    await asyncio.sleep(0.1)

                async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
                    async with client.stream(
                        "POST", "/api/chat_stream",
                        json={"message": "Session A", "session_id": session_a},
                    ) as r:
                        _, before, after = await _collect_sse(
                            r, barge_in_fn=do_barge_in, barge_in_after=2
                        )
                        results["a_audio"] = len(before) + len(after)

        async def run_session_b():
            async with httpx.AsyncClient(base_url=live_server_url, timeout=20) as client:
                async with client.stream(
                    "POST", "/api/chat_stream",
                    json={"message": "Session B", "session_id": session_b},
                ) as r:
                    _, before, after = await _collect_sse(r)
                    results["b_audio"] = len(before) + len(after)

        await asyncio.gather(run_session_a(), run_session_b())

        assert results["b_audio"] > 0, (
            f"Session B received no audio (b_audio=0) — it may have been "
            f"incorrectly cancelled by session A's barge-in. "
            f"Session A audio count: {results['a_audio']}"
        )
