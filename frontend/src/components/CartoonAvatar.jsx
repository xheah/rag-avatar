/**
 * CartoonAvatar.jsx
 *
 * Phase 1: A cartoon SVG face whose mouth shape is driven by the `viseme` prop.
 * 8 viseme shapes are supported, with a CSS 60ms ease-out transition on the
 * mouth path for smooth interpolation between positions.
 *
 * Props:
 *   viseme   – one of: 'IDLE' | 'MBPV' | 'AH' | 'EE' | 'OO' | 'TH' | 'SH' | 'TSN'
 *   orbState – 'idle' | 'listening' | 'thinking' | 'speaking'  (drives eye expression)
 */

// SVG <path> d-attribute for each mouth viseme
const MOUTH = {
  IDLE: { d: 'M 32 63 Q 50 68 68 63',                     fill: 'none',    stroke: '#c0725a' },
  MBPV: { d: 'M 34 62 Q 50 62 66 62',                     fill: 'none',    stroke: '#c0725a' },
  AH:   { d: 'M 30 58 Q 50 82 70 58',                     fill: '#1a0808', stroke: '#a05040' },
  EE:   { d: 'M 24 61 Q 50 70 76 61',                     fill: '#1a0808', stroke: '#c0725a' },
  OO:   { d: 'M 38 57 Q 50 78 62 57',                     fill: '#1a0808', stroke: '#a05040' },
  TH:   { d: 'M 33 60 Q 50 72 67 60',                     fill: '#1a0808', stroke: '#c0725a' },
  SH:   { d: 'M 36 58 Q 50 74 64 58',                     fill: '#1a0808', stroke: '#a05040' },
  TSN:  { d: 'M 34 60 Q 50 70 66 60',                     fill: '#1a0808', stroke: '#c0725a' },
};

// Upper-lip arch for each viseme
const UPPER_LIP = {
  IDLE: 'M 32 63 Q 41 56 50 58 Q 59 56 68 63',
  MBPV: 'M 34 62 Q 42 56 50 58 Q 58 56 66 62',
  AH:   'M 30 58 Q 40 50 50 53 Q 60 50 70 58',
  EE:   'M 24 61 Q 37 53 50 56 Q 63 53 76 61',
  OO:   'M 38 57 Q 44 50 50 52 Q 56 50 62 57',
  TH:   'M 33 60 Q 41 53 50 56 Q 59 53 67 60',
  SH:   'M 36 58 Q 43 51 50 54 Q 57 51 64 58',
  TSN:  'M 34 60 Q 42 54 50 56 Q 58 54 66 60',
};

