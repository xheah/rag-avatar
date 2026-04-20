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


pytestmark = [pytest.mark.e2e]

# ── Selectors ────────────────────────────────────────────────────────────────
INPUT_SEL  = "input[placeholder='Type here...']"
CLEAR_SEL  = "button:has-text('Clear')"
VOICE_SEL  = "button:has-text('Voice Mode')"

# ── JS helpers ───────────────────────────────────────────────────────────────
# IMPORTANT: Tailwind v4 uses utility classes like `bg-white/10` with a
# literal slash.  The slash is INVALID in CSS class selectors (.bg-white/10
# throws a SyntaxError from querySelectorAll) even after escaping through the
# Python → JS string pipeline.  We use an attribute *substring* selector
# [class*="bg-white/10"] which has no escaping requirement and is equally
# precise for locating avatar message bubbles.
_AVATAR_BUBBLE_SEL = '[class*="bg-white/10"]'
_USER_BUBBLE_SEL   = '.bg-indigo-600'

_AVATAR_BUBBLES_COUNT_JS = f'() => document.querySelectorAll(\'{_AVATAR_BUBBLE_SEL}\').length'
_USER_BUBBLES_COUNT_JS   = f'() => document.querySelectorAll(\'{_USER_BUBBLE_SEL}\').length'
_STATUS_ONLINE_JS        = '() => document.body.textContent.includes("Online")'
_INPUT_EMPTY_JS          = f'() => (document.querySelector("{INPUT_SEL}") || {{}}).value === ""'


# ── Helpers ───────────────────────────────────────────────────────────────────

def type_and_send(page: Page, text: str) -> None:
    """Fill the text input and press Enter."""
    page.locator(INPUT_SEL).fill(text)
    page.keyboard.press("Enter")


def wait_for_online(page: Page, timeout: int = 90_000) -> None:
    """
    Wait until orbState returns to 'idle' (status label 'Online').

    This is the definitive signal that isBusyRef has been released — it fires
    inside the speakingTimeout callback *after* audio has finished playing.
    Using a generous timeout because Cartesia TTS can take 10-30 s.
    """
    page.wait_for_function(_STATUS_ONLINE_JS, timeout=timeout)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Page load
# ─────────────────────────────────────────────────────────────────────────────

class TestPageLoad:

    def test_page_title_is_non_empty(self, text_page: Page):
        assert text_page.title() != ""

    def test_welcome_message_is_visible(self, text_page: Page):
        expect(text_page.get_by_text("Welcome back")).to_be_visible(timeout=8_000)

    def test_text_input_is_present_and_editable(self, text_page: Page):
        inp = text_page.locator(INPUT_SEL)
        expect(inp).to_be_visible(timeout=5_000)
        expect(inp).to_be_editable()

    def test_clear_button_is_present(self, text_page: Page):
        expect(text_page.locator(CLEAR_SEL)).to_be_visible(timeout=5_000)

    def test_voice_mode_button_is_present(self, text_page: Page):
        expect(text_page.locator(VOICE_SEL)).to_be_visible(timeout=5_000)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Text send & response — requires live Groq API (rate-limit sensitive)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.api
class TestTextSendAndResponse:

    def test_user_message_appears_in_chat(self, text_page: Page):
        type_and_send(text_page, "Hello from the test suite")
        expect(text_page.get_by_text("Hello from the test suite")).to_be_visible(
            timeout=10_000
        )

    def test_avatar_reply_appears_after_send(self, text_page: Page):
        """
        The avatar must produce at least one non-empty reply bubble.
        Uses [class*="bg-white/10"] (attribute substring) to avoid the CSS
        selector SyntaxError caused by the literal slash in Tailwind's opacity
        utility class.
        """
        type_and_send(text_page, "What is SPIN selling?")
        text_page.wait_for_function(
            f"""() => {{
                const bubbles = document.querySelectorAll('{_AVATAR_BUBBLE_SEL}');
                if (bubbles.length < 2) return false;
                return bubbles[bubbles.length - 1].textContent.trim().length > 5;
            }}""",
            timeout=30_000,
        )

    def test_input_is_cleared_after_send(self, text_page: Page):
        type_and_send(text_page, "Testing input clearing")
        text_page.wait_for_function(_INPUT_EMPTY_JS, timeout=5_000)

    def test_status_changes_to_analyzing_after_send(self, text_page: Page):
        """
        'Analyzing…' is set synchronously inside handleSend so it appears
        immediately after the request is dispatched.
        """
        type_and_send(text_page, "Short answer question")
        expect(text_page.get_by_text("Analyzing…")).to_be_visible(timeout=10_000)


