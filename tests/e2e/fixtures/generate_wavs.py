"""
tests/e2e/fixtures/generate_wavs.py
-------------------------------------
Helper script — generate the tiny WAV fixture files needed by the
Layer 6 Playwright voice-mode tests.

Run once before running E2E tests:
    python tests/e2e/fixtures/generate_wavs.py

Output files (written to the same directory as this script):
  interrupt_phrase.wav  – 1.5 s of a 440 Hz sine tone (simulates speech)
  silence.wav           – 2.0 s of pure silence (no VAD trigger expected)

Spec: 16 kHz, mono, 16-bit PCM (linear16), no compression.
These are the minimum requirements for Chromium's fake audio capture and
Deepgram's linear16 streaming endpoint.
"""

import math
import pathlib
import struct
import wave


HERE = pathlib.Path(__file__).parent


def _write_wav(path: pathlib.Path, samples: list[int], sample_rate: int = 16_000) -> None:
    """Write a list of 16-bit int samples as a mono WAV file."""
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit = 2 bytes
        wf.setframerate(sample_rate)
        data = struct.pack(f"<{len(samples)}h", *samples)
        wf.writeframes(data)
    print(f"  wrote {path.name}  ({len(samples)} samples @ {sample_rate} Hz)")


def generate_sine(duration_s: float, freq_hz: float = 440.0, sample_rate: int = 16_000,
                  amplitude: int = 20_000) -> list[int]:
    """Return a list of 16-bit PCM int samples for a sine tone."""
    n = int(duration_s * sample_rate)
    return [
        int(amplitude * math.sin(2 * math.pi * freq_hz * i / sample_rate))
        for i in range(n)
    ]


def generate_silence(duration_s: float, sample_rate: int = 16_000) -> list[int]:
    return [0] * int(duration_s * sample_rate)


def main() -> None:
    print("Generating WAV fixtures …")

    # interrupt_phrase.wav — 1.5 s sine at 440 Hz, loud enough to trigger VAD
    _write_wav(HERE / "interrupt_phrase.wav", generate_sine(1.5, freq_hz=440, amplitude=24_000))

    # silence.wav — 2.0 s of zeros, should NOT trigger VAD
    _write_wav(HERE / "silence.wav", generate_silence(2.0))

    print("Done. Fixture WAV files are ready.")


if __name__ == "__main__":
    main()
