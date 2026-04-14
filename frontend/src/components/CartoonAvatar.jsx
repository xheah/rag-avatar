/**
 * CartoonAvatar.jsx — v2 (polished)
 *
 * Key improvements over v1:
 *  - Expanded viewBox (200×260) for finer control
 *  - Radial gradient skin tone with subtle shadow/depth
 *  - Properly proportioned oval face
 *  - Refined eyes: iris gradient, eyelid shading, realistic catchlights
 *  - Soft natural eyebrows with tapered strokes
 *  - Clean lips: separate closed-lip shape that opens per viseme
 *  - Subtle nose (no harsh nostrils)
 *  - Hair with highlight band
 *  - Professional suit with lapels, shirt collar, and tie
 *
 * Props:
 *   viseme   – 'IDLE' | 'MBPV' | 'AH' | 'EE' | 'OO' | 'TH' | 'SH' | 'TSN'
 *   orbState – 'idle' | 'listening' | 'thinking' | 'speaking'
 */

// ─── Mouth viseme definitions ────────────────────────────────────────────────
// Each viseme specifies:
//  upperLip  — path for the upper lip (cupid's bow)
//  lowerLip  — path for the lower lip arc
//  open      — whether to show the dark mouth interior between the two lips
//  wide      — whether to show a teeth strip (for EE / AH)
const VISEMES = {
  IDLE: {
    upperLip: 'M 84 154 Q 92 149 100 151 Q 108 149 116 154',
    lowerLip: 'M 84 154 Q 100 160 116 154',
    open: false, wide: false,
  },
  MBPV: {
    upperLip: 'M 86 153 Q 93 150 100 151 Q 107 150 114 153',
    lowerLip: 'M 86 153 Q 100 155 114 153',
    open: false, wide: false,
  },
  AH: {
    upperLip: 'M 82 148 Q 91 142 100 144 Q 109 142 118 148',
    lowerLip: 'M 82 148 Q 100 170 118 148',
    open: true,  wide: true,
  },
  EE: {
    upperLip: 'M 78 150 Q 89 145 100 147 Q 111 145 122 150',
    lowerLip: 'M 78 150 Q 100 160 122 150',
    open: true,  wide: true,
  },
  OO: {
    upperLip: 'M 87 148 Q 94 142 100 143 Q 106 142 113 148',
    lowerLip: 'M 87 148 Q 100 165 113 148',
    open: true,  wide: false,
  },
  TH: {
    upperLip: 'M 83 150 Q 91 145 100 147 Q 109 145 117 150',
    lowerLip: 'M 83 150 Q 100 163 117 150',
    open: true,  wide: false,
  },
  SH: {
    upperLip: 'M 85 149 Q 92 143 100 145 Q 108 143 115 149',
    lowerLip: 'M 85 149 Q 100 162 115 149',
    open: true,  wide: false,
  },
  TSN: {
    upperLip: 'M 84 150 Q 92 145 100 147 Q 108 145 116 150',
    lowerLip: 'M 84 150 Q 100 161 116 150',
    open: true,  wide: false,
  },
};

