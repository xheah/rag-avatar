"""
tests/e2e/conftest.py
---------------------
Shared Playwright fixtures for the Layer 6 E2E test suite.

Design decisions
  - The browser is launched with --use-fake-device-for-media-stream so that
    Chrome's media stack runs without real microphone hardware.
  - Two fixture modes are supported:
      text_page  – browser without mic injection (for pure text-flow E2E tests)
      voice_page – browser with a WAV file injected as the fake mic input
        (for barge-in / VAD triggered tests)
  - The backend server is expected to be running at BACKEND_URL (configurable
    via the BACKEND_URL env var, defaults to http://127.0.0.1:8000).
  - The frontend dev server is expected to be running at FRONTEND_URL
    (configurable via FRONTEND_URL, defaults to http://localhost:5173).

Running
  # 1. Start the backend
  uvicorn src.api:app --port 8000

  # 2. Start the frontend dev server
  cd frontend && npm run dev

  # 3. Run E2E tests
  pytest tests/e2e/ -v

Or with custom ports:
  BACKEND_URL=http://127.0.0.1:8080 FRONTEND_URL=http://localhost:3000 pytest tests/e2e/ -v
"""

import os
import pathlib

import pytest
from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

BACKEND_URL  = os.getenv("BACKEND_URL",  "http://127.0.0.1:8000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"

# Fake WAV files used as mic input (relative to FIXTURES_DIR).
# These are tiny PCM WAV files — see README for how to generate them.
WAV_INTERRUPT = str(FIXTURES_DIR / "interrupt_phrase.wav")
WAV_SILENCE   = str(FIXTURES_DIR / "silence.wav")

# Common Chromium flags for WebRTC / microphone fake device support
_FAKE_DEVICE_ARGS = [
    "--use-fake-device-for-media-stream",
    "--allow-file-access-from-files",
    "--disable-web-security",         # allows JS to call getUserMedia in jsdom
    "--no-sandbox",
    "--disable-setuid-sandbox",
]


# ─────────────────────────────────────────────────────────────────────────────
# Session-scoped playwright instance
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def playwright_ctx():
    with sync_playwright() as p:
        yield p


# ─────────────────────────────────────────────────────────────────────────────
# Text-mode browser (no fake mic injection)
# Used for tests that only interact via keyboard / click.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def text_browser(playwright_ctx):
    browser = playwright_ctx.chromium.launch(
        headless=True,
        args=_FAKE_DEVICE_ARGS,
    )
    yield browser
    browser.close()


@pytest.fixture(scope="function")
def text_page(text_browser: Browser) -> Page:
    context: BrowserContext = text_browser.new_context(
        permissions=["microphone"],
        # Pre-grant microphone so getUserMedia doesn't show a permission prompt
    )
    page: Page = context.new_page()
    page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=15_000)
    yield page
    context.close()


@pytest.fixture(scope="function")
def barge_in_page(text_browser: Browser) -> Page:
    """
    Like text_page but with a WebSocket interceptor pre-installed so that
    every WS instance is recorded on window.__controlWsInstances.
    This allows inject_barge_in() to send over the control socket without
    relying on page.reload() or accumulating add_init_script calls.
    """
    _WS_INTERCEPT_SCRIPT = """
        window.__controlWsInstances = [];
        const _OrigWS = window.WebSocket;
        window.WebSocket = function(...args) {
            const ws = new _OrigWS(...args);
            window.__controlWsInstances.push(ws);
            return ws;
        };
        Object.assign(window.WebSocket, _OrigWS);
    """
    context: BrowserContext = text_browser.new_context(permissions=["microphone"])
    page: Page = context.new_page()
    page.add_init_script(_WS_INTERCEPT_SCRIPT)
    page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=15_000)
    yield page
    context.close()


# ─────────────────────────────────────────────────────────────────────────────
# Voice-mode browser (fake WAV injected as microphone)
# Used for barge-in / VAD triggered tests.
# ─────────────────────────────────────────────────────────────────────────────

def _make_voice_browser(playwright_ctx, wav_path: str) -> Browser:
    """Launch a Chromium browser with a specific WAV file as fake mic input."""
    wav_abs = str(pathlib.Path(wav_path).resolve())
    return playwright_ctx.chromium.launch(
        headless=True,
        args=[
            *_FAKE_DEVICE_ARGS,
            f"--use-file-for-fake-audio-capture={wav_abs}",
        ],
    )


@pytest.fixture(scope="session")
def voice_browser(playwright_ctx):
    """Browser with interrupt_phrase.wav injected as the microphone input."""
    if not pathlib.Path(WAV_INTERRUPT).exists():
        pytest.skip(
            f"Fixture WAV not found: {WAV_INTERRUPT}\n"
            "Run `python tests/e2e/fixtures/generate_wavs.py` to create it."
        )
    browser = _make_voice_browser(playwright_ctx, WAV_INTERRUPT)
    yield browser
    browser.close()


@pytest.fixture(scope="session")
def silence_browser(playwright_ctx):
    """Browser with silence.wav injected — used for baseline tests."""
    if not pathlib.Path(WAV_SILENCE).exists():
        pytest.skip(f"Fixture WAV not found: {WAV_SILENCE}")
    browser = _make_voice_browser(playwright_ctx, WAV_SILENCE)
    yield browser
    browser.close()


@pytest.fixture(scope="function")
def voice_page(voice_browser: Browser) -> Page:
    context = voice_browser.new_context(permissions=["microphone"])
    page = context.new_page()
    page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=15_000)
    yield page
    context.close()


@pytest.fixture(scope="function")
def silence_page(silence_browser: Browser) -> Page:
    context = silence_browser.new_context(permissions=["microphone"])
    page = context.new_page()
    page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=15_000)
    yield page
    context.close()
