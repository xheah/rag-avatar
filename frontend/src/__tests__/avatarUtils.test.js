/**
 * frontend/src/__tests__/avatarUtils.test.js
 * -------------------------------------------
 * Layer 5 — Unit tests for the Grapheme-to-Viseme (G2V) converter in
 * avatarUtils.js.
 *
 * `wordToVisemes` is a pure function with no React / DOM dependency so it
 * runs instantly in jsdom without any mocks.
 *
 * Test coverage
 *   - Empty / punctuation-only → ['IDLE']
 *   - Trigraph  "tch"  → SH
 *   - Digraphs  th, sh, ch, zh, ph, wh, ng, ee, ea, oo, ou, ow, aw, au, ai, ay
 *   - Single-letter categories (MBPV, AH, EE, OO, TSN, SH, IDLE)
 *   - Deduplication of consecutive identical visemes
 *   - Return type is always a non-empty array of strings
 *   - Case-insensitive input
 *   - Punctuation stripped before processing
 */

import { describe, it, expect } from 'vitest';
import { wordToVisemes } from '../avatarUtils.js';

// ─── Helper ────────────────────────────────────────────────────────────────

/** All valid viseme IDs produced by the function. */
const VALID_VISEMES = new Set(['IDLE', 'MBPV', 'FV', 'AH', 'EE', 'OO', 'TH', 'SH', 'TSN']);

function assertValidVisemes(arr) {
  expect(Array.isArray(arr)).toBe(true);
  expect(arr.length).toBeGreaterThan(0);
  arr.forEach(v => expect(VALID_VISEMES.has(v)).toBe(true));
}

// ─── Empty / degenerate inputs ─────────────────────────────────────────────

describe('wordToVisemes — empty / degenerate inputs', () => {
  it('returns ["IDLE"] for an empty string', () => {
    expect(wordToVisemes('')).toEqual(['IDLE']);
  });

  it('returns ["IDLE"] for a whitespace-only string', () => {
    // Non-alpha characters are stripped; result is the same as empty
    expect(wordToVisemes('   ')).toEqual(['IDLE']);
  });

  it('returns ["IDLE"] for punctuation-only', () => {
    expect(wordToVisemes('...')).toEqual(['IDLE']);
    expect(wordToVisemes('!?')).toEqual(['IDLE']);
    expect(wordToVisemes(',')).toEqual(['IDLE']);
  });

  it('does not throw on any single character', () => {
    'abcdefghijklmnopqrstuvwxyz'.split('').forEach(c => {
      expect(() => wordToVisemes(c)).not.toThrow();
    });
  });
});

// ─── Trigraph ──────────────────────────────────────────────────────────────

describe('wordToVisemes — trigraph "tch"', () => {
  it('"tch" maps to SH', () => {
    const v = wordToVisemes('tch');
    expect(v[0]).toBe('SH');
  });

  it('"watch" contains SH from the "tch" trigraph', () => {
    expect(wordToVisemes('watch')).toContain('SH');
  });

  it('"catch" contains SH', () => {
    expect(wordToVisemes('catch')).toContain('SH');
  });
});

// ─── Digraphs ──────────────────────────────────────────────────────────────

describe('wordToVisemes — digraphs', () => {
  it('"th" → TH', () => {
    const v = wordToVisemes('the');
    expect(v[0]).toBe('TH');
  });

  it('"sh" → SH', () => {
    expect(wordToVisemes('she')).toContain('SH');
    const first = wordToVisemes('sh')[0];
    expect(first).toBe('SH');
  });

  it('"ch" → SH (affricate)', () => {
    const v = wordToVisemes('ch');
    expect(v[0]).toBe('SH');
  });

  it('"zh" → SH', () => {
    expect(wordToVisemes('zh')[0]).toBe('SH');
  });

  it('"ph" → FV (labiodental)', () => {
    expect(wordToVisemes('ph')[0]).toBe('FV');
  });

  it('"wh" → OO', () => {
    expect(wordToVisemes('wh')[0]).toBe('OO');
  });

  it('"ng" → TSN', () => {
    expect(wordToVisemes('ng')[0]).toBe('TSN');
    expect(wordToVisemes('sing')).toContain('TSN');
  });

  it('"ee" → EE', () => {
    expect(wordToVisemes('ee')[0]).toBe('EE');
    expect(wordToVisemes('bee')).toContain('EE');
  });

  it('"ea" → EE', () => {
    expect(wordToVisemes('ea')[0]).toBe('EE');
    expect(wordToVisemes('beat')).toContain('EE');
  });

  it('"oo" → OO', () => {
    expect(wordToVisemes('oo')[0]).toBe('OO');
    expect(wordToVisemes('boot')).toContain('OO');
  });

  it('"ou" → OO', () => {
    expect(wordToVisemes('ou')[0]).toBe('OO');
  });

  it('"ow" → OO', () => {
    expect(wordToVisemes('ow')[0]).toBe('OO');
    expect(wordToVisemes('show')).toContain('OO');
  });

  it('"aw" → AH', () => {
    expect(wordToVisemes('aw')[0]).toBe('AH');
    expect(wordToVisemes('law')).toContain('AH');
  });

  it('"au" → AH', () => {
    expect(wordToVisemes('au')[0]).toBe('AH');
  });

  it('"ai" → EE', () => {
    expect(wordToVisemes('ai')[0]).toBe('EE');
    expect(wordToVisemes('rain')).toContain('EE');
  });

  it('"ay" → EE', () => {
    expect(wordToVisemes('ay')[0]).toBe('EE');
    expect(wordToVisemes('day')).toContain('EE');
  });
});

