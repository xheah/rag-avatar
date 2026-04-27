"""
generate_sprites.py — Nathan Avatar Sprite Sheet Generator

Builds a 4-row × 9-column sprite sheet from the frame-based assets in
public/nathan-avatar/Frames/.

Layout (rows = eye states, columns = mouth phonemes):
  Row 0: Open-Eye      (_O suffix)
  Row 1: Half-Opened   (_HA suffix)
  Row 2: Half-Closed   (_HC suffix)
  Row 3: Closed-Eye    (_C suffix)

Column order (matches PHONEME_ORDER):
  0: Idle         → IDLE
  1: MBP          → MBPV
  2: AA           → AH
  3: EH           → EE
  4: K,S,T,EE,ING → TSN
  5: R,OU,W       → OO
  6: L,TH         → TH
  7: D,J,CH       → SH
  8: FV           → FV

Output: public/nathan_avatar_spritesheet.webp
"""

from PIL import Image
import os
import sys

# ── Configuration ────────────────────────────────────────────────────────────

FRAMES_ROOT = os.path.join("public", "nathan-avatar", "Frames")
OUTPUT_PATH = os.path.join("public", "nathan_avatar_spritesheet.webp")

# Eye-state directories in row order
EYE_DIRS = [
    ("Open-Eye",        "_O"),
    ("Half-Opened-Eye", "_HA"),
    ("Half-Closed-Eye", "_HC"),
    ("Closed-Eye",      "_C"),
]

# Phoneme prefixes in column order (canonical names, all normalised to FV)
PHONEME_ORDER = [
    "Idle",
    "MBP",
    "AA",
    "EH",
    "K,S,T,EE,ING",
    "R,OU,W",
    "L,TH",
    "D,J,CH",
    "FV",
]


def main():
    # Validate root exists
    if not os.path.isdir(FRAMES_ROOT):
        print(f"ERROR: Frames directory not found: {FRAMES_ROOT}")
        sys.exit(1)

    num_cols = len(PHONEME_ORDER)
    num_rows = len(EYE_DIRS)

    # Discover frame dimensions from the first valid image
    sample_dir = os.path.join(FRAMES_ROOT, EYE_DIRS[0][0])
    sample_files = [f for f in os.listdir(sample_dir) if f.endswith(".png")]
    if not sample_files:
        print(f"ERROR: No PNG files found in {sample_dir}")
        sys.exit(1)

    sample_img = Image.open(os.path.join(sample_dir, sample_files[0]))
    frame_w, frame_h = sample_img.size
    print(f"Frame dimensions: {frame_w}×{frame_h}")
    print(f"Sprite sheet layout: {num_cols} cols × {num_rows} rows")
    print(f"Output dimensions: {frame_w * num_cols}×{frame_h * num_rows}")

    # Build the sprite sheet
    sheet = Image.new("RGBA", (frame_w * num_cols, frame_h * num_rows))
    missing = []

    for row_idx, (dir_name, suffix) in enumerate(EYE_DIRS):
        dir_path = os.path.join(FRAMES_ROOT, dir_name)
        if not os.path.isdir(dir_path):
            print(f"WARNING: Directory missing: {dir_path}")
            continue

        for col_idx, phoneme in enumerate(PHONEME_ORDER):
            filename = f"{phoneme}{suffix}.png"
            frame_path = os.path.join(dir_path, filename)

            if not os.path.exists(frame_path):
                missing.append(f"{dir_name}/{filename}")
                print(f"  MISSING: {dir_name}/{filename}")
                continue

            frame = Image.open(frame_path).convert("RGBA")
            # Verify dimensions match
            if frame.size != (frame_w, frame_h):
                print(f"  WARNING: Size mismatch for {frame_path}: {frame.size} (expected {frame_w}×{frame_h})")
                frame = frame.resize((frame_w, frame_h), Image.LANCZOS)

            x = col_idx * frame_w
            y = row_idx * frame_h
            sheet.paste(frame, (x, y))
            print(f"  ✓ [{row_idx},{col_idx}] {os.path.basename(frame_path)}")

    if missing:
        print(f"\n⚠ {len(missing)} frames missing — blank cells in sprite sheet")

    # Save as WebP for optimal web delivery size
    sheet.save(OUTPUT_PATH, format="WEBP", quality=90, method=6)
    file_size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"\n✅ Sprite sheet saved: {OUTPUT_PATH}")
    print(f"   Dimensions: {sheet.size[0]}×{sheet.size[1]}")
    print(f"   File size: {file_size_mb:.1f} MB")
    print(f"   Frames: {num_cols * num_rows - len(missing)}/{num_cols * num_rows}")


if __name__ == "__main__":
    main()
