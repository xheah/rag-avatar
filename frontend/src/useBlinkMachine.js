/**
 * useBlinkMachine.js — Stochastic Eye-Blink State Machine
 *
 * Drives the avatar's eye state independently from the TTS-driven mouth.
 *
 * State machine:
 *   OPEN  ─(random 2-6s)─→  HALF_CLOSED  ─(60ms)─→  CLOSED
 *     ↑                                                  │
 *     └───── HALF_OPEN ←──────────(40ms)─────────────────┘
 *
 * Eye state values match sprite sheet rows:
 *   'O'  → row 0 (Open-Eye)
 *   'HA' → row 1 (Half-Opened-Eye)
 *   'HC' → row 2 (Half-Closed-Eye)
 *   'C'  → row 3 (Closed-Eye)
 *
 * Double-blink: 15% chance of retriggering immediately after opening.
 *
 * Anti-flicker: all transitions use discrete setTimeout chains (not CSS
 * transitions) so each eye state renders exactly one frame — no partial
 * or interpolated renders.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/** Valid eye states (exported for testing). */
export const EYE_STATES = ['O', 'HA', 'HC', 'C'];

/** Blink timing constants (ms). */
const BLINK_MIN_INTERVAL = 2000;
const BLINK_MAX_INTERVAL = 6000;
const PHASE_CLOSE_1 = 30;   // O → HC
const PHASE_CLOSE_2 = 30;   // HC → C
const PHASE_OPEN_1  = 30;   // C → HA
const PHASE_OPEN_2  = 30;   // HA → O
const DOUBLE_BLINK_CHANCE = 0.15;

function randomInterval() {
  return BLINK_MIN_INTERVAL + Math.random() * (BLINK_MAX_INTERVAL - BLINK_MIN_INTERVAL);
}

/**
 * Custom hook that manages a stochastic blink cycle.
 * @returns {string} Current eye state: 'O' | 'HA' | 'HC' | 'C'
 */
export function useBlinkMachine() {
  const [eyeState, setEyeState] = useState('O');
  const timersRef = useRef([]);

  // Helper to schedule a timeout and track it for cleanup
  const schedule = useCallback((fn, delay) => {
    const id = setTimeout(fn, delay);
    timersRef.current.push(id);
    return id;
  }, []);

  // Clear all pending timers
  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(id => clearTimeout(id));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    let mounted = true;

    function triggerBlink() {
      if (!mounted) return;

      // Phase 1: O → HC (half-closed)
      setEyeState('HC');

      schedule(() => {
        if (!mounted) return;
        // Phase 2: HC → C (fully closed)
        setEyeState('C');

        schedule(() => {
          if (!mounted) return;
          // Phase 3: C → HA (half-open)
          setEyeState('HA');

          schedule(() => {
            if (!mounted) return;
            // Phase 4: HA → O (fully open)
            setEyeState('O');

            // Double-blink check: 15% chance to re-blink immediately
            if (Math.random() < DOUBLE_BLINK_CHANCE) {
              schedule(() => {
                if (!mounted) return;
                triggerBlink();
              }, 20); // brief pause before double-blink
            } else {
              // Schedule next blink at a random interval
              schedule(triggerBlink, randomInterval());
            }
          }, PHASE_OPEN_2);
        }, PHASE_OPEN_1);
      }, PHASE_CLOSE_1);

      // Close phase 2 comes after close phase 1
      // (nested inside the setTimeout chain above)
    }

    // Start the first blink after a random delay
    schedule(triggerBlink, randomInterval());

    return () => {
      mounted = false;
      clearAllTimers();
    };
  }, [schedule, clearAllTimers]);

  return eyeState;
}