// ─── Single-character mappings ─────────────────────────────────────────────

describe('wordToVisemes — single characters', () => {
  // Bilabials → MBPV
  ['b', 'p', 'm'].forEach(c => {
    it(`"${c}" → MBPV`, () => {
      expect(wordToVisemes(c)).toContain('MBPV');
    });
  });

  // Labiodentals → FV
  ['f', 'v'].forEach(c => {
    it(`"${c}" → FV`, () => {
      expect(wordToVisemes(c)).toContain('FV');
    });
  });

  // Wide-open vowel → AH
  it('"a" → AH', () => {
    expect(wordToVisemes('a')).toEqual(['AH']);
  });

  // Spread/front vowels → EE
  ['e', 'i', 'y'].forEach(c => {
    it(`"${c}" → EE`, () => {
      expect(wordToVisemes(c)).toContain('EE');
    });
  });

  // Rounded vowels → OO
  ['o', 'u', 'w'].forEach(c => {
    it(`"${c}" → OO`, () => {
      expect(wordToVisemes(c)).toContain('OO');
    });
  });

  // Alveolars / velars → TSN
  ['t', 'd', 'n', 'l', 'r', 's', 'z', 'k', 'c', 'g', 'q', 'x'].forEach(c => {
    it(`"${c}" → TSN`, () => {
      expect(wordToVisemes(c)).toContain('TSN');
    });
  });

  // Affricate → SH
  it('"j" → SH', () => {
    expect(wordToVisemes('j')).toEqual(['SH']);
  });

  // Glottal → IDLE
  it('"h" → IDLE', () => {
    expect(wordToVisemes('h')).toEqual(['IDLE']);
  });
});

// ─── Deduplication ─────────────────────────────────────────────────────────

describe('wordToVisemes — consecutive deduplication', () => {
  it('deduplicates "mm" → single MBPV', () => {
    const v = wordToVisemes('mm');
    expect(v.filter(x => x === 'MBPV').length).toBe(1);
  });

  it('deduplicates "ss" → single TSN', () => {
    const v = wordToVisemes('ss');
    expect(v.filter(x => x === 'TSN').length).toBe(1);
  });

  it('does NOT deduplicate non-consecutive duplicates', () => {
    // "mama" → MBPV, AH, MBPV, AH — alternating, no dedup
    const v = wordToVisemes('mama');
    expect(v).toEqual(['MBPV', 'AH', 'MBPV', 'AH']);
  });

  it('result never has two identical visemes in a row', () => {
    const words = ['hello', 'balloon', 'sitting', 'winning', 'success'];
    words.forEach(w => {
      const v = wordToVisemes(w);
      for (let i = 1; i < v.length; i++) {
        expect(v[i]).not.toBe(v[i - 1]);
      }
    });
  });
});

// ─── Return type invariants ─────────────────────────────────────────────────

describe('wordToVisemes — return type invariants', () => {
  it('always returns a non-empty array', () => {
    ['hello', 'world', 'a', 'SPIN', 'selling', ''].forEach(w => {
      const v = wordToVisemes(w);
      expect(Array.isArray(v)).toBe(true);
      expect(v.length).toBeGreaterThan(0);
    });
  });

  it('every element is a valid viseme ID string', () => {
    ['hello', 'world', 'this', 'should', 'be', 'fine'].forEach(w => {
      assertValidVisemes(wordToVisemes(w));
    });
  });
});

// ─── Case normalisation ─────────────────────────────────────────────────────

describe('wordToVisemes — case normalisation', () => {
  it('is case-insensitive (uppercase "TH" produces same result as "th")', () => {
    expect(wordToVisemes('TH')).toEqual(wordToVisemes('th'));
  });

  it('"HELLO" and "hello" produce the same viseme array', () => {
    expect(wordToVisemes('HELLO')).toEqual(wordToVisemes('hello'));
  });
});

// ─── Punctuation stripping ──────────────────────────────────────────────────

describe('wordToVisemes — punctuation stripping', () => {
  it('"hello," strips the comma and returns same as "hello"', () => {
    expect(wordToVisemes('hello,')).toEqual(wordToVisemes('hello'));
  });

  it('"world." strips the period', () => {
    expect(wordToVisemes('world.')).toEqual(wordToVisemes('world'));
  });

  it('does not throw for mixed punctuation', () => {
    expect(() => wordToVisemes("it's")).not.toThrow();
    expect(() => wordToVisemes("don't")).not.toThrow();
  });
});

// ─── Real-word smoke tests ──────────────────────────────────────────────────

describe('wordToVisemes — real-word smoke tests', () => {
  const words = [
    'sales', 'training', 'scenario', 'objection',
    'handling', 'closing', 'pitch', 'rapport',
  ];

  words.forEach(word => {
    it(`"${word}" returns valid visemes`, () => {
      assertValidVisemes(wordToVisemes(word));
    });
  });
});
