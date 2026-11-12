"""Step 5 of docs/video-agent-prompt.md: composite, mix, export.

    video/.venv/bin/python video/assemble.py [--frames 0-299] [--out name.mp4]

Picture, one frame at a time from video/out/timeline.json:
  scenes 3-7   the footage frame (1920x900, untouched, at 100%) on top,
               the rendered band (1920x180) under it; they never overlap
  scenes 1,2,8 the rendered card
  10 frames around every scene change: the newsprint wipe (above the ticker)

Sound: the Kokoro voice clips where the timeline puts them, the sounds from
sfx.py at their cues, the teletype bed (about -31 LUFS, ducked under the voice); then loudness
is set to about -14 LUFS.

Writes video/out/cto-demo-70s.mp4 (H.264 yuv420p CRF 17, AAC 48 kHz), poster.png
and audio/mix.wav.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE / "out"
SR = 48_000
BED_LUFS = -31.0
W, H, FOOT_H = 1920, 1080, 900


def db(x: float) -> float:
    return 10 ** (x / 20)


def load48(path: Path, tmp: Path) -> np.ndarray:
    """Read a wav as 48 kHz mono float (ffmpeg resamples the 24 kHz voice)."""
    data, sr = sf.read(path, dtype="float32")
    if sr == SR:
        return data
    out = tmp / f"{path.stem}.48k.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-ar", str(SR), "-ac", "1", "-c:a", "pcm_f32le", str(out)], check=True)
    return sf.read(out, dtype="float32")[0]


def mix_audio(tl: dict) -> Path:
    adir = OUT / "audio"
    adir.mkdir(parents=True, exist_ok=True)
    n = int(tl["duration"] * SR)
    voice = np.zeros(n, dtype=np.float32)
    fx = np.zeros(n, dtype=np.float32)
    bed = np.zeros(n, dtype=np.float32)

    def add(track: np.ndarray, clip: np.ndarray, t: float, gain: float = 1.0) -> None:
        i = int(round(t * SR))
        clip = clip[: max(0, n - i)]
        track[i : i + len(clip)] += clip * gain

    # Voice: every sentence at the same loudness (RMS of its loud part).
    for v in tl["voice"]:
        clip = load48(OUT / "voice" / f"{v['key']}.wav", adir)
        loud = clip[np.abs(clip) > 0.02]
        clip = clip * (db(-21) / np.sqrt(np.mean(loud**2)))
        add(voice, clip, v["start"])

    sounds = {p.stem: sf.read(p, dtype="float32")[0] for p in (OUT / "sfx").glob("*.wav")}
    # Everything sits under the voice: the stings start while the narrator is speaking.
    level = {"sting": 0.6, "sting-short": 0.6, "thud": 0.8}
    for cue in tl["sfx"]:
        add(fx, sounds[cue["name"]], cue["t"], cue.get("gain", 1.0) * level.get(cue["name"], 1.0))

    # Teletype bed where the script asks for it, with short fades, ducked under the voice.
    # Its level is set so that the bed alone sits at about -31 LUFS in the finished mix:
    # the gain loudnorm will apply is estimated from the voice and sounds without the bed.
    def lufs(x: np.ndarray, name: str) -> float:
        p = adir / name
        sf.write(p, np.stack([x, x], axis=1), SR, subtype="FLOAT")
        r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(p), "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True, check=True)
        tail = r.stderr[r.stderr.rindex("Summary:") :]
        p.unlink()
        return float(tail.split("I:")[1].split("LUFS")[0])

    loop = sounds["bed"]
    final_gain = -14.0 - lufs(voice + fx, "probe-mix.wav")
    loop = loop * db(BED_LUFS - (lufs(np.tile(loop, 4), "probe-bed.wav") + final_gain))
    print(f"bed: about {BED_LUFS} LUFS in the finished mix (before ducking)")
    for b in tl["beds"]:
        i0, i1 = int(b["start"] * SR), int(b["end"] * SR)
        seg = np.tile(loop, (i1 - i0) // len(loop) + 1)[: i1 - i0].copy()
        f = int(0.25 * SR)
        seg[:f] *= np.linspace(0, 1, f)
        seg[-f:] *= np.linspace(1, 0, f)
        bed[i0:i1] += seg
    win = int(0.12 * SR)
    talking = np.convolve((np.abs(voice) > 0.01).astype(np.float32), np.ones(win) / win, mode="same")
    talking = np.convolve(np.clip(talking * 4, 0, 1), np.ones(win) / win, mode="same")
    bed *= 1 - 0.55 * talking  # about -7 dB while someone speaks
    fx *= 1 - 0.25 * talking

    mix = voice + fx + bed
    raw = adir / "mix-raw.wav"
    sf.write(raw, np.stack([mix, mix], axis=1), SR, subtype="FLOAT")

    # Two-pass loudness: measure, then set about -14 LUFS with a true-peak ceiling.
    target = "I=-14:TP=-1.5:LRA=11"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(raw), "-af", f"loudnorm={target}:print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True)
    m = json.loads(r.stderr[r.stderr.rindex("{") : r.stderr.rindex("}") + 1])
    measured = f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
    out = adir / "mix.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", f"loudnorm={target}:{measured}:linear=true,alimiter=limit=0.84:level=false", "-ar", str(SR), "-c:a", "pcm_s24le", str(out)], check=True)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(out), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True, check=True)
    tail = r.stderr[r.stderr.rindex("Summary:") :]
    print("audio:", " ".join(x.strip() for x in tail.splitlines() if "I:" in x or "Peak:" in x))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="", help="only these output frames, e.g. 0-299 (a test cut, no audio)")
    ap.add_argument("--out", default="cto-demo-70s.mp4")
    ap.add_argument("--crf", default="17")
    args = ap.parse_args()

    tl = json.loads((OUT / "timeline.json").read_text())
    fps, total = tl["fps"], tl["frames"]
    first, last = (int(x) for x in args.frames.split("-")) if args.frames else (0, total - 1)
    partial = bool(args.frames)
    footage_dir = Path(tl["footageDir"])
    wipes = [Image.open(OUT / "wipe" / f"{i}.png").convert("RGBA") for i in range(2 * tl["wipeHalf"])]
    half = tl["wipeHalf"]

    def frame(f: int) -> Image.Image:
        src = tl["footage"][f]
        if src:
            shot = Image.open(footage_dir / src).convert("RGB")
            band = Image.open(OUT / "band" / f"{f:06d}.png").convert("RGB")
            if shot.size != (W, FOOT_H) or band.size != (W, H - FOOT_H):
                raise SystemExit(f"frame {f}: footage {shot.size}, band {band.size}")
            img = Image.new("RGB", (W, H))
            img.paste(shot, (0, 0))  # 100% scale, nothing drawn over it
            img.paste(band, (0, FOOT_H))
        else:
            img = Image.open(OUT / "cards" / f"{f:06d}.png").convert("RGB")
            if img.size != (W, H):
                raise SystemExit(f"frame {f}: card {img.size}")
        for b in tl["wipes"]:
            if b - half <= f < b + half:
                img.paste(wipes[f - (b - half)], (0, 0), wipes[f - (b - half)])
        return img

    audio = None if partial else mix_audio(tl)
    out = OUT / args.out
    cmd = ["ffmpeg", "-v", "error", "-stats", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps), "-i", "-"]
    if audio:
        cmd += ["-i", str(audio)]
    cmd += ["-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", args.crf, "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-r", str(fps)]
    if audio:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-shortest"]
    cmd += ["-movflags", "+faststart", str(out)]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for f in range(first, last + 1):
        img = frame(f)
        if f == tl["poster"]["frame"]:
            img.save(OUT / "poster.png")
        enc.stdin.write(img.tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        sys.exit("ffmpeg failed")
    print(f"wrote {out} ({last - first + 1} frames)")


if __name__ == "__main__":
    main()
