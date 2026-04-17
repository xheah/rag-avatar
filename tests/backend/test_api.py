"""
tests/backend/test_api.py
-------------------------
Layer 2 — FastAPI integration tests.

Uses httpx.AsyncClient with ASGITransport so no real server is started.
All downstream network calls (Groq, Cartesia, Deepgram) are mocked so
tests run offline without consuming API credits.

Test groups
  1. GET /                     — index HTML
  2. POST /api/chat            — synchronous chat endpoint
  3. POST /api/chat_stream     — SSE streaming endpoint
  4. POST /api/clear           — session reset
  5. Session state             — history accumulates and is isolated
"""

import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock


# ─────────────────────────────────────────────────────────────────────────────
# Shared mock builders
# ─────────────────────────────────────────────────────────────────────────────

def _sync_completion(content: str):
    choice = MagicMock()
    choice.message.content = content
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def _rag_llm_output():
    """Typical tagged output from the RAG LLM."""
    return "<thought>Analysing answer.</thought><speech>Score: 80%. Good effort. Next scenario.</speech>"


def _chat_llm_output():
    return "Welcome! Say 'Start Quiz' when ready."


def _retriever_results(n=2):
    return [
        {"id": f"doc_{i}", "document": f"Sales scenario {i}", "type": "scenario"}
        for i in range(n)
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers to collect SSE events from a streaming response
# ─────────────────────────────────────────────────────────────────────────────

async def _collect_sse_payloads(response) -> list[dict]:
    """
    Iterates lines from an httpx streaming response and returns a list of
    parsed JSON payloads for every `data: {...}` SSE line.
    """
    payloads = []
    async for line in response.aiter_lines():
        line = line.strip()
        if not line.startswith("data: "):
            continue
        body = line[6:].strip()
        if body in ("[DONE]", ""):
            continue
        try:
            payloads.append(json.loads(body))
        except json.JSONDecodeError:
            pass
    return payloads


# ─────────────────────────────────────────────────────────────────────────────
# Common patch context for all streaming tests:
#   - LLM returns a simple token sequence
#   - Retriever returns dummy docs
#   - Cartesia WebSocket is silently skipped (no CARTESIA_API_KEY)
# ─────────────────────────────────────────────────────────────────────────────

def _stream_patches():
    """
    Returns a list of patch objects that together mock the entire LLM + retriever
    pipeline for the /api/chat_stream endpoint.
    """
    token_chunks = ["<thought>ok</thought>", "<speech>", "Hello", " world", "</speech>"]

    async def _async_iter_chunks(chunks):
        for raw in chunks:
            chunk = MagicMock()
            chunk.choices[0].delta.content = raw
            yield chunk
        # sentinel
        end = MagicMock()
        end.choices[0].delta.content = None
        yield end

    mock_stream = MagicMock()
    mock_stream.__aiter__ = lambda s: _async_iter_chunks(token_chunks).__aiter__()

    async_llm_mock = AsyncMock(return_value=mock_stream)

    return [
        patch(
            "src.api.get_closest_matches",
            return_value=_retriever_results()
        ),
        patch(
            "src.llm.prompts.get_async_llm_client",
            return_value=MagicMock(
                chat=MagicMock(
                    completions=MagicMock(create=async_llm_mock)
                )
            )
        ),
        # Ensure CARTESIA_API_KEY is absent so the WS branch is skipped cleanly
        patch.dict("os.environ", {"CARTESIA_API_KEY": ""}, clear=False),
    ]


# ─────────────────────────────────────────────────────────────────────────────
# 1. GET /
# ─────────────────────────────────────────────────────────────────────────────

class TestIndexRoute:

    @pytest.mark.asyncio
    @patch("src.api.open", create=True)
    async def test_returns_200(self, mock_open, async_client):
        mock_open.return_value.__enter__.return_value.read.return_value = "<html></html>"
        resp = await async_client.get("/")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    @patch("src.api.open", create=True)
    async def test_returns_html_content_type(self, mock_open, async_client):
        mock_open.return_value.__enter__.return_value.read.return_value = "<html></html>"
        resp = await async_client.get("/")
        assert "text/html" in resp.headers["content-type"]


# ─────────────────────────────────────────────────────────────────────────────
# 2. POST /api/chat  (synchronous)
# ─────────────────────────────────────────────────────────────────────────────

class TestChatEndpoint:

    def _patch_sync_pipeline(self, route="RAG"):
        """Patches the entire sync pipeline: router, retriever, LLM."""
        return [
            patch("src.api.adaptive_router", return_value=route),
            patch("src.api.rewrite_query", return_value="rewritten query"),
            patch("src.api.get_closest_matches", return_value=_retriever_results()),
            patch(
                "src.api.generate_rag_response_v4",
                return_value=("Score: 80%. Good effort.", "My analysis.")
            ),
            patch(
                "src.api.generate_chat_response",
                return_value=_chat_llm_output()
            ),
        ]

    @pytest.mark.asyncio
    async def test_returns_200_status(self, async_client):
        with (
            patch("src.api.adaptive_router", return_value="CHAT"),
            patch("src.api.generate_chat_response", return_value="Hello!"),
        ):
            resp = await async_client.post(
                "/api/chat", json={"message": "Hello", "session_id": "test_200"}
            )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_chat_route_returns_expected_keys(self, async_client):
        with (
            patch("src.api.adaptive_router", return_value="CHAT"),
            patch("src.api.generate_chat_response", return_value="Hello!"),
        ):
            resp = await async_client.post(
                "/api/chat", json={"message": "Hi", "session_id": "test_keys"}
            )
        data = resp.json()
        assert "response" in data
        assert "route" in data

    @pytest.mark.asyncio
    async def test_rag_route_returns_expected_keys(self, async_client):
        with (
            patch("src.api.adaptive_router", return_value="RAG"),
            patch("src.api.rewrite_query", return_value="rewritten"),
            patch("src.api.get_closest_matches", return_value=_retriever_results()),
            patch("src.api.generate_rag_response_v4", return_value=("Answer.", "Thought.")),
        ):
            resp = await async_client.post(
                "/api/chat", json={"message": "I would cold call.", "session_id": "test_rag"}
            )
        data = resp.json()
        assert "response" in data
        assert "thoughts" in data
        assert "route" in data

    @pytest.mark.asyncio
    async def test_chat_route_value_is_chat(self, async_client):
        with (
            patch("src.api.adaptive_router", return_value="CHAT"),
            patch("src.api.generate_chat_response", return_value="Hi there!"),
        ):
            resp = await async_client.post(
                "/api/chat", json={"message": "Hello", "session_id": "test_route_val"}
            )
        assert resp.json()["route"] == "CHAT"

    @pytest.mark.asyncio
    async def test_rag_route_value_is_rag(self, async_client):
        with (
            patch("src.api.adaptive_router", return_value="RAG"),
            patch("src.api.rewrite_query", return_value="rewritten"),
            patch("src.api.get_closest_matches", return_value=[]),
            patch("src.api.generate_rag_response_v4", return_value=("Answer.", "Thought.")),
        ):
            resp = await async_client.post(
                "/api/chat", json={"message": "Start quiz", "session_id": "test_rag_val"}
            )
        assert resp.json()["route"] == "RAG"

    @pytest.mark.asyncio
    async def test_llm_exception_returns_error_key(self, async_client):
        with (
            patch("src.api.adaptive_router", return_value="RAG"),
            patch("src.api.rewrite_query", return_value="q"),
            patch("src.api.get_closest_matches", return_value=[]),
            patch("src.api.generate_rag_response_v4", side_effect=RuntimeError("LLM down")),
        ):
            resp = await async_client.post(
                "/api/chat", json={"message": "test", "session_id": "test_err"}
            )
        assert resp.status_code == 200  # endpoint catches and returns error dict
        assert "error" in resp.json()

    @pytest.mark.asyncio
    async def test_default_session_id_is_accepted(self, async_client):
        """Request without session_id should use the default value without crashing."""
        with (
            patch("src.api.adaptive_router", return_value="CHAT"),
            patch("src.api.generate_chat_response", return_value="Hello!"),
        ):
            resp = await async_client.post(
                "/api/chat", json={"message": "Hi"}
            )
        assert resp.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# 3. POST /api/chat_stream  (SSE)
# ─────────────────────────────────────────────────────────────────────────────

class TestChatStreamEndpoint:

    @pytest.mark.asyncio
    async def test_returns_200_status(self, async_client):
        with _stream_patches()[0], _stream_patches()[1], _stream_patches()[2]:
            resp = await async_client.post(
                "/api/chat_stream",
                json={"message": "Hello", "session_id": "test_stream_200"},
            )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_content_type_is_event_stream(self, async_client):
        with _stream_patches()[0], _stream_patches()[1], _stream_patches()[2]:
            resp = await async_client.post(
                "/api/chat_stream",
                json={"message": "Hello", "session_id": "test_stream_ct"},
            )
        assert "text/event-stream" in resp.headers["content-type"]

    @pytest.mark.asyncio
    async def test_stream_contains_chunk_events(self, async_client):
        patches = _stream_patches()
        with patches[0], patches[1], patches[2]:
            async with async_client.stream(
                "POST", "/api/chat_stream",
                json={"message": "Start quiz", "session_id": "test_stream_chunks"},
            ) as r:
                payloads = await _collect_sse_payloads(r)

        types = [p["type"] for p in payloads]
        assert "chunk" in types, f"Expected 'chunk' events but got: {types}"

    @pytest.mark.asyncio
    async def test_stream_ends_with_done_event(self, async_client):
        patches = _stream_patches()
        with patches[0], patches[1], patches[2]:
            async with async_client.stream(
                "POST", "/api/chat_stream",
                json={"message": "Start quiz", "session_id": "test_stream_done"},
            ) as r:
                payloads = await _collect_sse_payloads(r)

        assert payloads, "Stream yielded no events"
        assert payloads[-1]["type"] == "done", (
            f"Last event type was '{payloads[-1]['type']}', expected 'done'"
        )

    @pytest.mark.asyncio
    async def test_done_event_contains_server_metrics(self, async_client):
        patches = _stream_patches()
        with patches[0], patches[1], patches[2]:
            async with async_client.stream(
                "POST", "/api/chat_stream",
                json={"message": "Hello", "session_id": "test_stream_metrics"},
            ) as r:
                payloads = await _collect_sse_payloads(r)

        done_events = [p for p in payloads if p["type"] == "done"]
        assert done_events, "No 'done' event found"
        metrics = done_events[0].get("server_metrics", {})
        assert "t_first_token" in metrics
        assert "t_llm_done" in metrics

    @pytest.mark.asyncio
    async def test_chunk_events_have_content_key(self, async_client):
        patches = _stream_patches()
        with patches[0], patches[1], patches[2]:
            async with async_client.stream(
                "POST", "/api/chat_stream",
                json={"message": "Start quiz", "session_id": "test_stream_content"},
            ) as r:
                payloads = await _collect_sse_payloads(r)

        chunk_events = [p for p in payloads if p["type"] == "chunk"]
        assert chunk_events, "No 'chunk' events found"
        assert all("content" in p for p in chunk_events)

    @pytest.mark.asyncio
    async def test_first_event_type_is_chunk(self, async_client):
        """The first SSE event should be a text chunk, not an audio or done event."""
        patches = _stream_patches()
        with patches[0], patches[1], patches[2]:
            async with async_client.stream(
                "POST", "/api/chat_stream",
                json={"message": "Start quiz", "session_id": "test_stream_first"},
            ) as r:
                payloads = await _collect_sse_payloads(r)

        assert payloads[0]["type"] == "chunk"


# ─────────────────────────────────────────────────────────────────────────────
# 4. POST /api/clear
# ─────────────────────────────────────────────────────────────────────────────

class TestClearEndpoint:

    @pytest.mark.asyncio
    async def test_returns_200(self, async_client):
        resp = await async_client.post(
            "/api/clear", json={"message": "", "session_id": "test_clear_200"}
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_returns_cleared_status(self, async_client):
        resp = await async_client.post(
            "/api/clear", json={"message": "", "session_id": "test_clear_status"}
        )
        assert resp.json() == {"status": "cleared"}


# ─────────────────────────────────────────────────────────────────────────────
# 5. Session state
# ─────────────────────────────────────────────────────────────────────────────

class TestSessionState:

    @pytest.mark.asyncio
    async def test_clear_resets_session_history(self, async_client):
        """
        After /api/clear, the session history should be empty.
        We verify this by inspecting the sessions dict directly.
        """
        from src.api import sessions

        session_id = "test_session_clear"

        # Seed history artificially
        sessions[session_id] = "User: hello\nAvatar: hi\n"

        resp = await async_client.post(
            "/api/clear", json={"message": "", "session_id": session_id}
        )
        assert resp.status_code == 200
        assert sessions.get(session_id, None) == ""

    @pytest.mark.asyncio
    async def test_chat_accumulates_history(self, async_client):
        """Each /api/chat call should append to sessions[session_id]."""
        from src.api import sessions

        session_id = "test_session_accum"
        sessions.pop(session_id, None)  # start clean

        with (
            patch("src.api.adaptive_router", return_value="CHAT"),
            patch("src.api.generate_chat_response", return_value="Hi there!"),
        ):
            await async_client.post(
                "/api/chat", json={"message": "Hello", "session_id": session_id}
            )

        assert session_id in sessions
        assert "Hello" in sessions[session_id]
        assert "Hi there!" in sessions[session_id]

    @pytest.mark.asyncio
    async def test_different_sessions_are_isolated(self, async_client):
        """History for session A must not bleed into session B."""
        from src.api import sessions

        for sid in ("iso_session_a", "iso_session_b"):
            sessions.pop(sid, None)

        with (
            patch("src.api.adaptive_router", return_value="CHAT"),
            patch("src.api.generate_chat_response", return_value="Response A"),
        ):
            await async_client.post(
                "/api/chat", json={"message": "Message for A", "session_id": "iso_session_a"}
            )

        # Session B should have no knowledge of session A's messages
        history_b = sessions.get("iso_session_b", "")
        assert "Message for A" not in history_b
