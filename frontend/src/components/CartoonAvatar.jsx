/**
 * CartoonAvatar.jsx — v3 (The Sovereign Strategist)
 * 
 * Refined via Stitch Design System "Executive Blueprint"
 * Vibe: Authoritative, Intelligent, Sovereign.
 * 
 * Improvements:
 * - Architectural Geometry: Perfectly smooth vector paths.
 * - Tonal Layering: Depth via skin-tone gradients, no harsh black borders.
 * - Executive Palette: Navy (#00236f), Power Red (#b6191a), Slate Gray (#475569).
 * - Glassmorphism: Subtle specular highlights on eyes and hair.
 */

const VISEMES = {
  IDLE: {
    up: 'M 88 152 Q 100 148 112 152',
    lo: 'M 88 152 Q 100 156 112 152',
    open: false, wide: false,
  },
  MBPV: {
    up: 'M 90 151 Q 100 149 110 151',
    lo: 'M 90 151 Q 100 153 110 151',
    open: false, wide: false,
  },
  AH: {
    up: 'M 85 146 Q 100 140 115 146',
    lo: 'M 85 146 Q 100 168 115 146',
    open: true, wide: true,
  },
  EE: {
    up: 'M 82 148 Q 100 144 118 148',
    lo: 'M 82 148 Q 100 158 118 148',
    open: true, wide: true,
  },
  OO: {
    up: 'M 92 146 Q 100 140 108 146',
    lo: 'M 92 146 Q 100 164 108 146',
    open: true, wide: false,
  },
  TH: {
    up: 'M 86 148 Q 100 144 114 148',
    lo: 'M 86 148 Q 100 160 114 148',
    open: true, wide: false,
  },
  SH: {
    up: 'M 88 147 Q 100 142 112 147',
    lo: 'M 88 147 Q 100 159 112 147',
    open: true, wide: false,
  },
  TSN: {
    up: 'M 87 148 Q 100 144 113 148',
    lo: 'M 87 148 Q 100 158 113 148',
    open: true, wide: false,
  },
};

