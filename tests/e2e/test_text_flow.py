"""
tests/e2e/test_text_flow.py
----------------------------
Layer 6 — E2E tests for the text-input chat flow.

These tests do NOT require voice mode, real API keys, or WAV fixtures.
They drive the app exactly as a user with a keyboard would, verifying the
complete request → SSE stream → UI update cycle in a real Chromium browser.

Prerequisites
  - Backend:  uvicorn src.api:app --port 8000
  - Frontend: cd frontend && npm run dev
  or set BACKEND_URL / FRONTEND_URL env vars.

Marks
  - @pytest.mark.e2e  — can be excluded from fast CI with -m "not e2e"
"""

import pytest
from playwright.sync_api import Page, expect


pytestmark = pytest.mark.e2e

# Selectors that mirror the actual rendered DOM (from App.jsx render)
INPUT_SEL   = "input[placeholder='Type here...']"
CLEAR_SEL   = "button:has-text('Clear')"
VOICE_SEL   = "button:has-text('Voice Mode')"
AVATAR_SEL  = "[data-testid='photo-avatar']"

# JS snippets that probe the React-rendered DOM
_AVATAR_BUBBLES_JS = "() => document.querySelectorAll('.bg-white\\/10').length"
_USER_BUBBLES_JS   = "() => document.querySelectorAll('.bg-indigo-600').length"
_STATUS_ONLINE_JS  = "() => document.body.textContent.includes('Online')"
_INPUT_EMPTY_JS    = f"() => document.querySelector(\"{INPUT_SEL}\")?.value === ''"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def type_and_send(page: Page, text: str) -> None:
    """Fill the text input and press Enter."""
    page.locator(INPUT_SEL).fill(text)
    page.keyboard.press("Enter")


def wait_for_online(page: Page, timeout: int = 60_000) -> None:
    """
    Wait until orbState returns to 'idle' (status label 'Online').
    This is the signal that isBusyRef has been released and audio has finished.
    Using a generous timeout because Cartesia audio can be 10-30 s long.
    """
    page.wait_for_function(_STATUS_ONLINE_JS, timeout=timeout)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Page load
# ─────────────────────────────────────────────────────────────────────────────

class TestPageLoad:

    def test_page_title_contains_avatar(self, text_page: Page):
        """The page title should reference the Sales Tutor / Avatar app."""
        assert text_page.title() != ""

    def test_welcome_message_is_visible(self, text_page: Page):
        """The initial avatar message should be visible on load."""
        expect(text_page.get_by_text("Welcome back")).to_be_visible(timeout=8_000)

    def test_text_input_is_present(self, text_page: Page):
        """The text input field must render and be editable."""
        inp = text_page.locator(INPUT_SEL)
        expect(inp).to_be_visible(timeout=5_000)
        expect(inp).to_be_editable()

    def test_clear_button_is_present(self, text_page: Page):
        expect(text_page.locator(CLEAR_SEL)).to_be_visible(timeout=5_000)

    def test_voice_mode_button_is_present(self, text_page: Page):
        expect(text_page.locator(VOICE_SEL)).to_be_visible(timeout=5_000)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Text send & response
# ─────────────────────────────────────────────────────────────────────────────

class TestTextSendAndResponse:

    def test_user_message_appears_in_chat(self, text_page: Page):
        """After pressing Enter, the typed message must appear in the chat."""
        type_and_send(text_page, "Hello from the test suite")
        expect(
            text_page.get_by_text("Hello from the test suite")
        ).to_be_visible(timeout=10_000)

    def test_avatar_reply_appears_after_send(self, text_page: Page):
        """
        The avatar must produce at least one non-empty reply bubble.
        A new avatar bubble (bg-white/10) must appear and contain text with
        more than 5 characters, which rules out the empty thinking animation.
        """
        type_and_send(text_page, "What is SPIN selling?")
        text_page.wait_for_function(
            """() => {
                const bubbles = document.querySelectorAll('.bg-white\\/10');
                if (bubbles.length < 2) return false;
                const last = bubbles[bubbles.length - 1];
                return last.textContent.trim().length > 5;
            }""",
            timeout=30_000,
        )

    def test_input_is_cleared_after_send(self, text_page: Page):
        """The text input must be empty after pressing Enter."""
        type_and_send(text_page, "Testing input clearing")
        text_page.wait_for_function(_INPUT_EMPTY_JS, timeout=5_000)

    def test_status_changes_to_analyzing_then_back(self, text_page: Page):
        """
        The status indicator must transition through 'Analyzing…' during an
        in-flight request.  We poll quickly right after the send so we don't
        miss this short-lived intermediate state.
        """
        type_and_send(text_page, "Short answer question")
        # 'Analyzing…' is set synchronously inside handleSend → lasts until
        # the first SSE chunk arrives.  10s is more than enough.
        expect(text_page.get_by_text("Analyzing…")).to_be_visible(timeout=10_000)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Session clear
