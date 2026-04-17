"""
tests/backend/test_websocket.py
--------------------------------
Layer 4 — /ws/control WebSocket channel unit tests.

Uses Starlette's synchronous TestClient which fully supports WebSocket
testing without requiring a running server.  All tests are synchronous;
event-loop management is handled internally by TestClient.

Test coverage
  - Connection is accepted cleanly
  - barge_in message sets cancel_events[session_id]
  - Session A barge-in does NOT affect session B's cancel_event
  - Connecting creates a cancel_event entry for the session
  - Disconnect + reconnect succeeds without errors
  - Unknown message type does not crash the server
  - cancel_event is cleared at the start of each new chat_stream_generator
    call (Fix #2 regression guard — unit-level check)
"""

import asyncio
import json
import time

import pytest
from starlette.testclient import TestClient


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_app():
    """Import the FastAPI app (startup patches are already active via conftest)."""
    from src.api import app
    return app


def get_cancel_events():
    from src.api import cancel_events
    return cancel_events


# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestControlWebSocket:

    def test_connection_is_accepted(self):
        """Server must accept a WebSocket connection to /ws/control."""
        with TestClient(get_app()) as client:
            with client.websocket_connect("/ws/control?session_id=ws_accept"):
                pass   # connecting and disconnecting cleanly is enough

    # ── Event management ──────────────────────────────────────────────────────

    def test_connecting_creates_cancel_event_entry(self):
        """
        Opening a /ws/control connection must create an asyncio.Event entry
        in cancel_events keyed by session_id.
        """
        cancel_events = get_cancel_events()
        session_id = "ws_creates_event"
        cancel_events.pop(session_id, None)

        with TestClient(get_app()) as client:
            with client.websocket_connect(f"/ws/control?session_id={session_id}"):
                pass

        assert session_id in cancel_events, (
            f"cancel_events has no entry for {session_id!r} after connect"
        )

    def test_barge_in_sets_cancel_event(self):
        """
        Sending {'type': 'barge_in'} must call cancel_event.set() for the
        session, making cancel_events[session_id].is_set() return True.
        """
        cancel_events = get_cancel_events()
        session_id = "ws_barge_sets_event"
        cancel_events.pop(session_id, None)

        with TestClient(get_app()) as client:
            with client.websocket_connect(f"/ws/control?session_id={session_id}") as ws:
                ws.send_json({"type": "barge_in"})
                time.sleep(0.05)   # let the server coroutine schedule

        assert cancel_events[session_id].is_set(), (
            "cancel_event was not set after receiving a barge_in message"
        )

    def test_cancel_event_starts_unset(self):
        """
        A freshly created cancel_event (from connecting a new session) must
        not be set — it starts in the 'clear' state.
        """
        cancel_events = get_cancel_events()
        session_id = "ws_event_starts_clear"
        cancel_events.pop(session_id, None)

        with TestClient(get_app()) as client:
            with client.websocket_connect(f"/ws/control?session_id={session_id}"):
                # Do NOT send barge_in — just connect
                time.sleep(0.05)

        assert not cancel_events[session_id].is_set(), (
            "cancel_event was unexpectedly set without a barge_in message"
        )

    # ── Session isolation ──────────────────────────────────────────────────────

    def test_barge_in_on_session_a_does_not_affect_session_b(self):
        """
        Critical isolation check: barge_in for session A must only set
        cancel_events['A'], leaving cancel_events['B'] untouched.
        """
        cancel_events = get_cancel_events()
        session_a = "ws_iso_barge_a"
        session_b = "ws_iso_barge_b"
        for sid in (session_a, session_b):
            cancel_events.pop(sid, None)

        with TestClient(get_app()) as client:
            with client.websocket_connect(f"/ws/control?session_id={session_a}") as ws_a:
                with client.websocket_connect(f"/ws/control?session_id={session_b}"):
                    ws_a.send_json({"type": "barge_in"})
                    time.sleep(0.05)

        assert cancel_events.get(session_a) and cancel_events[session_a].is_set(), (
            "Session A cancel_event was not set"
        )
        b_event = cancel_events.get(session_b)
        assert b_event is None or not b_event.is_set(), (
            "Session B cancel_event was incorrectly set by session A's barge-in"
        )

    def test_multiple_sessions_each_get_own_event(self):
        """
        Connecting three distinct sessions must create three independent
        cancel_event entries.
        """
        cancel_events = get_cancel_events()
        sessions = ["ws_multi_a", "ws_multi_b", "ws_multi_c"]
        for s in sessions:
            cancel_events.pop(s, None)

        with TestClient(get_app()) as client:
            for s in sessions:
                with client.websocket_connect(f"/ws/control?session_id={s}"):
                    pass

        for s in sessions:
            assert s in cancel_events, f"cancel_events missing entry for {s!r}"
            assert not cancel_events[s].is_set(), (
                f"cancel_events[{s!r}] is unexpectedly set"
            )

    # ── Stability / edge cases ────────────────────────────────────────────────

    def test_disconnect_and_reconnect_succeeds(self):
        """
        Closing and then re-opening a connection for the same session_id
        must not raise, and subsequent messages must still be handled.
        """
        cancel_events = get_cancel_events()
        session_id = "ws_reconnect"
        cancel_events.pop(session_id, None)

        with TestClient(get_app()) as client:
            # First connection — open and close
            with client.websocket_connect(f"/ws/control?session_id={session_id}"):
                pass

            # Second connection — must work and accept barge_in
            with client.websocket_connect(f"/ws/control?session_id={session_id}") as ws:
                ws.send_json({"type": "barge_in"})
                time.sleep(0.05)

        assert cancel_events[session_id].is_set(), (
            "cancel_event not set after reconnect + barge_in"
        )

    def test_unknown_message_type_does_not_crash_server(self):
        """
        An unrecognised message type must be silently ignored.  The server
        should remain alive and still handle a subsequent barge_in correctly.
        """
        cancel_events = get_cancel_events()
        session_id = "ws_unknown_msg"
        cancel_events.pop(session_id, None)

        with TestClient(get_app()) as client:
            with client.websocket_connect(f"/ws/control?session_id={session_id}") as ws:
                ws.send_json({"type": "totally_unknown", "payload": "ignored"})
                time.sleep(0.05)
                # Server must still be alive — a barge_in must work
                ws.send_json({"type": "barge_in"})
                time.sleep(0.05)

        assert cancel_events[session_id].is_set(), (
            "Server crashed or ignored barge_in after an unknown message type"
        )

    def test_malformed_json_does_not_crash_server(self):
        """
        Sending raw text that is not valid JSON must not crash the WebSocket
        handler.  The connection should continue to work.
        """
        cancel_events = get_cancel_events()
        session_id = "ws_bad_json"
        cancel_events.pop(session_id, None)

        with TestClient(get_app()) as client:
            with client.websocket_connect(f"/ws/control?session_id={session_id}") as ws:
                ws.send_text("this is not json {{{{")
                time.sleep(0.05)
                # The server should swallow the JSON error and keep running
                ws.send_json({"type": "barge_in"})
                time.sleep(0.05)

        # If the server crashed, cancel_events[session_id] would be unset
        assert cancel_events[session_id].is_set(), (
            "Server did not recover after receiving malformed JSON"
        )

    # ── Fix #2 regression guard ───────────────────────────────────────────────

    @pytest.mark.asyncio
    async def test_chat_stream_generator_clears_cancel_event_at_start(self):
        """
        chat_stream_generator() must call cancel_event.clear() at the top of
        each invocation. This prevents a stale barge_in from a prior turn from
        immediately cancelling the NEW response (Fix #2).

        We verify this by pre-setting the cancel_event for a session and then
        starting the generator — after the first yield the event must be clear.
        """
        from src.api import cancel_events, chat_stream_generator

        session_id = "fix2_regression"

        # Pre-set the event as if a barge_in had fired in the previous turn
        cancel_events[session_id] = asyncio.Event()
        cancel_events[session_id].set()
        assert cancel_events[session_id].is_set()   # precondition

        # Drain until at least one event is yielded (generator has started)
        gen = chat_stream_generator("hello", session_id)
        try:
            await gen.__anext__()
        except StopAsyncIteration:
            pass
        finally:
            await gen.aclose()

        assert not cancel_events[session_id].is_set(), (
            "chat_stream_generator did not clear cancel_event at start — "
            "Fix #2 regression detected"
        )