export function CartoonAvatar({ viseme = 'IDLE', orbState = 'idle' }) {
  const vm = VISEMES[viseme] ?? VISEMES.IDLE;
  const isThinking = orbState === 'thinking';
  const isSpeaking = orbState === 'speaking';

  // Sovereign Animation States
  const eyeSquint = isSpeaking ? 0.9 : 1;
  const browDip = isThinking ? 5 : 0;
  const pupilGlow = isThinking ? '#6366f1' : '#1e3a8a'; // Subtle shift during "processing"

  return (
    <svg
      viewBox="0 0 200 240"
      width="240"
      height="288"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-[0_20px_50px_rgba(0,0,0,0.4)] transition-all duration-500"
    >
      <defs>
        {/* The Sovereign Strategist Gradients */}
        <radialGradient id="faceGrad" cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fff5eb" />
          <stop offset="60%" stopColor="#f9dcc4" />
          <stop offset="100%" stopColor="#e8b894" />
        </radialGradient>

        <linearGradient id="suitGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00236f" />
          <stop offset="100%" stopColor="#00184d" />
        </linearGradient>

        <radialGradient id="eyeGrad" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f0f4f8" />
        </radialGradient>

        <clipPath id="mouthMask">
          <path d={`${vm.up} L 115 168 L 85 168 Z`} />
        </clipPath>
      </defs>

      {/* ── Suit & Body (Professional/Tailored) ────────────────── */}
      <path
        d="M 10 240 L 10 205 Q 40 190 70 195 L 85 220 L 100 215 L 115 220 L 130 195 Q 160 190 190 205 L 190 240 Z"
        fill="url(#suitGrad)"
      />
      {/* Power Red Tie */}
      <path d="M 94 205 L 106 205 L 110 235 L 100 240 L 90 235 Z" fill="#b6191a" />
      <path d="M 94 205 Q 100 200 106 205 Q 100 210 94 205 Z" fill="#921415" />
      {/* Shirt Collar */}
      <path d="M 80 212 L 100 208 L 120 212 L 110 198 L 90 198 Z" fill="#ffffff" />

      {/* ── Head ─────────────────────────────────────────────── */}
      <rect x="88" y="190" width="24" height="25" fill="#f9dcc4" /> {/* neck */}
      <ellipse cx="100" cy="115" rx="72" ry="85" fill="url(#faceGrad)" />

      {/* Architectural Hair (Sharp & Modern) */}
      <path
        d="M 30 110 Q 25 70 45 40 Q 70 15 100 15 Q 130 15 155 40 Q 175 70 170 110"
        stroke="#1a1a1a" strokeWidth="24" fill="none" strokeLinecap="round"
      />
      <path
        d="M 45 40 Q 100 25 155 40"
        stroke="#262626" strokeWidth="12" fill="none" opacity="0.4"
      />

      {/* ── Facial Features (Sovereign Archetype) ─────────────── */}

      {/* High-Contrast Eyebrows */}
      <path
        d={`M 55 ${85 + browDip} Q 70 ${78 + browDip} 82 ${85 + browDip}`}
        stroke="#1a1a1a" strokeWidth="4" fill="none" strokeLinecap="round"
      />
      <path
        d={`M 118 ${85 + browDip} Q 130 ${78 + browDip} 145 ${85 + browDip}`}
        stroke="#1a1a1a" strokeWidth="4" fill="none" strokeLinecap="round"
      />

      {/* Intelligent Eyes */}
      <g style={{ transition: 'all 0.3s ease-out' }}>
        <ellipse cx="68" cy="110" rx="15" ry={12 * eyeSquint} fill="url(#eyeGrad)" />
        <circle cx="68" cy="110" r="7" fill={pupilGlow} />
        <circle cx="68" cy="110" r="3" fill="#000" />
        <circle cx="72" cy="106" r="2" fill="#fff" opacity="0.8" /> {/* spec highlight */}

        <ellipse cx="132" cy="110" rx="15" ry={12 * eyeSquint} fill="url(#eyeGrad)" />
        <circle cx="132" cy="110" r="7" fill={pupilGlow} />
        <circle cx="132" cy="110" r="3" fill="#000" />
        <circle cx="136" cy="106" r="2" fill="#fff" opacity="0.8" />
      </g>

      {/* Refined Nose bridge */}
      <path
        d="M 96 120 Q 100 148 104 120"
        stroke="#e8b894" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6"
      />

      {/* ── Dynamic Lip-Sync Mouth ───────────────────────────── */}
      <g style={{ transition: 'all 80ms cubic-bezier(0.3, 0, 0.1, 1)' }}>
        {/* Mouth cavity (shadow interior) */}
        {vm.open && (
          <path
            d={`${vm.up} Q 100 170 ${vm.wide ? '85 146' : '92 146'} Z`}
            fill="#1a0808"
          />
        )}
        {/* Teeth edge (clean executive smile) */}
        {vm.open && vm.wide && (
          <path d="M 88 150 Q 100 148 112 150" stroke="#f1f5f9" strokeWidth="4" fill="none" opacity="0.9" />
        )}
        {/* Upper Lip */}
        <path d={vm.up} stroke="#a84a3a" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Lower Lip */}
        <path d={vm.lo} stroke="#a84a3a" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      </g>

      {/* Tonal detail: Cheek highlights for "Life" */}
      <circle cx="50" cy="135" r="10" fill="#f87171" opacity="0.05" />
      <circle cx="150" cy="135" r="10" fill="#f87171" opacity="0.05" />
    </svg>
  );
}

