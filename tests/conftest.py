"""
tests/conftest.py
-----------------
Shared pytest fixtures and session-level patches for all test layers.

Session patches (active for the entire test run):
  - initialize_database  → no-op
  - get_embedding_model  → MagicMock

Additional patches applied only during the live-server fixture
(Layer 3 barge-in tests):
  - src.api.websockets.connect          → FakeCartesiaConnection
  - src.api.generate_rag_response_v4_stream → _fake_rag_stream
  - src.api.get_closest_matches         → returns []
  - CARTESIA_API_KEY env var            → "fake-key-for-tests"
"""

import asyncio
import base64
import json
import socket
import struct
import threading
import time
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport


# ─────────────────────────────────────────────────────────────────────────────
# Fake Cartesia WebSocket (used by the live-server fixture in Layer 3)
# ─────────────────────────────────────────────────────────────────────────────

_N_FAKE_CHUNKS = 6       # total audio chunks the fake Cartesia will emit
_CHUNK_DELAY   = 0.05    # seconds between each chunk


def _fake_pcm_b64(n_samples: int = 441) -> str:
    """10 ms of silence at 44100 Hz, float32-LE, base64-encoded."""
    return base64.b64encode(
        struct.pack(f"<{n_samples}f", *([0.0] * n_samples))
    ).decode()


class _FakeCartesiaConnection:
    """
    Simulates a Cartesia WebSocket connection.
    Emits _N_FAKE_CHUNKS audio-chunk messages (with a small delay between
    each), then a word_timestamps message and a done message.
    Stops early when close() is called (barge-in simulation).
    """

    def __init__(self) -> None:
        self.closed = False
        self._closed_event: asyncio.Event | None = None

    def _closed_evt(self) -> asyncio.Event:
        # Lazy-create so the Event binds to the server's event loop, not the
        # main test loop.
        if self._closed_event is None:
            self._closed_event = asyncio.Event()
        return self._closed_event

    async def send(self, _data: str) -> None:   # noqa: D102
        pass   # ignore outbound TTS requests from the server

    async def close(self) -> None:              # noqa: D102
        self.closed = True
        self._closed_evt().set()

    def __aiter__(self):
        return self._generate()

    async def _generate(self):
        evt = self._closed_evt()
        for _ in range(_N_FAKE_CHUNKS):
            if evt.is_set():
                return
            await asyncio.sleep(_CHUNK_DELAY)
            yield json.dumps(
                {"type": "chunk", "data": _fake_pcm_b64(), "context_id": "fake"}
            )
        if not evt.is_set():
            yield json.dumps({
                "type": "timestamps",
                "word_timestamps": {
                    "words": ["hello", "world"],
                    "start": [0.0, 0.2],
                    "end": [0.2, 0.4],
                },
            })
        if not evt.is_set():
            yield json.dumps({"type": "done"})


class _FakeConnectAwaitable:
    """
    Returned by fake_ws_connect().  Supports both usage patterns found in
    api.py:
      conn = await websockets.connect(url)          ← Cartesia path
      async with websockets.connect(url) as conn:   ← Deepgram path
    """

    def __init__(self, conn: _FakeCartesiaConnection) -> None:
        self._conn = conn

    def __await__(self):
        async def _ret() -> _FakeCartesiaConnection:
            return self._conn
        return _ret().__await__()

    async def __aenter__(self) -> _FakeCartesiaConnection:
        return self._conn

    async def __aexit__(self, *_) -> None:
        await self._conn.close()


def fake_ws_connect(url: str, **kwargs) -> _FakeConnectAwaitable:
    """Drop-in replacement for websockets.connect() used in Layer 3 tests."""
    return _FakeConnectAwaitable(_FakeCartesiaConnection())


# ─────────────────────────────────────────────────────────────────────────────
# Fake LLM stream (used by the live-server fixture in Layer 3)
# ─────────────────────────────────────────────────────────────────────────────

async def _fake_rag_stream(user_query, retrieved_documents, chat_history=""):
    """
    Replaces generate_rag_response_v4_stream for the live server.
    Immediately yields a minimal tagged response without any network calls.
    """
    for token in [
        "<thought>", "Analysing.", "</thought>",
        "<speech>", "Good effort. ", "Here is the next scenario.", "</speech>",
    ]:
        await asyncio.sleep(0)  # yield control to allow other tasks to run
        yield token


# ─────────────────────────────────────────────────────────────────────────────
# Session-level startup patches (Layer 1 & 2 — no live server required)
# ─────────────────────────────────────────────────────────────────────────────

_STARTUP_PATCHES = [
    patch("src.vectorstore.database_creation.initialize_database", return_value=None),
    patch("src.config.get_embedding_model", return_value=MagicMock()),
]


def pytest_configure(config):
    """Activate startup patches before any module import so tests never touch
    the real ChromaDB or load the SentenceTransformer model."""
    for p in _STARTUP_PATCHES:
        p.start()


def pytest_unconfigure(config):
    for p in _STARTUP_PATCHES:
        try:
            p.stop()
        except RuntimeError:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — FastAPI async client (no live server)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
async def async_client():
    """
    httpx.AsyncClient bound to the FastAPI app via ASGITransport.
    No real server is started; requests execute in-process.
    """
    from src.api import app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


# ─────────────────────────────────────────────────────────────────────────────
# Layer 3 — Live uvicorn server  (needed for concurrent SSE + WebSocket)
# ─────────────────────────────────────────────────────────────────────────────

_LIVE_HOST = "127.0.0.1"
_LIVE_PORT = 8988


def _wait_for_port(host: str, port: int, timeout: float = 10.0) -> None:
    """Block until the given TCP port accepts a connection."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"Server {host}:{port} did not become ready in {timeout}s")


@pytest.fixture(scope="session")
def live_server_url():
    """
    Starts a real uvicorn server in a background daemon thread.

    Additional patches applied for the duration of the live server:
      - CARTESIA_API_KEY env var set to a non-empty string so the TTS
        branch is entered.
      - websockets.connect → fake_ws_connect (FakeCartesiaConnection)
      - generate_rag_response_v4_stream → _fake_rag_stream
      - get_closest_matches → returns []

    These patches are active only for this fixture's lifetime and do NOT
    interfere with Layer 1 / Layer 2 tests, which use ASGITransport.
    """
    import uvicorn

    live_patches = [
        patch.dict("os.environ", {"CARTESIA_API_KEY": "fake-key-for-tests"}, clear=False),
        patch("src.api.websockets.connect", side_effect=fake_ws_connect),
        patch("src.api.generate_rag_response_v4_stream", new=_fake_rag_stream),
        patch("src.api.get_closest_matches", return_value=[]),
    ]
    for p in live_patches:
        p.start()

    from src.api import app  # imported after patches are active

    config = uvicorn.Config(
        app,
        host=_LIVE_HOST,
        port=_LIVE_PORT,
        log_level="error",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    _wait_for_port(_LIVE_HOST, _LIVE_PORT)

    yield f"http://{_LIVE_HOST}:{_LIVE_PORT}"

    server.should_exit = True
    thread.join(timeout=5)

    for p in live_patches:
        try:
            p.stop()
        except RuntimeError:
            pass