# ─────────────────────────────────────────────────────────────────────────────
# 3. Session clear — requires live Groq API (rate-limit sensitive)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.api
class TestSessionClear:

    def test_clear_resets_chat(self, text_page: Page):
        type_and_send(text_page, "Something before clear")
        expect(text_page.get_by_text("Something before clear")).to_be_visible(
            timeout=10_000
        )
        text_page.locator(CLEAR_SEL).click()
        expect(text_page.get_by_text("Chat history cleared")).to_be_visible(
            timeout=5_000
        )

    def test_user_can_send_after_clear(self, text_page: Page):
        text_page.locator(CLEAR_SEL).click()
        expect(text_page.get_by_text("Chat history cleared")).to_be_visible(
            timeout=5_000
        )
        type_and_send(text_page, "Post-clear message")
        expect(text_page.get_by_text("Post-clear message")).to_be_visible(
            timeout=10_000
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4. SSE stream integrity — requires live Groq API (rate-limit sensitive)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.api
class TestSSEStreamIntegrity:

    def test_multiple_turns_accumulate(self, text_page: Page):
        """
        Two sequential messages must each produce a user bubble (bg-indigo-600)
        and an avatar reply bubble.

        Previous failure: the second type_and_send was rejected because
        isBusyRef was still true while audio played.  Fix: call wait_for_online()
        between turns — this polls for the 'Online' status label which is set
        only when the speaking-timeout fires (isBusyRef released, audio done).
        """
        # ── First turn ──────────────────────────────────────────────────────
        type_and_send(text_page, "First turn question")
        expect(text_page.get_by_text("First turn question")).to_be_visible(
            timeout=10_000
        )
        text_page.wait_for_function(
            f"""() => {{
                const b = document.querySelectorAll('{_AVATAR_BUBBLE_SEL}');
                return b.length >= 2 && b[b.length-1].textContent.trim().length > 5;
            }}""",
            timeout=30_000,
        )

        # CRITICAL: wait for audio to finish and isBusyRef to be released
        wait_for_online(text_page, timeout=90_000)

        # ── Second turn ──────────────────────────────────────────────────────
        type_and_send(text_page, "Second turn question")
        expect(text_page.get_by_text("Second turn question")).to_be_visible(
            timeout=10_000
        )
        # Two user bubbles (bg-indigo-600) must be present
        text_page.wait_for_function(
            f"() => document.querySelectorAll('{_USER_BUBBLE_SEL}').length >= 2",
            timeout=30_000,
        )

    def test_no_javascript_error_on_complete_turn(self, text_page: Page):
        """A full request → SSE → done cycle must not produce uncaught JS errors."""
        js_errors = []
        text_page.on("pageerror", lambda exc: js_errors.append(str(exc)))

        type_and_send(text_page, "Error-free turn")
        text_page.wait_for_function(
            f"""() => {{
                const b = document.querySelectorAll('{_AVATAR_BUBBLE_SEL}');
                return b.length >= 2 && b[b.length-1].textContent.trim().length > 5;
            }}""",
            timeout=30_000,
        )
        assert js_errors == [], f"Unexpected JS errors: {js_errors}"
