"""Every sound in the video, synthesized here with numpy. No samples, no
third-party audio: the organizers get promo rights to the video, so each asset
has to be ours.

    video/.venv/bin/python video/sfx.py

Writes video/out/sfx/*.wav (48 kHz mono):
  sting.wav        low two-tone bulletin sting, under 0.8 s
  sting-short.wav  the same two tones, shorter, for the sign-off
  thud.wav         a paper stamp landing
  tick.wav         one typewriter key
  bed.wav          a soft teletype bed, a 4 s loop

Nothing here rises, rings or jingles: no payout chime, no coin sounds.
"""
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 48_000
OUT = Path(__file__).parent / "out" / "sfx"
rng = np.random.default_rng(1114)  # fixed seed: the same files every time


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(SR * seconds)) / SR


def band(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Band-pass by masking the spectrum, with soft edges."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    gain = 1 / (1 + (lo / np.maximum(f, 1e-6)) ** 4) / (1 + (f / hi) ** 4)
    return np.fft.irfft(spec * gain, len(x))


def peak(x: np.ndarray, db: float) -> np.ndarray:
    return x / np.max(np.abs(x)) * 10 ** (db / 20)


def fade(x: np.ndarray, a: float = 0.003, b: float = 0.02) -> np.ndarray:
    x = x.copy()
    na, nb = int(SR * a), int(SR * b)
    x[:na] *= np.linspace(0, 1, na)
    x[-nb:] *= np.linspace(1, 0, nb)
    return x


def tone(freq: float, seconds: float, decay: float) -> np.ndarray:
    """A low, slightly reedy note: a few odd-heavy harmonics with a quick attack."""
    t = t_axis(seconds)
    x = np.zeros_like(t)
    for n, amp in ((1, 1.0), (2, 0.35), (3, 0.5), (4, 0.12), (5, 0.2), (7, 0.07)):
        for detune in (-0.25, 0.25):
            x += amp * np.sin(2 * np.pi * (freq * n + detune * n) * t)
    env = np.minimum(1, t / 0.012) * np.exp(-t / decay)
    return band(x * env, 60, 2600)


def sting(first: float, second: float) -> np.ndarray:
    """Two low notes, the second lower: a bulletin ident that steps down, not up."""
    a = tone(196.0, first, 0.16)  # G3
    b = tone(146.83, second, 0.22)  # D3
    x = np.zeros(len(a) + len(b) - int(SR * 0.03))
    x[: len(a)] += a
    x[len(a) - int(SR * 0.03) :] += b
    return fade(peak(x, -9), 0.002, 0.08)


def thud() -> np.ndarray:
    """A rubber stamp on paper: a dull body knock and a short papery slap."""
    t = t_axis(0.28)
    sweep = 105 * np.exp(-t / 0.09) + 48
    body = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-t / 0.055)
    slap = band(rng.standard_normal(len(t)), 300, 3200) * np.exp(-t / 0.018)
    slap /= np.max(np.abs(slap))
    return fade(peak(body + 0.42 * slap, -7), 0.001, 0.05)


def tick(level: float = 1.0) -> np.ndarray:
    """One typewriter key: a click and a small wooden knock."""
    t = t_axis(0.07)
    click = band(rng.standard_normal(len(t)), 1800, 6500) * np.exp(-t / 0.006)
    knock = np.sin(2 * np.pi * 330 * t) * np.exp(-t / 0.012)
    x = click / np.max(np.abs(click)) + 0.5 * knock
    return fade(peak(x, -16) * level, 0.0005, 0.02)


def bed(seconds: float = 4.0) -> np.ndarray:
    """A teletype in the next room: quiet irregular ticks, loopable."""
    x = np.zeros(int(SR * seconds))
    at = 0.0
    while at < seconds - 0.1:
        k = tick(rng.uniform(0.35, 1.0))
        i = int(at * SR)
        x[i : i + len(k)] += k[: len(x) - i]
        at += rng.choice([0.085, 0.085, 0.085, 0.17, 0.255]) * rng.uniform(0.94, 1.06)
    x = band(x, 900, 4200)
    rms = np.sqrt(np.mean(x**2))
    return x / rms * 10 ** (-36 / 20)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sounds = {
        "sting": sting(0.3, 0.48),
        "sting-short": sting(0.18, 0.34),
        "thud": thud(),
        "tick": tick(),
        "bed": bed(),
    }
    for name, x in sounds.items():
        sf.write(OUT / f"{name}.wav", x.astype(np.float32), SR)
        print(f"{name}.wav  {len(x) / SR:.2f} s  peak {20 * np.log10(np.max(np.abs(x))):.1f} dBFS")
    assert len(sounds["sting"]) / SR <= 0.8


if __name__ == "__main__":
    main()
