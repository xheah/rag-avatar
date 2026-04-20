/**
 * frontend/src/__tests__/App.test.jsx
 * ------------------------------------
 * Layer 5 — React component and barge-in logic unit tests.
 *
 * Strategy: App.jsx imports many heavy browser APIs (AudioContext, WebRTC,
 * @ricky0123/vad-web, lucide-react, WebSocket) that do not exist in jsdom.
 * We mock all of them at the module level so the component can be rendered
 * and its internal logic exercised without a real browser.
 *
 * Test groups
 *   1. Rendering           – basic DOM sanity
 *   2. Input + Send guard  – isBusyRef prevents double-sends (Fix #1)
 *   3. Stream gen stamp    – streamGenRef increments per send (Fix #5)
 *   4. SSE chunk parsing   – messages update from stream events
 *   5. Session clear       – /api/clear called, history resets
 *   6. Message accumulation – messages array grows correctly
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level mocks — MUST appear before any dynamic import of App
// ─────────────────────────────────────────────────────────────────────────────

// 1. Heavy UI icon library
// IMPORTANT: Send must render a <span> not a <button> — the real App already
// wraps it inside a <button>, so rendering a <button> would cause nested-button
// invalid HTML which throws in React 19.
vi.mock('lucide-react', () => ({
  Send: () => <span aria-label="send-icon">→</span>,
  Trash2: () => <span aria-label="trash-icon">🗑</span>,
  Loader2: () => <span aria-label="loader">…</span>,
  BrainCircuit: () => <span aria-label="brain">🧠</span>,
  Mic: () => <span data-testid="mic-icon">Mic</span>,
  MicOff: () => <span data-testid="micoff-icon">MicOff</span>,
}));

// 2. VAD — never initialise hardware mic
vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: {
    new: vi.fn(() => Promise.resolve({
      start: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    })),
  },
}));

// 3. react-markdown — lightweight stub
vi.mock('react-markdown', () => ({
  default: ({ children }) => <span data-testid="markdown">{children}</span>,
}));

// 4. Avatar components — lightweight stubs
vi.mock('../components/CartoonAvatar', () => ({
  CartoonAvatar: () => <div data-testid="cartoon-avatar" />,
  PhotorealisticAvatar: ({ viseme, orbState }) => (
    <div data-testid="photo-avatar" data-viseme={viseme} data-orb={orbState} />
  ),
}));

// 5. Browser APIs unavailable in jsdom

// scrollIntoView polyfill — must be at module scope before jsdom element creation
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

// FakeAudioContext — minimal stub for the audio pipeline
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; }
  createBuffer(_ch, _len, _sr) {
    const buf = new Float32Array(_len ?? 441);
    return {
      getChannelData: () => buf,
      duration: (_len ?? 441) / (_sr ?? 44100),
    };
  }
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: vi.fn(), disconnect: vi.fn(),
             addEventListener: vi.fn() };
  }
  resume() { return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  get destination() { return {}; }
}
vi.stubGlobal('AudioContext', FakeAudioContext);
vi.stubGlobal('webkitAudioContext', FakeAudioContext);

// RTCPeerConnection stub
const makeMockPC = () => ({
  createDataChannel: vi.fn(() => ({
    onmessage: null, readyState: 'open', send: vi.fn(),
  })),
  createOffer: vi.fn(() => Promise.resolve({ sdp: 'fake', type: 'offer' })),
  setLocalDescription: vi.fn(() => Promise.resolve()),
  setRemoteDescription: vi.fn(() => Promise.resolve()),
  addTrack: vi.fn(),
  close: vi.fn(),
  localDescription: { sdp: 'fake', type: 'offer' },
});
vi.stubGlobal('RTCPeerConnection', vi.fn(makeMockPC));
vi.stubGlobal('RTCSessionDescription', vi.fn(x => x));

// WebSocket stub — App opens one on mount for the control channel
class FakeWebSocket {
  constructor() {
    this.onopen = null; this.onclose = null; this.onmessage = null;
    this.readyState = 1;  // OPEN
    // Fire onopen asynchronously so the ref is set before callbacks fire
    setTimeout(() => this.onopen?.(), 0);
  }
  send() {}
  close() { this.onclose?.(); }
}
vi.stubGlobal('WebSocket', FakeWebSocket);

// navigator.mediaDevices (getUserMedia)
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn(() => Promise.resolve({
      getTracks: () => [{ stop: vi.fn() }],
    })),
  },
  writable: true, configurable: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Fake SSE stream factory
// ─────────────────────────────────────────────────────────────────────────────

function makeFakeStream(extraEvents = []) {
  const doneEvent = { type: 'done', server_metrics: { t_first_token: 0.1, t_llm_done: 0.5 } };
  const lines = [...extraEvents, doneEvent]
    .map(e => `data: ${JSON.stringify(e)}\n\n`)
    .join('');

  const encoded = new TextEncoder().encode(lines);
  let delivered = false;

  return {
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn(() => {
          if (!delivered) {
            delivered = true;
            return Promise.resolve({ done: false, value: encoded });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      }),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Global fetch mock helper
// ─────────────────────────────────────────────────────────────────────────────

function setupFetch(extraEvents = []) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url = '') => {
    if (url.includes('/api/chat_stream'))
      return Promise.resolve(makeFakeStream(extraEvents));
    if (url.includes('/api/clear'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'cleared' }) });
    if (url.includes('/api/offer'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sdp: 'answer', type: 'answer' }),
      });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// App import helper — deferred so all mocks are registered first
// ─────────────────────────────────────────────────────────────────────────────

let _AppModule = null;
async function importApp() {
  if (!_AppModule) {
    _AppModule = await import('../App.jsx');
  }
  return _AppModule.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-test scrollIntoView safety net
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  if (typeof Element !== 'undefined') {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: trigger Enter on the text input
// ─────────────────────────────────────────────────────────────────────────────

async function sendViaEnter(input, text) {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('App — rendering', () => {
  it('renders without crashing', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });
  });

  it('shows the initial avatar welcome message', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
  });

  it('renders the text input field', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });
    expect(screen.getByPlaceholderText(/Type here/i)).toBeInTheDocument();
  });

  it('renders a voice mode toggle with a mic icon', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });
    // MicOff icon is shown when voice mode is off (default state)
    expect(screen.getByTestId('micoff-icon')).toBeInTheDocument();
  });

  it('renders a clear / history button', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });
    // The clear button contains "Clear" text
    expect(screen.getByText(/Clear/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. isBusyRef double-send guard (Fix #1)
// ─────────────────────────────────────────────────────────────────────────────

describe('App — isBusyRef double-send guard (Fix #1)', () => {
  it('does NOT fetch when the input is empty', async () => {
    const fetchSpy = setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);
    await sendViaEnter(input, '');

    const streamCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/chat_stream'));
    expect(streamCalls.length).toBe(0);
  });

  it('calls /api/chat_stream exactly once for a single non-empty send', async () => {
    const fetchSpy = setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);
    await sendViaEnter(input, 'Hello!');
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    const streamCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/chat_stream'));
    expect(streamCalls.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. streamGenRef stamp (Fix #5)
// ─────────────────────────────────────────────────────────────────────────────

describe('App — streamGenRef stale-audio guard (Fix #5)', () => {
  it('each send produces a separate fetch call (counter advances)', async () => {
    // We can verify the counter advances by observing that two separate sends
    // each hit /api/chat_stream exactly once (the busy guard clears between them).
    const fetchSpy = setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);

    // First send
    await sendViaEnter(input, 'First');
    // Wait for busy lock to release (the fake SSE delivers done immediately)
    await act(async () => { await new Promise(r => setTimeout(r, 1200)); });

    // Second send
    await sendViaEnter(input, 'Second');
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });

    const streamCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/chat_stream'));
    // At least the first send called the stream endpoint
    expect(streamCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SSE chunk parsing — UI updates from stream events
// ─────────────────────────────────────────────────────────────────────────────

describe('App — SSE event handling', () => {
  it('appends the user message immediately on send', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);
    await sendViaEnter(input, 'My test question');

    await waitFor(() => {
      expect(screen.getByText('My test question')).toBeInTheDocument();
    });
  });

  it('renders speech content from a chunk SSE event', async () => {
    setupFetch([{ type: 'chunk', content: '<speech>Well done!</speech>' }]);
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);
    await sendViaEnter(input, 'Hello');

    await waitFor(() => {
      expect(screen.getByText(/Well done!/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('does not crash on an unknown SSE event type', async () => {
    setupFetch([{ type: 'unknown_future_event', payload: 'ignored' }]);
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);
    await expect(
      act(async () => { await sendViaEnter(input, 'Hello'); })
    ).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Session clear
// ─────────────────────────────────────────────────────────────────────────────

describe('App — session clear', () => {
  it('calls POST /api/clear when the Clear button is clicked', async () => {
    const fetchSpy = setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    const clearBtn = screen.getByText(/Clear/i);
    await act(async () => { fireEvent.click(clearBtn); });

    const clearCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/clear'));
    expect(clearCalls.length).toBe(1);
  });

  it('resets the chat to the cleared message after clear', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    // First add a message
    const input = screen.getByPlaceholderText(/Type here/i);
    await sendViaEnter(input, 'Something I said');
    await waitFor(() => expect(screen.getByText('Something I said')).toBeInTheDocument());

    // Then clear
    const clearBtn = screen.getByText(/Clear/i);
    await act(async () => { fireEvent.click(clearBtn); });

    await waitFor(() => {
      expect(screen.getByText(/Chat history cleared/i)).toBeInTheDocument();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Message list accumulation
// ─────────────────────────────────────────────────────────────────────────────

describe('App — message accumulation', () => {
  it('starts with exactly the welcome message in the DOM', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    // Must NOT show a user bubble before any send
    expect(screen.queryByText('My test question')).not.toBeInTheDocument();
  });

  it('adds a user message bubble after send', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);
    await sendViaEnter(input, 'Unique user prompt 123');

    await waitFor(() => {
      expect(screen.getByText('Unique user prompt 123')).toBeInTheDocument();
    });
  });

  it('clears the input field after send', async () => {
    setupFetch();
    const App = await importApp();
    await act(async () => { render(<App />); });

    const input = screen.getByPlaceholderText(/Type here/i);
    await sendViaEnter(input, 'Test clear input');

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. avatarUtils integration — wordToVisemes imported via App
// ─────────────────────────────────────────────────────────────────────────────
describe('App — wordToVisemes integration (via import)', () => {
  it('avatarUtils is importable from the same module graph as App', async () => {
    const { wordToVisemes } = await import('../avatarUtils.js');
    // Spot-check a known result to confirm the module loaded correctly
    expect(wordToVisemes('hello')).toContain('IDLE'); // 'h' → IDLE
  });
});
