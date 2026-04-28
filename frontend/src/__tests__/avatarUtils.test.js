/**
 * frontend/src/__tests__/avatarUtils.test.js
 * -------------------------------------------
 * Unit tests for the IPA-to-Viseme converter in avatarUtils.js.
 *
 * Tests the mapping from Cartesia's IPA phonemes to the avatar's 8 visemes.
 */

import { describe, it, expect } from 'vitest';
import { ipaToViseme } from '../avatarUtils.js';

describe('ipaToViseme', () => {
  it('maps bilabials correctly', () => {
    expect(ipaToViseme('m')).toBe('MBPV');
    expect(ipaToViseme('b')).toBe('MBPV');
    expect(ipaToViseme('p')).toBe('MBPV');
  });

  it('maps labiodentals correctly', () => {
    expect(ipaToViseme('f')).toBe('FV');
    expect(ipaToViseme('v')).toBe('FV');
  });

  it('maps wide-open vowels correctly', () => {
    ['a', 'aɪ', 'aʊ', 'ɑ', 'æ', 'ʌ', 'ɔ'].forEach(p => {
      expect(ipaToViseme(p)).toBe('AH');
    });
  });

  it('maps spread vowels correctly', () => {
    ['e', 'eɪ', 'i', 'ɪ', 'ɛ'].forEach(p => {
      expect(ipaToViseme(p)).toBe('EE');
    });
  });

  it('maps rounded vowels correctly', () => {
    ['o', 'oʊ', 'u', 'ʊ', 'w'].forEach(p => {
      expect(ipaToViseme(p)).toBe('OO');
    });
  });

  it('maps dentals correctly', () => {
    expect(ipaToViseme('θ')).toBe('TH');
    expect(ipaToViseme('ð')).toBe('TH');
  });

  it('maps sibilants and affricates correctly', () => {
    ['ʃ', 'ʒ', 'tʃ', 'dʒ'].forEach(p => {
      expect(ipaToViseme(p)).toBe('SH');
    });
  });

  it('maps alveolar and velar consonants correctly', () => {
    ['t', 'd', 'n', 'l', 'ɹ', 's', 'z', 'k', 'ɡ', 'ŋ'].forEach(p => {
      expect(ipaToViseme(p)).toBe('TSN');
    });
  });

  it('returns IDLE for unknown or glottal sounds', () => {
    expect(ipaToViseme('h')).toBe('IDLE');
    expect(ipaToViseme('ʔ')).toBe('IDLE');
    expect(ipaToViseme('xyz')).toBe('IDLE'); // Unknown fallback
  });

  it('strips stress and length markers before mapping', () => {
    expect(ipaToViseme('ɑː')).toBe('AH'); // 'ː' length marker stripped
    expect(ipaToViseme('oʊ1')).toBe('OO'); // '1' stress marker stripped
  });
});
