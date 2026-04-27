/**
 * frontend/src/__tests__/useBlinkMachine.test.js
 * ------------------------------------------------
 * Unit tests for the stochastic blink state machine hook.
 *
 * Test coverage:
 *   - Initial state is 'O' (eyes open)
 *   - Full blink cycle transitions: O → HC → C → HA → O
 *   - All returned values are valid eye states
 *   - Timer cleanup on unmount (no lingering timeouts)
 *   - EYE_STATES export contains all valid states
 *   - Double-blink path
 *
 * NOTE: vi.advanceTimersByTime fires ALL timers that mature within the
 * window, including nested ones. So advancing by 6500ms also fires the
 * 60ms, 40ms, and 60ms nested timers — the state will have already
 * cycled back to 'O'. We use advanceTimersByTime(1) after an exact
 * advance to step through one timer at a time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlinkMachine, EYE_STATES } from '../useBlinkMachine';

const VALID_EYE_STATES = new Set(['O', 'HA', 'HC', 'C']);

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useBlinkMachine — initial state', () => {
  it('returns "O" (eyes open) as the initial state', () => {
    const { result } = renderHook(() => useBlinkMachine());
    expect(result.current).toBe('O');
  });
});

describe('useBlinkMachine — EYE_STATES export', () => {
  it('exports an array of all valid eye states', () => {
    expect(EYE_STATES).toEqual(['O', 'HA', 'HC', 'C']);
  });

  it('every EYE_STATE is a valid eye state string', () => {
    EYE_STATES.forEach(s => {
      expect(VALID_EYE_STATES.has(s)).toBe(true);
    });
  });
});

describe('useBlinkMachine — blink cycle (step-by-step)', () => {
  it('walks through each phase of a blink when timers are advanced individually', () => {
    // Fix the random interval to exactly 3000ms
    vi.spyOn(Math, 'random').mockReturnValue(0.25); // 2000 + 0.25*4000 = 3000ms

    const { result } = renderHook(() => useBlinkMachine());
    expect(result.current).toBe('O');

    // Step 1: Advance to just before the blink fires — still open
    act(() => { vi.advanceTimersByTime(2999); });
    expect(result.current).toBe('O');

    // Step 2: Advance 1ms more — blink trigger fires → HC
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('HC');

    // Step 3: HC → C after 60ms
    act(() => { vi.advanceTimersByTime(60); });
    expect(result.current).toBe('C');

    // Step 4: C → HA after 40ms
    act(() => { vi.advanceTimersByTime(40); });
    expect(result.current).toBe('HA');

    // Step 5: HA → O after 60ms
    act(() => { vi.advanceTimersByTime(60); });
    expect(result.current).toBe('O');

    Math.random.mockRestore();
  });

  it('only produces valid eye state values over multiple blinks', () => {
    // Fix random to 0.5 → interval = 4000ms, no double-blink (0.5 > 0.15)
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const { result } = renderHook(() => useBlinkMachine());
    const observedStates = new Set();
    observedStates.add(result.current);

    // Run through several complete blink cycles
    for (let i = 0; i < 5; i++) {
      // Advance to exact trigger point
      act(() => { vi.advanceTimersByTime(4000); });
      observedStates.add(result.current);
      act(() => { vi.advanceTimersByTime(60); });
      observedStates.add(result.current);
      act(() => { vi.advanceTimersByTime(40); });
      observedStates.add(result.current);
      act(() => { vi.advanceTimersByTime(60); });
      observedStates.add(result.current);
    }

    // All observed states must be valid
    observedStates.forEach(s => {
      expect(VALID_EYE_STATES.has(s)).toBe(true);
    });

    // Must have observed all 4 states
    expect(observedStates.size).toBe(4);

    Math.random.mockRestore();
  });
});

describe('useBlinkMachine — cleanup', () => {
  it('clears all timers on unmount (no lingering timeouts)', () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { unmount } = renderHook(() => useBlinkMachine());

    // Unmount should trigger cleanup
    unmount();

    // At least the initial scheduled timer should have been cleared
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('does not update state after unmount', () => {
    const { result, unmount } = renderHook(() => useBlinkMachine());
    unmount();

    // Advance timers well past any blink interval — should not throw
    expect(() => {
      act(() => { vi.advanceTimersByTime(10000); });
    }).not.toThrow();

    // State should still be valid (whatever it was at unmount)
    expect(VALID_EYE_STATES.has(result.current)).toBe(true);
  });
});

describe('useBlinkMachine — double-blink', () => {
  it('triggers a double-blink when Math.random < 0.15', () => {
    // Control random: interval = 3000ms, then double-blink on first check,
    // then no double-blink on second check.
    let callCount = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      callCount++;
      // Call 1: initial randomInterval()  → 0.25 → interval = 3000ms
      // Call 2: double-blink check        → 0.05 → YES (< 0.15)
      // Call 3: randomInterval() in double-blink retry → 0.25
      // Call 4+: 0.5 (no more double-blinks)
      if (callCount === 1) return 0.25;
      if (callCount === 2) return 0.05;
      if (callCount === 3) return 0.25;
      return 0.5;
    });

    const { result } = renderHook(() => useBlinkMachine());

    // First blink triggers at 3000ms
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe('HC');

    // Complete the first blink cycle step by step
    act(() => { vi.advanceTimersByTime(60); });  // HC → C
    expect(result.current).toBe('C');
    act(() => { vi.advanceTimersByTime(40); });  // C → HA
    expect(result.current).toBe('HA');
    act(() => { vi.advanceTimersByTime(60); });  // HA → O
    expect(result.current).toBe('O');

    // Double-blink triggers after 80ms pause
    act(() => { vi.advanceTimersByTime(80); });
    expect(result.current).toBe('HC'); // Second blink started!

    Math.random.mockRestore();
  });
});
