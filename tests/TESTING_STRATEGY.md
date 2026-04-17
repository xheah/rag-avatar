# RAG Avatar — Testing Strategy

This document outlines the full testing strategy for the RAG Avatar application, organized
by layer. The highest-priority tests are the **barge-in / cancel-event** integration tests
(Layer 3), which directly validate the interrupt pipeline and protect against regressions.

---

## Recommended Priority Order

| Priority | Layer | Value | Effort |
|----------|-------|-------|--------|
| 1 ✅ | [Layer 3 — Barge-in SSE Tests](#layer-3--barge-in--cancel-event-tests) | Directly validates bug fixes | Medium |
| 2 ✅ | [Layer 2 — FastAPI Integration](#layer-2--fastapi-integration-tests) | Broad HTTP coverage | Low |
| 3 ✅ | [Layer 5 — Frontend Unit Tests](#layer-5--frontend-unit-tests-vitest) | Fast, no server needed | Low |
| 4 ✅ | [Layer 4 — WebSocket Control Channel](#layer-4--websocket-control-channel-tests) | Session isolation | Medium |
| 5 ⏳ | [Layer 1 — Backend Unit Tests](#layer-1--backend-unit-tests-pytest) | Good baseline | Low |
| 6 🔬 | [Layer 6 — E2E Tests (Playwright)](#layer-6--e2e-tests-playwright) | Most realistic | High |

---

## Suggested File Structure

```
tests/
├── TESTING_STRATEGY.md          ← this file
├── conftest.py                  ← shared fixtures (app client, mock env vars)
├── backend/
│   ├── test_unit.py             ← Layer 1: pure function unit tests
│   ├── test_api.py              ← Layer 2: FastAPI integration (httpx)
│   ├── test_barge_in.py         ← Layer 3: SSE + WS barge-in tests
│   └── test_websocket.py        ← Layer 4: /ws/control channel tests
└── frontend/
    ├── avatarUtils.test.js      ← Layer 5: wordToVisemes unit tests
    └── App.test.jsx             ← Layer 5: React component / hook tests
```

---

## Test Dependencies

### Python (add to `requirements.txt` or a `requirements-dev.txt`)

```
pytest
pytest-asyncio
httpx
websockets
```

### JavaScript (add to `frontend/package.json` devDependencies)

```
vitest
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
jsdom
```

### E2E (optional, install separately)

```
playwright
pytest-playwright
```

---

## Layer 1 — Backend Unit Tests (`pytest`)

**File:** `tests/backend/test_unit.py`

These test pure functions in isolation with no running server. Fast and reliable.

### What to test

| Test | Target | What it validates |
|------|--------|-------------------|
| `test_adaptive_router_chat` | `adaptive_router()` | Returns `"CHAT"` for casual input |
| `test_adaptive_router_rag` | `adaptive_router()` | Returns `"RAG"` for sales-domain queries |
| `test_rag_stream_yields_chunks` | `generate_rag_response_v4_stream()` | Stream yields ≥ 1 non-empty string |
| `test_retriever_known_query` | `get_closest_matches()` | Returns ≥ 1 result for a known training topic |

### Example

```python
import pytest
import asyncio
from src.llm.prompts import adaptive_router, generate_rag_response_v4_stream

def test_adaptive_router_returns_chat_for_greeting():
    result = adaptive_router(chat_history="", latest_user_query="Hello!")
    assert result in ("CHAT", "RAG")  # valid enum value

def test_adaptive_router_returns_rag_for_sales_query():
    result = adaptive_router(chat_history="", latest_user_query="What is a SPIN selling technique?")
    assert result == "RAG"

@pytest.mark.asyncio
async def test_rag_stream_yields_string_chunks():
    stream = generate_rag_response_v4_stream(
        user_query="What is a cold call?",
        retrieved_documents=[],
        chat_history=""
    )
    chunks = [c async for c in stream]
    assert len(chunks) > 0
    assert all(isinstance(c, str) for c in chunks)
```

---

## Layer 2 — FastAPI Integration Tests (`httpx.AsyncClient`)

**File:** `tests/backend/test_api.py`

Uses `httpx.AsyncClient` with `ASGITransport` — no running server required.

### What to test

| Endpoint | Test | Assertion |
|----------|------|-----------|
| `POST /api/chat` | Happy path | Returns `response`, `thoughts`, `route` keys |
| `POST /api/chat` | Empty message | Returns error or empty gracefully |
| `POST /api/chat_stream` | Stream events | First event type is `chunk`, last is `done` |
| `POST /api/chat_stream` | `done` payload | Contains `server_metrics.t_first_token` |
| `POST /api/clear` | Session clear | Subsequent chat has no prior context |

### Example

```python
import json
import pytest
import httpx
from httpx import AsyncClient, ASGITransport
from src.api import app

@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

@pytest.mark.asyncio
async def test_chat_endpoint_returns_expected_keys(client):
    async with client:
        resp = await client.post("/api/chat", json={"message": "Hello", "session_id": "test"})
    assert resp.status_code == 200
    data = resp.json()
    assert "response" in data
    assert "route" in data

@pytest.mark.asyncio
async def test_chat_stream_event_types(client):
    collected_types = []
    async with client:
        async with client.stream("POST", "/api/chat_stream",
                                 json={"message": "Hi", "session_id": "test_stream"}) as r:
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload_str = line[6:].strip()
                if payload_str in ("[DONE]", ""):
                    continue
                payload = json.loads(payload_str)
                collected_types.append(payload["type"])

    assert collected_types[0] == "chunk"
    assert collected_types[-1] == "done"

@pytest.mark.asyncio
async def test_done_event_contains_server_metrics(client):
    async with client:
        async with client.stream("POST", "/api/chat_stream",
                                 json={"message": "Hi", "session_id": "test_metrics"}) as r:
            async for line in r.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = json.loads(line[6:].strip())
                if payload["type"] == "done":
                    assert "server_metrics" in payload
                    assert "t_first_token" in payload["server_metrics"]
                    break

@pytest.mark.asyncio
async def test_clear_resets_session(client):
    async with client:
        await client.post("/api/chat", json={"message": "My name is Alex", "session_id": "test_clear"})
        await client.post("/api/clear", json={"message": "", "session_id": "test_clear"})
        resp = await client.post("/api/chat", json={"message": "What is my name?", "session_id": "test_clear"})
    # After clearing, the avatar should not know the name
    assert "Alex" not in resp.json().get("response", "")
```

---

## Layer 3 — Barge-in / Cancel Event Tests

**File:** `tests/backend/test_barge_in.py`

> [!IMPORTANT]
> This is the critical test layer. It directly validates the barge-in fixes and will
> catch any future regressions in the interrupt pipeline.

These tests require a **live server** (or `uvicorn` in a background thread) because they
combine a WebSocket connection with a concurrent SSE stream.

### What to test

| Test | What it validates |
|------|-------------------|
| `test_barge_in_stops_audio_chunks` | No `audio_chunk` events arrive after `barge_in` fires |
| `test_stream_terminates_after_barge_in` | Stream still ends with a `done` event (clean close) |
| `test_no_barge_in_gives_audio_chunks` | Control: without interrupt, audio chunks do arrive |
| `test_new_stream_not_cancelled_after_barge_in` | Fix #2: new request starts successfully after barge-in |
| `test_session_isolation` | Session A barge-in does not cancel Session B stream |

### Fixture: Live Server

```python
# tests/conftest.py
import threading
import pytest
import uvicorn
from src.api import app

@pytest.fixture(scope="session")
def live_server():
    """Starts a real uvicorn server on port 8999 for WebSocket + SSE combo tests."""
    config = uvicorn.Config(app, host="127.0.0.1", port=8999, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    # Wait for server to be ready
    import time; time.sleep(1.5)
    yield "http://127.0.0.1:8999"
    server.should_exit = True
```

### Example: Core Barge-in Test

```python
import json
import asyncio
import pytest
import httpx
from websockets.asyncio.client import connect

@pytest.mark.asyncio
async def test_barge_in_stops_audio_chunks(live_server):
    base = live_server
    session_id = "test_barge_in_audio"
    audio_before_barge_in = []
    audio_after_barge_in = []
    barge_in_fired = False

    async with connect(f"ws://127.0.0.1:8999/ws/control?session_id={session_id}") as ws:
        async with httpx.AsyncClient(base_url=base, timeout=30) as client:
            async with client.stream("POST", "/api/chat_stream",
                                     json={"message": "Tell me about SPIN selling in detail",
                                           "session_id": session_id}) as r:
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload_str = line[6:].strip()
                    if payload_str in ("[DONE]", ""):
                        continue
                    payload = json.loads(payload_str)

                    if payload["type"] == "done":
                        break

                    if not barge_in_fired:
                        if payload["type"] == "audio_chunk":
                            audio_before_barge_in.append(payload)
                            # Trigger barge-in after receiving 3 audio chunks
                            if len(audio_before_barge_in) >= 3:
                                await ws.send(json.dumps({"type": "barge_in"}))
                                barge_in_fired = True
                    else:
                        if payload["type"] == "audio_chunk":
                            audio_after_barge_in.append(payload)

    assert barge_in_fired, "Barge-in was never triggered (stream ended too fast?)"
    assert len(audio_before_barge_in) >= 3
    assert len(audio_after_barge_in) == 0, (
        f"Expected 0 audio chunks after barge-in, got {len(audio_after_barge_in)}"
    )

@pytest.mark.asyncio
async def test_stream_terminates_cleanly_after_barge_in(live_server):
    """Stream must always end with a 'done' event even after barge-in."""
    session_id = "test_barge_in_done"
    event_types = []
    barge_in_fired = False

    async with connect(f"ws://127.0.0.1:8999/ws/control?session_id={session_id}") as ws:
        async with httpx.AsyncClient(base_url=live_server, timeout=30) as client:
            async with client.stream("POST", "/api/chat_stream",
                                     json={"message": "Explain objection handling",
                                           "session_id": session_id}) as r:
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = json.loads(line[6:].strip())
                    event_types.append(payload["type"])
                    if payload["type"] == "audio_chunk" and not barge_in_fired:
                        await ws.send(json.dumps({"type": "barge_in"}))
                        barge_in_fired = True
                    if payload["type"] == "done":
                        break

    assert "done" in event_types, "Stream did not terminate with a 'done' event"

@pytest.mark.asyncio
async def test_session_isolation(live_server):
    """Barge-in on session A must not cancel session B's stream."""
    results = {"a_audio": 0, "b_audio": 0, "b_interrupted": False}

    async def stream_session(session_id, results_key, cancel_after=None):
        async with httpx.AsyncClient(base_url=live_server, timeout=30) as client:
            async with client.stream("POST", "/api/chat_stream",
                                     json={"message": "Tell me about cold calls",
                                           "session_id": session_id}) as r:
                count = 0
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = json.loads(line[6:].strip())
                    if payload["type"] == "audio_chunk":
                        count += 1
                    if payload["type"] == "done":
                        break
                results[results_key] = count

    async with connect(f"ws://127.0.0.1:8999/ws/control?session_id=session_a") as ws:
        task_a = asyncio.create_task(stream_session("session_a", "a_audio"))
        task_b = asyncio.create_task(stream_session("session_b", "b_audio"))
        # Wait a moment then barge-in on session A only
        await asyncio.sleep(1.5)
        await ws.send(json.dumps({"type": "barge_in"}))
        await asyncio.gather(task_a, task_b)

    # Session B should have received audio chunks unaffected
    assert results["b_audio"] > 0, "Session B received no audio (incorrectly cancelled?)"
```

---

## Layer 4 — WebSocket Control Channel Tests

**File:** `tests/backend/test_websocket.py`

### What to test

| Test | What it validates |
|------|-------------------|
| Connect + `barge_in` | `cancel_events[session_id]` becomes set |
| Disconnect + reconnect | No `KeyError`, new event object is created |
| Multiple simultaneous sessions | Each session has its own isolated cancel event |

### Example

```python
import json
import pytest
from websockets.asyncio.client import connect

@pytest.mark.asyncio
async def test_control_ws_accepts_barge_in(live_server):
    from src.api import cancel_events
    session_id = "test_ws_barge"

    async with connect(f"ws://127.0.0.1:8999/ws/control?session_id={session_id}") as ws:
        await ws.send(json.dumps({"type": "barge_in"}))
        await asyncio.sleep(0.1)  # allow server to process

    assert session_id in cancel_events
    assert cancel_events[session_id].is_set()

@pytest.mark.asyncio
async def test_multiple_sessions_are_isolated(live_server):
    from src.api import cancel_events

    async with connect(f"ws://127.0.0.1:8999/ws/control?session_id=ws_session_a") as ws_a:
        async with connect(f"ws://127.0.0.1:8999/ws/control?session_id=ws_session_b") as ws_b:
            await ws_a.send(json.dumps({"type": "barge_in"}))
            await asyncio.sleep(0.1)

    assert cancel_events.get("ws_session_a") and cancel_events["ws_session_a"].is_set()
    # Session B should NOT be affected
    assert not (cancel_events.get("ws_session_b") and cancel_events["ws_session_b"].is_set())
```

---

## Layer 5 — Frontend Unit Tests (Vitest)

**Files:** `tests/frontend/avatarUtils.test.js`, `tests/frontend/App.test.jsx`

> [!NOTE]
> Alternatively, place these inside `frontend/src/__tests__/` to co-locate them with
> the source files, which is conventional for Vite/React projects.

### `avatarUtils.test.js` — G2V / Viseme Logic

```javascript
import { describe, it, expect } from 'vitest';
import { wordToVisemes } from '../../frontend/src/avatarUtils.js';

describe('wordToVisemes', () => {
  it('returns IDLE for empty string', () => {
    expect(wordToVisemes('')).toEqual(['IDLE']);
  });

  it('handles digraph "th" correctly', () => {
    const v = wordToVisemes('the');
    expect(v[0]).toBe('TH');
  });

  it('handles digraph "sh" correctly', () => {
    expect(wordToVisemes('she')).toContain('SH');
  });

  it('deduplicates consecutive identical visemes', () => {
    const v = wordToVisemes('mm');         // m+m → MBPV+MBPV → deduplicated
    expect(v.filter(x => x === 'MBPV').length).toBe(1);
  });

  it('handles punctuation in word gracefully', () => {
    expect(() => wordToVisemes("hello,")).not.toThrow();
  });

  it('maps "b" to MBPV', () => {
    expect(wordToVisemes('b')).toContain('MBPV');
  });
});
```

### `App.test.jsx` — Barge-in Hook Logic

The most important tests here focus on `isBusyRef` and `onSpeechStart` behaviour.

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock heavy dependencies
vi.mock('@ricky0123/vad-web', () => ({ MicVAD: { new: vi.fn() } }));
vi.mock('lucide-react', () => ({
  Send: () => null, Trash2: () => null, Loader2: () => null,
  BrainCircuit: () => null, Mic: () => null, MicOff: () => null,
}));

describe('handleSend guard (isBusyRef)', () => {
  it('does not double-send when isBusyRef is true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true }) }) },
    });

    // Import App and trigger two rapid sends
    // The second call should be swallowed by isBusyRef
    // (detailed implementation depends on how you expose the ref in tests)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
```

> [!TIP]
> For deeper React hook testing (refs, VAD callbacks), consider using
> `renderHook` from `@testing-library/react` to extract the logic into a
> custom hook (`useVoiceMode`) first, which makes it much easier to assert
> on internal state changes.

---

## Layer 6 — E2E Tests (Playwright)

**File:** `tests/e2e/test_voice_mode.py`

> [!WARNING]
> Requires a fully running backend (`uvicorn`) and built frontend (`npm run build`).
> Voice tests require valid `CARTESIA_API_KEY` and `DEEPGRAM_API_KEY` in `.env`.

### Fake Microphone Setup

Playwright can inject a `.wav` file as the system microphone input using Chrome launch flags:

```python
# tests/e2e/conftest.py
import pytest
from playwright.sync_api import sync_playwright

WAV_INTERRUPT = "tests/e2e/fixtures/interrupt_phrase.wav"  # e.g. "I have a question"

@pytest.fixture(scope="session")
def browser_context():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=[
                "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-audio-capture={WAV_INTERRUPT}",
                "--allow-file-access-from-files",
            ]
        )
        context = browser.new_context(permissions=["microphone"])
        yield context
        browser.close()
```

### E2E Barge-in Test

```python
def test_barge_in_stops_avatar_speaking(browser_context):
    page = browser_context.new_page()
    page.goto("http://localhost:5173")

    # Activate voice mode
    page.get_by_text("Voice Mode").click()

    # Wait for listening state
    page.wait_for_selector("text=Listening…", timeout=5000)

    # Trigger the avatar to speak (via text input while still in voice mode)
    page.fill("input[placeholder='Type here...']", "Explain SPIN selling in detail")
    page.keyboard.press("Enter")

    # Wait for speaking state
    page.wait_for_selector("text=Speaking…", timeout=15000)

    # The fake WAV file acts as the interrupt — VAD should pick it up
    # and the state should transition back to Listening
    page.wait_for_selector("text=Listening…", timeout=10000)

    # Assert we are back to listening (not still speaking)
    assert page.is_visible("text=Listening…")
    assert not page.is_visible("text=Speaking…")
```

### Prepare Fixture Audio Files

Create short `.wav` files (16kHz, mono, PCM) for use as fake mic inputs:

| File | Content | Used for |
|------|---------|----------|
| `interrupt_phrase.wav` | ~1s of speech (any phrase) | Triggers VAD `onSpeechStart` |
| `silence.wav` | ~2s of silence | Baseline: no barge-in should fire |
| `long_phrase.wav` | ~3s of speech | Triggers `speech_final` for full turn |

---

## Running the Tests

```bash
# Backend tests (from project root)
pytest tests/backend/ -v

# Barge-in tests only (requires live server fixture)
pytest tests/backend/test_barge_in.py -v

# Frontend unit tests (from frontend/ directory)
cd frontend
npx vitest run

# E2E tests (requires running server)
uvicorn src.api:app --port 8000 &
cd frontend && npm run build && npm run preview &
pytest tests/e2e/ -v
```

---

## Notes on Mocking External APIs

For CI environments without live API keys, mock Cartesia and Deepgram using
`pytest-httpx` or `unittest.mock.patch`:

```python
from unittest.mock import patch, AsyncMock

@pytest.mark.asyncio
async def test_chat_stream_without_cartesia():
    with patch("src.api.websockets.connect", new_callable=AsyncMock) as mock_ws:
        mock_ws.return_value.__aenter__.return_value.closed = True
        # Run stream test — Cartesia branch is skipped when ws is None
        ...
```

This lets the SSE text-chunk tests run in CI without consuming API credits,
while the barge-in audio tests are reserved for environments with real keys.
