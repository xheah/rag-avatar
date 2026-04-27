/**
 * avatarUtils.js
 *
 * Grapheme-to-Viseme (G2V) converter.
 * Converts an English word into an ordered list of viseme IDs using
 * digraph + single-letter rules. Visemes are then distributed proportionally
 * across the word's Cartesia word_timestamps window for lip-sync animation.
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

export function wordToVisemes(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w.length) return ['IDLE'];

  const visemes = [];
  let i = 0;

  while (i < w.length) {
    const tri = w.slice(i, i + 3);
    const di  = w.slice(i, i + 2);
    const c   = w[i];

    // ── Trigraphs ──────────────────────────────────────────
    if (tri === 'tch') { visemes.push('SH');   i += 3; continue; }

    // ── Digraphs ───────────────────────────────────────────
    if (di === 'th')   { visemes.push('TH');   i += 2; continue; }
    if (di === 'sh')   { visemes.push('SH');   i += 2; continue; }
    if (di === 'ch')   { visemes.push('SH');   i += 2; continue; }
    if (di === 'zh')   { visemes.push('SH');   i += 2; continue; }
    if (di === 'ph')   { visemes.push('FV');   i += 2; continue; }
    if (di === 'wh')   { visemes.push('OO');   i += 2; continue; }
    if (di === 'ng')   { visemes.push('TSN');  i += 2; continue; }
    if (di === 'ee')   { visemes.push('EE');   i += 2; continue; }
    if (di === 'ea')   { visemes.push('EE');   i += 2; continue; }
    if (di === 'oo')   { visemes.push('OO');   i += 2; continue; }
    if (di === 'ou')   { visemes.push('OO');   i += 2; continue; }
    if (di === 'ow')   { visemes.push('OO');   i += 2; continue; }
    if (di === 'aw')   { visemes.push('AH');   i += 2; continue; }
    if (di === 'au')   { visemes.push('AH');   i += 2; continue; }
    if (di === 'ai')   { visemes.push('EE');   i += 2; continue; }
    if (di === 'ay')   { visemes.push('EE');   i += 2; continue; }

    // ── Single characters ──────────────────────────────────
    switch (c) {
      // Bilabials
      case 'b': case 'p': case 'm':
        visemes.push('MBPV'); break;
      // Labiodentals
      case 'f': case 'v':
        visemes.push('FV'); break;
      // Wide-open vowel
      case 'a':
        visemes.push('AH'); break;
      // Front / spread vowels + glides
      case 'e': case 'i': case 'y':
        visemes.push('EE'); break;
      // Rounded vowels + glide
      case 'o': case 'u': case 'w':
        visemes.push('OO'); break;
      // Alveolar stops, nasals, liquids, fricatives
      case 't': case 'd': case 'n': case 'l':
      case 'r': case 's': case 'z':
        visemes.push('TSN'); break;
      // Velars
      case 'k': case 'c': case 'g': case 'q': case 'x':
        visemes.push('TSN'); break;
      // Affricate
      case 'j':
        visemes.push('SH'); break;
      // Glottal / breath
      case 'h':
        visemes.push('IDLE'); break;
      default:
        visemes.push('IDLE');
    }
    i++;
  }

  // Deduplicate consecutive identical visemes to avoid jitter
  return visemes.filter((v, idx, arr) => idx === 0 || v !== arr[idx - 1]);
}