export function CartoonAvatar({ viseme = 'IDLE', orbState = 'idle' }) {
  const vm = VISEMES[viseme] ?? VISEMES.IDLE;

  // Eye/brow expression changes
  const isThinking  = orbState === 'thinking';
  const isSpeaking  = orbState === 'speaking';
  const browInnerY  = isThinking ? 76 : 80;   // inner brow dips when thinking
  const browOuterY  = isThinking ? 82 : 82;
  const irisColor   = isThinking ? '#3b1f5e' : '#1a3a6b';
  const eyeScaleY   = isSpeaking ? 0.85 : 1;  // slight squint while speaking

  // Mouth interior clip path (between upper and lower lip)
  const mouthInterior = vm.open
    ? `${vm.upperLip} ${vm.lowerLip.replace(/^M \S+ \S+/, 'L 118 148').replace(/Q.*$/, '')}`
    : null;

  return (
    <svg
      viewBox="0 0 200 260"
      width="220"
      height="286"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="AI Sales Director avatar"
      className="drop-shadow-[0_16px_40px_rgba(0,0,0,0.6)] select-none"
    >
      <defs>
        {/* Skin gradient — warm light from upper-left */}
        <radialGradient id="skinGrad" cx="38%" cy="28%" r="68%">
          <stop offset="0%"   stopColor="#fde5c0" />
          <stop offset="60%"  stopColor="#f5c98e" />
          <stop offset="100%" stopColor="#d99a5f" />
        </radialGradient>

        {/* Skin shadow (under chin, beside nose) */}
        <radialGradient id="skinShadow" cx="50%" cy="100%" r="60%">
          <stop offset="0%"   stopColor="#c07a40" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#c07a40" stopOpacity="0" />
        </radialGradient>

        {/* Iris gradient */}
        <radialGradient id="irisGrad" cx="35%" cy="30%" r="65%">
          <stop offset="0%"   stopColor="#4a78c8" />
          <stop offset="100%" stopColor={irisColor} />
        </radialGradient>

        {/* Hair gradient */}
        <linearGradient id="hairGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#3d2a14" />
          <stop offset="100%" stopColor="#1e0f02" />
        </linearGradient>

        {/* Suit gradient */}
        <linearGradient id="suitGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#243f6a" />
          <stop offset="100%" stopColor="#152745" />
        </linearGradient>

        {/* Lip gradient */}
        <linearGradient id="lipGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#c96a5a" />
          <stop offset="100%" stopColor="#a84a3a" />
        </linearGradient>

        {/* Clip path for mouth interior */}
        <clipPath id="mouthClip">
          <path d={`${vm.upperLip} Q 100 165 ${vm.open ? '82 148' : '84 154'} Z`} />
        </clipPath>
      </defs>

      {/* ── Suit body ────────────────────────────────────────── */}
      <path
        d="M 0 260 L 0 200 Q 40 185 70 188 L 80 210 L 100 205 L 120 210 L 130 188 Q 160 185 200 200 L 200 260 Z"
        fill="url(#suitGrad)"
      />
      {/* Left lapel */}
      <path
        d="M 70 188 Q 60 195 55 210 Q 75 202 100 205"
        fill="#1a3055" stroke="#0f1f3a" strokeWidth="0.5"
      />
      {/* Right lapel */}
      <path
        d="M 130 188 Q 140 195 145 210 Q 125 202 100 205"
        fill="#1a3055" stroke="#0f1f3a" strokeWidth="0.5"
      />
      {/* Shirt */}
      <path
        d="M 80 210 L 100 205 L 120 210 L 115 260 L 85 260 Z"
        fill="#f0f4f8"
      />
      {/* Shirt collar - left */}
      <path d="M 80 210 L 94 195 L 100 205" fill="#e8edf3" stroke="#d0d8e4" strokeWidth="0.5" />
      {/* Shirt collar - right */}
      <path d="M 120 210 L 106 195 L 100 205" fill="#e8edf3" stroke="#d0d8e4" strokeWidth="0.5" />
      {/* Tie */}
      <path d="M 96 197 L 104 197 L 108 215 L 100 222 L 92 215 Z" fill="#c0152a" />
      {/* Tie knot */}
      <path d="M 96 197 Q 100 194 104 197 Q 100 200 96 197 Z" fill="#a01020" />
      {/* Tie highlight */}
      <path d="M 99 199 L 101 199 L 103 212 L 100 218 L 97 212 Z" fill="#d0243c" opacity="0.4" />

      {/* ── Neck ─────────────────────────────────────────────── */}
      <path
        d="M 86 190 Q 86 205 88 212 Q 94 215 100 215 Q 106 215 112 212 Q 114 205 114 190 Z"
        fill="url(#skinGrad)"
      />

      {/* ── Head ─────────────────────────────────────────────── */}
      <ellipse cx="100" cy="108" rx="78" ry="93" fill="url(#skinGrad)" />
      {/* Subtle chin / jaw shadow */}
      <ellipse cx="100" cy="185" rx="55" ry="22" fill="url(#skinShadow)" />
      {/* Side shadow (temples) */}
      <ellipse cx="22"  cy="108" rx="18" ry="40" fill="#c07a40" opacity="0.09" />
      <ellipse cx="178" cy="108" rx="18" ry="40" fill="#c07a40" opacity="0.09" />

      {/* ── Hair ─────────────────────────────────────────────── */}
      {/* Main hair mass */}
      <ellipse cx="100" cy="32"  rx="78" ry="32"  fill="url(#hairGrad)" />
      <rect    x="22"   y="30"   width="156" height="24" fill="url(#hairGrad)" />
      {/* Side sideburns */}
      <path d="M 22 46 Q 18 62 22 78"  stroke="#1e0f02" strokeWidth="12" fill="none" strokeLinecap="round" />
      <path d="M 178 46 Q 182 62 178 78" stroke="#1e0f02" strokeWidth="12" fill="none" strokeLinecap="round" />
      {/* Hair highlight — subtle sheen on top */}
      <ellipse cx="85" cy="22" rx="30" ry="9" fill="#5a3a1a" opacity="0.45" />

      {/* ── Ears ─────────────────────────────────────────────── */}
      {/* Left ear */}
      <ellipse cx="22" cy="115" rx="12" ry="16" fill="#f0bc80" stroke="#d99a5f" strokeWidth="1" />
      <path d="M 26 106 Q 32 115 26 124" stroke="#d99a5f" strokeWidth="1.5" fill="none" />
      {/* Right ear */}
      <ellipse cx="178" cy="115" rx="12" ry="16" fill="#f0bc80" stroke="#d99a5f" strokeWidth="1" />
      <path d="M 174 106 Q 168 115 174 124" stroke="#d99a5f" strokeWidth="1.5" fill="none" />

      {/* ── Eyebrows ──────────────────────────────────────────── */}
      {/* Left brow — tapered: thick outer, thin inner */}
      <path
        d={`M 54 ${browOuterY} Q 66 ${browInnerY} 80 ${browOuterY + 2}`}
        stroke="#2d1a07" strokeWidth="3.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round"
        opacity="0.92"
      />
      {/* Right brow */}
      <path
        d={`M 120 ${browOuterY + 2} Q 134 ${browInnerY} 146 ${browOuterY}`}
        stroke="#2d1a07" strokeWidth="3.5" fill="none"
        strokeLinecap="round" strokeLinejoin="round"
        opacity="0.92"
      />

      {/* ── Eyes ─────────────────────────────────────────────── */}
      {/* Left eye white */}
      <ellipse
        cx="67" cy="100"
        rx="14" ry={12 * eyeScaleY}
        fill="white"
      />
      {/* Left iris */}
      <circle cx="67" cy="100" r="8" fill="url(#irisGrad)" />
      {/* Left pupil */}
      <circle cx="67" cy="100" r="4" fill="#080818" />
      {/* Left catchlights */}
      <circle cx="70"  cy="96.5" r="2.2" fill="white" opacity="0.9" />
      <circle cx="63"  cy="103"  r="1"   fill="white" opacity="0.4" />
      {/* Left upper eyelid shadow */}
      <path
        d={`M 53 ${100 - 12 * eyeScaleY} Q 67 ${94 - 12 * eyeScaleY + 4} 81 ${100 - 12 * eyeScaleY}`}
        fill="#d99a5f" opacity="0.18"
      />
      {/* Left lower lash line */}
      <path d="M 53 104 Q 67 109 81 104" stroke="#c07a40" strokeWidth="0.8" fill="none" opacity="0.35" />

      {/* Right eye white */}
      <ellipse
        cx="133" cy="100"
        rx="14" ry={12 * eyeScaleY}
        fill="white"
      />
      {/* Right iris */}
      <circle cx="133" cy="100" r="8" fill="url(#irisGrad)" />
      {/* Right pupil */}
      <circle cx="133" cy="100" r="4" fill="#080818" />
      {/* Right catchlights */}
      <circle cx="136" cy="96.5" r="2.2" fill="white" opacity="0.9" />
      <circle cx="129" cy="103"  r="1"   fill="white" opacity="0.4" />
      {/* Right upper eyelid shadow */}
      <path
        d={`M 119 ${100 - 12 * eyeScaleY} Q 133 ${94 - 12 * eyeScaleY + 4} 147 ${100 - 12 * eyeScaleY}`}
        fill="#d99a5f" opacity="0.18"
      />
      {/* Right lower lash line */}
      <path d="M 119 104 Q 133 109 147 104" stroke="#c07a40" strokeWidth="0.8" fill="none" opacity="0.35" />

      {/* ── Nose ─────────────────────────────────────────────── */}
      {/* Nose bridge (very subtle) */}
      <path
        d="M 97 113 Q 94 128 96 137 Q 98 140 100 140 Q 102 140 104 137 Q 106 128 103 113"
        stroke="#d99a5f" strokeWidth="1.2" fill="none" opacity="0.5"
        strokeLinecap="round"
      />
      {/* Nose tip highlight */}
      <ellipse cx="100" cy="140" rx="4" ry="2.5" fill="#fde5c0" opacity="0.5" />

      {/* ── Cheek blush ───────────────────────────────────────── */}
      <ellipse cx="46"  cy="125" rx="18" ry="9" fill="#f87171" opacity="0.07" />
      <ellipse cx="154" cy="125" rx="18" ry="9" fill="#f87171" opacity="0.07" />

      {/* ── Mouth ─────────────────────────────────────────────── */}
      {/* Dark mouth interior when open */}
      {vm.open && (
        <path
          d={`${vm.upperLip} Q 100 172 ${vm.wide ? '82 150' : '84 154'}`}
          fill="#1a0808"
          style={{ transition: 'd 80ms ease-out' }}
        />
      )}
      {/* Teeth strip for wide-open vowels (EE / AH) */}
      {vm.open && vm.wide && (
        <rect
          x="86" y="151" width="28" height="7" rx="2"
          fill="#f5f5f5"
          style={{ transition: 'all 80ms ease-out' }}
        />
      )}
      {/* Upper lip */}
      <path
        d={vm.upperLip}
        stroke="url(#lipGrad)"
        strokeWidth="3"
        fill={vm.open ? '#c96a5a' : 'none'}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'd 80ms ease-out' }}
      />
      {/* Lower lip */}
      <path
        d={vm.lowerLip}
        stroke="url(#lipGrad)"
        strokeWidth="3.5"
        fill={vm.open ? '#b85848' : 'none'}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'd 80ms ease-out' }}
      />
      {/* Lower lip highlight */}
      {!vm.open && (
        <path
          d="M 90 154 Q 100 158 110 154"
          stroke="#fde5c0" strokeWidth="1.2" fill="none" opacity="0.4"
          strokeLinecap="round"
        />
      )}
      {/* Mouth corner dimples */}
      <circle cx={vm.open ? '82' : '84'} cy="154" r="1.5" fill="#c07a40" opacity="0.35" style={{ transition: 'all 80ms ease-out' }} />
      <circle cx={vm.open ? '118' : '116'} cy="154" r="1.5" fill="#c07a40" opacity="0.35" style={{ transition: 'all 80ms ease-out' }} />
    </svg>
  );
}
