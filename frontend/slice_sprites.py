from PIL import Image
import os

src_path = "public/spritesheet.png"
dst_path = "public/avatar-strip.png"

try:
    img = Image.open(src_path)
    width, height = img.size

    cols, rows = 4, 4
    frame_w = width // cols
    frame_h = height // rows

    frames = []
    for r in range(rows):
        for c in range(cols):
            left = c * frame_w
            top = r * frame_h
            right = left + frame_w
            bottom = top + frame_h
            frame = img.crop((left, top, right, bottom))
            frames.append(frame)

    used_frames = frames[:11]

    strip_w = frame_w * 11
    strip_h = frame_h
    strip = Image.new('RGBA', (strip_w, strip_h))

    for i, frame in enumerate(used_frames):
        strip.paste(frame, (i * frame_w, 0))

    strip.save(dst_path)
    print(f"Created 1x11 horizontal strip: {strip_w}x{strip_h} pixels.")
except Exception as e:
    print(f"Error: {e}")