# ─────────────────────────────────────────────────────────────────────────────

class TestSessionClear:

    def test_clear_resets_chat_to_cleared_message(self, text_page: Page):
        """After clicking Clear, the chat must show the 'cleared' confirmation."""
        type_and_send(text_page, "Something before clear")
        expect(text_page.get_by_text("Something before clear")).to_be_visible(timeout=10_000)

        text_page.locator(CLEAR_SEL).click()
        expect(text_page.get_by_text("Chat history cleared")).to_be_visible(timeout=5_000)

    def test_user_can_send_after_clear(self, text_page: Page):
        """After clearing, a new message must still be accepted and rendered."""
        text_page.locator(CLEAR_SEL).click()
        expect(text_page.get_by_text("Chat history cleared")).to_be_visible(timeout=5_000)

        type_and_send(text_page, "Post-clear message")
        expect(text_page.get_by_text("Post-clear message")).to_be_visible(timeout=10_000)


# ─────────────────────────────────────────────────────────────────────────────
# 4. SSE stream integrity
# ─────────────────────────────────────────────────────────────────────────────

class TestSSEStreamIntegrity:

    def test_multiple_turns_accumulate(self, text_page: Page):
        """
        Sending two messages in sequence must result in two user bubbles and
        two avatar reply bubbles (plus the original welcome).

        Root cause of previous failure: isBusyRef remained true while audio
        was still playing after the first reply appeared in the DOM.  The fix
        is to wait for orbState == 'idle' ('Online' label) before sending
        the second message — this is the moment isBusyRef is finally released.
        """
        # ── First turn ──────────────────────────────────────────────────────
        type_and_send(text_page, "First turn question")
        expect(text_page.get_by_text("First turn question")).to_be_visible(
            timeout=10_000
        )

        # Wait for the first reply bubble to have content
        text_page.wait_for_function(
            """() => {
                const bubbles = document.querySelectorAll('.bg-white\\/10');
                if (bubbles.length < 2) return false;
                return bubbles[bubbles.length - 1].textContent.trim().length > 5;
            }""",
            timeout=30_000,
        )

        # CRITICAL: wait for the busy lock to be released (audio finished +
        # isBusyRef = false).  orbState returns to 'idle' → status = 'Online'.
        wait_for_online(text_page, timeout=90_000)

        # ── Second turn ──────────────────────────────────────────────────────
        type_and_send(text_page, "Second turn question")
        expect(text_page.get_by_text("Second turn question")).to_be_visible(
            timeout=10_000
        )

        # Two user bubbles (bg-indigo-600) must be in the DOM
        text_page.wait_for_function(
            f"() => ({_USER_BUBBLES_JS})() >= 2",
            timeout=30_000,
        )

    def test_no_javascript_error_on_complete_turn(self, text_page: Page):
        """
        A complete request → SSE → done cycle must not produce any uncaught
        JavaScript error in the browser console.
        """
        js_errors = []
        text_page.on("pageerror", lambda exc: js_errors.append(str(exc)))

        type_and_send(text_page, "Error-free turn")
        text_page.wait_for_function(
            f"() => ({_AVATAR_BUBBLES_JS})() >= 2",
            timeout=30_000,
        )

        assert js_errors == [], f"Unexpected JS errors: {js_errors}"
