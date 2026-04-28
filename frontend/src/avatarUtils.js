/**
 * avatarUtils.js
 *
 * IPA-to-Viseme converter.
 * Converts Cartesia's exact phoneme output (IPA) into viseme IDs for lip-sync.
 *
 * Viseme set (8 shapes):
 *   IDLE  – rest / closed mouth
 *   MBPV  – bilabial closure  (m, b, p)
 *   FV    – labiodental       (f, v, ph)
 *   AH    – wide open         (a, ah, aw, au)
 *   EE    – spread smile      (e, i, ee, ea, ai, ay)
 *   OO    – rounded pucker    (o, u, oo, ou, ow, w)
 *   TH    – dental            (th)
 *   SH    – sibilant forward  (sh, ch, zh, j, tch)
 *   TSN   – alveolar close    (t, d, n, l, r, s, z, k, c, g, x, q, ng)
 */

export function ipaToViseme(phoneme) {
  // Remove stress markers or length markers if any (like ː or ˑ or numeric stresses)
  const cleanPhoneme = phoneme.replace(/[ːˑ0-9]/g, '');
  return IPA_TO_VISEME[cleanPhoneme] || 'IDLE';
}

const IPA_TO_VISEME = {
  // Bilabials
  'm': 'MBPV', 'b': 'MBPV', 'p': 'MBPV',
  
  // Labiodentals
  'f': 'FV', 'v': 'FV',
  
  // Wide-open vowels
  'a': 'AH', 'aɪ': 'AH', 'aʊ': 'AH', 'ɑ': 'AH', 'æ': 'AH', 'ʌ': 'AH', 'ɔ': 'AH', 'ɒ': 'AH',
  
  // Spread vowels + glides
  'e': 'EE', 'eɪ': 'EE', 'i': 'EE', 'ɪ': 'EE', 'ɛ': 'EE', 'j': 'EE', 'y': 'EE',
  
  // Rounded vowels + glides
  'o': 'OO', 'oʊ': 'OO', 'u': 'OO', 'ʊ': 'OO', 'w': 'OO', 'ɔɪ': 'OO',
  
  // Dental
  'θ': 'TH', 'ð': 'TH', 'ð\u031e': 'TH',
  
  // Sibilant / Affricate
  'ʃ': 'SH', 'ʒ': 'SH', 'tʃ': 'SH', 'dʒ': 'SH',
  
  // Alveolar close / Velars / Schwa
  't': 'TSN', 'd': 'TSN', 'n': 'TSN', 'l': 'TSN', 'ɹ': 'TSN', 'r': 'TSN', 
  's': 'TSN', 'z': 'TSN', 'k': 'TSN', 'ɡ': 'TSN', 'g': 'TSN', 'ŋ': 'TSN', 
  'x': 'TSN', 'ɾ': 'TSN', 'ə': 'TSN', 'ɚ': 'TSN', 'ɜ': 'TSN',
  
  // Glottal / Breath
  'h': 'IDLE', 'ʔ': 'IDLE'
};