export function CartoonAvatar({ viseme = 'IDLE', orbState = 'idle' }) {
  const mouth  = MOUTH[viseme]  ?? MOUTH.IDLE;
  const upLip  = UPPER_LIP[viseme] ?? UPPER_LIP.IDLE;

  // Eye expression
  const eyeR      = orbState === 'thinking' ? 4.5 : 5.5;
  const pupilFill = orbState === 'thinking' ? '#7f1d1d' : '#1e293b';
  const browDip   = orbState === 'thinking' ? 3 : 0;   // inner brow raise for concern

  return (
    <svg
      viewBox="0 0 100 130"
      width="220"
      height="286"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="AI Sales Director avatar"
      className="drop-shadow-[0_12px_32px_rgba(0,0,0,0.5)] select-none"
    >
      {/* ── Suit / collar hint ─────────────────────────────── */}
      <path d="M 10 130 L 10 108 Q 30 100 50 104 Q 70 100 90 108 L 90 130 Z" fill="#1e3a5f" />
      {/* Shirt / tie */}
      <path d="M 40 104 Q 50 108 60 104 L 57 130 L 43 130 Z" fill="#f1f5f9" />
      <path d="M 50 106 L 46 120 L 50 124 L 54 120 Z" fill="#e11d48" />

      {/* ── Neck ───────────────────────────────────────────── */}
      <rect x="43" y="95" width="14" height="12" rx="3" fill="#f5c98e" />

      {/* ── Head ───────────────────────────────────────────── */}
      <ellipse cx="50" cy="54" rx="37" ry="44" fill="#f5c98e" stroke="#e2a567" strokeWidth="1" />

      {/* ── Hair ───────────────────────────────────────────── */}
      <ellipse cx="50" cy="16" rx="37" ry="16" fill="#2d1a07" />
      <rect    x="13" y="16" width="74" height="14" fill="#2d1a07" />
      {/* Side hairline curve */}
      <path d="M 13 22 Q 10 35 14 45" stroke="#2d1a07" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M 87 22 Q 90 35 86 45" stroke="#2d1a07" strokeWidth="6" fill="none" strokeLinecap="round" />

      {/* ── Ears ───────────────────────────────────────────── */}
      <ellipse cx="13" cy="57" rx="6.5" ry="8.5" fill="#f5c98e" stroke="#e2a567" strokeWidth="1" />
      <ellipse cx="87" cy="57" rx="6.5" ry="8.5" fill="#f5c98e" stroke="#e2a567" strokeWidth="1" />
      <ellipse cx="13" cy="57" rx="3.5" ry="5"   fill="#e8a86a" />
      <ellipse cx="87" cy="57" rx="3.5" ry="5"   fill="#e8a86a" />

      {/* ── Eyebrows ───────────────────────────────────────── */}
      <path
        d={`M 27 ${42 + browDip} Q 34 ${38 - browDip} 41 ${42 + browDip}`}
        stroke="#2d1a07" strokeWidth="2.2" fill="none" strokeLinecap="round"
      />
      <path
        d={`M 59 ${42 + browDip} Q 66 ${38 - browDip} 73 ${42 + browDip}`}
        stroke="#2d1a07" strokeWidth="2.2" fill="none" strokeLinecap="round"
      />

      {/* ── Eyes (whites) ──────────────────────────────────── */}
      <ellipse cx="34" cy="50" rx={eyeR} ry={eyeR * 0.9} fill="white" />
      <ellipse cx="66" cy="50" rx={eyeR} ry={eyeR * 0.9} fill="white" />

      {/* Iris */}
      <circle cx="34.5" cy="50.5" r="3.2" fill={pupilFill} />
      <circle cx="66.5" cy="50.5" r="3.2" fill={pupilFill} />
      {/* Pupils */}
      <circle cx="34.5" cy="50.5" r="1.6" fill="#000" />
      <circle cx="66.5" cy="50.5" r="1.6" fill="#000" />
      {/* Catchlights */}
      <circle cx="36"   cy="49"   r="0.9" fill="white" />
      <circle cx="68"   cy="49"   r="0.9" fill="white" />

      {/* ── Nose ───────────────────────────────────────────── */}
      <path d="M 47 67 Q 50 63 53 67" stroke="#d4956a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <ellipse cx="46.5" cy="68" rx="2.5" ry="1.5" fill="#e8a86a" opacity="0.6" />
      <ellipse cx="53.5" cy="68" rx="2.5" ry="1.5" fill="#e8a86a" opacity="0.6" />

      {/* ── Cheeks (blush) ─────────────────────────────────── */}
      <ellipse cx="24" cy="63" rx="8" ry="4" fill="#f87171" opacity="0.15" />
      <ellipse cx="76" cy="63" rx="8" ry="4" fill="#f87171" opacity="0.15" />

      {/* ── Mouth (animated) ───────────────────────────────── */}
      {/* Lower lip arc (the main animated path) */}
      <path
        d={mouth.d}
        stroke={mouth.stroke}
        strokeWidth="2.5"
        fill={mouth.fill}
        strokeLinecap="round"
        style={{ transition: 'all 60ms ease-out' }}
      />
      {/* Upper lip arch */}
      <path
        d={upLip}
        stroke="#c0725a"
        strokeWidth="1.8"
        fill={mouth.fill !== 'none' ? mouth.fill : 'none'}
        strokeLinecap="round"
        style={{ transition: 'all 60ms ease-out' }}
      />
      {/* Cupid's bow highlight */}
      <path d="M 44 59 Q 50 56 56 59" stroke="#f5c98e" strokeWidth="1" fill="none" opacity="0.5" />
    </svg>
  );
}