// Phase 2A Realistic Avatar 
// Renders the specific PNG frame based on the active viseme
export function LifelikeAvatar({ viseme = 'IDLE', orbState = 'idle' }) {
  // Ensure the viseme maps correctly to the files generated
  const frameSrc = `/avatar/avatar-${viseme}.png`;

  // Scale pulse animation when speaking
  const transformClass = orbState === 'speaking' ? 'scale-[1.01]' : 'scale-100';

  return (
    <div className={`relative w-[256px] h-[340px] rounded-full overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)] border-4 border-indigo-500/20 transition-transform duration-100 ease-in-out ${transformClass}`}>
      <img 
        src={frameSrc} 
        alt={`Avatar viseme: ${viseme}`}
        className="absolute top-[-50px] w-full h-[512px] object-cover transition-opacity duration-75"
      />
    </div>
  );
}

// Phase 3 — Frame-Based Avatar with Blink State Machine
// Uses a 9-column × 4-row WebP sprite sheet.
//   Columns = mouth shapes (driven by TTS visemes)
//   Rows    = eye states   (driven by useBlinkMachine)
// By shifting backgroundPosition in 2D, the browser instantly swaps both
// the mouth and eye state without any decoding overhead.

import { useEffect } from 'react';

/** Mouth column mapping — 9 viseme IDs → column index (0-8). */
const MOUTH_COL = {
  IDLE: 0,
  MBPV: 1,
  AH:   2,
  EE:   3,
  TSN:  4,
  OO:   5,
  TH:   6,
  SH:   7,
  FV:   8,
};

/** Eye row mapping — 4 eye states → row index (0-3). */
const EYE_ROW = {
  O:  0,  // Open
  HA: 1,  // Half-Opened
  HC: 2,  // Half-Closed
  C:  3,  // Closed
};

const NUM_COLS = 9;
const NUM_ROWS = 4;
const SPRITESHEET_URL = '/nathan_avatar_spritesheet.webp';

// Source frame dimensions — used to compute correct aspect ratio
const FRAME_W = 1080;
const FRAME_H = 1920;
const CONTAINER_SIZE = 380;

// Each cell's rendered dimensions when width fills the container
const CELL_W = CONTAINER_SIZE; // 380px
const CELL_H = CONTAINER_SIZE * (FRAME_H / FRAME_W); // ≈ 676px (preserves 9:16)

// Shift upward from dead-center to show more of the face/head area
const Y_CENTER_OFFSET = (CELL_H - CONTAINER_SIZE) * 0.35;

export function PhotorealisticAvatar({ viseme = 'IDLE', eyeState = 'O', orbState = 'idle' }) {
  const col = MOUTH_COL[viseme] ?? 0;
  const row = EYE_ROW[eyeState] ?? 0;

  // Pixel-based positioning:
  //   x: slide to the correct column
  //   y: slide to the correct row, then center vertically within the viewport
  const xPos = -(col * CELL_W);
  const yPos = -(row * CELL_H + Y_CENTER_OFFSET);

  // Scale pulse animation when speaking to give slight life breathing
  const transformClass = orbState === 'speaking' ? 'scale-[1.01]' : 'scale-100';

  // Preload the sprite sheet on mount to prevent flicker on first blink
  useEffect(() => {
    const img = new Image();
    img.src = SPRITESHEET_URL;
  }, []);

  return (
    <div className={`relative w-[380px] h-[380px] rounded-full overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.6)] border-4 border-indigo-500/30 transition-transform duration-100 ease-in-out ${transformClass}`}>
      <div 
        className="w-full h-full"
        style={{
          backgroundImage: `url('${SPRITESHEET_URL}')`,
          // Width = NUM_COLS * container width; height auto-scales to preserve aspect ratio
          backgroundSize: `${NUM_COLS * CONTAINER_SIZE}px auto`,
          backgroundPosition: `${xPos}px ${yPos}px`,
          backgroundRepeat: 'no-repeat',
          // No CSS transition on background-position — we want exact snappiness
          // to avoid ghosting between frames.
        }}
      />
    </div>
  );
}
