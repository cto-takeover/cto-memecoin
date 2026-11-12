"""Narration: Kokoro TTS (voice af_heart, Apache-2.0), generated locally.

One clip per sentence of video/script.json, so the edit knows where every
sentence starts and can shorten the pauses between them. Names the voice
would misread get phonemes from script.json ("ani", "budi").

    video/.venv/bin/python video/voice.py [--speed 1.0] [--only 2,3]

Writes video/out/voice/s<scene>_<line>.wav (24 kHz mono) and voice.json
(durations, the phonemes used). Needs video/models/kokoro-v1.0.onnx and
voices-v1.0.bin (see video/README.md).
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).parent
OUT = HERE / "out" / "voice"


def trim(audio: np.ndarray, sr: int, pad: float = 0.015) -> np.ndarray:
    """Cut the silence Kokoro leaves at both ends, keeping `pad` seconds."""
    level = np.abs(audio)
    win = int(sr * 0.01)
    env = np.convolve(level, np.ones(win) / win, mode="same")
    loud = np.where(env > 0.012)[0]
    if not len(loud):
        return audio
    a = max(0, loud[0] - int(sr * pad))
    b = min(len(audio), loud[-1] + int(sr * (pad + 0.03)))
    out = audio[a:b].copy()
    fade = int(sr * 0.008)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def tighten(audio: np.ndarray, sr: int, max_pause: float) -> np.ndarray:
    """Shorten the pauses inside a clip (after a colon or a comma) to `max_pause` seconds."""
    win = int(sr * 0.01)
    env = np.convolve(np.abs(audio), np.ones(win) / win, mode="same")
    quiet = env < 0.012
    keep = np.ones(len(audio), dtype=bool)
    i = 0
    while i < len(audio):
        if not quiet[i]:
            i += 1
            continue
        j = i
        while j < len(audio) and quiet[j]:
            j += 1
        if i > 0 and j < len(audio) and (j - i) > int(sr * max_pause):
            cut = (j - i) - int(sr * max_pause)
            mid = (i + j) // 2
            keep[mid - cut // 2 : mid - cut // 2 + cut] = False
        i = j
    return audio[keep]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--speed", type=float, default=None, help="default: voice.speed in script.json")
    ap.add_argument("--only", default="", help="comma-separated scene numbers")
    ap.add_argument("--scene-speed", default="", help="per-scene speeds, e.g. 1:1.1,2:1.08 (default: voice.scene_speed in script.json)")
    args = ap.parse_args()

    script = json.loads((HERE / "script.json").read_text())
    v = script["voice"]
    only = {int(x) for x in args.only.split(",") if x}
    per_scene = {int(k): float(s) for k, s in v.get("scene_speed", {}).items()}
    per_scene.update({int(k): float(s) for k, s in (p.split(":") for p in args.scene_speed.split(",") if p)})
    OUT.mkdir(parents=True, exist_ok=True)
    meta_path = OUT / "voice.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    kokoro = Kokoro(str(HERE / "models" / "kokoro-v1.0.onnx"), str(HERE / "models" / "voices-v1.0.bin"))

    def phonemes_for(text: str) -> str:
        """Phonemize the whole sentence (so small words keep their context), then
        swap in the fixed phonemes from script.json for the words listed there."""
        ph = kokoro.tokenizer.phonemize(text, v["lang"])
        for word, fixed in v["phonemes"].items():
            for _ in re.findall(r"\b" + re.escape(word) + r"\b", text):
                alone = kokoro.tokenizer.phonemize(word, v["lang"]).strip()
                variants = [alone, alone.replace("ˈ", "ˌ"), alone.replace("ˈ", "").replace("ˌ", "")]
                hit = next((x for x in variants if x and x in ph), None)
                if hit is None:
                    raise SystemExit(f"cannot place the phonemes for {word!r} in /{ph}/ (alone: /{alone}/)")
                ph = ph.replace(hit, fixed, 1)
        return ph

    for scene in script["scenes"]:
        if only and scene["n"] not in only:
            continue
        speed = per_scene.get(scene["n"], args.speed or v["speed"])
        if speed > v["max_speed"]:
            raise SystemExit(f"speed {speed} is above the allowed {v['max_speed']}")
        for i, line in enumerate(scene["lines"]):
            key = f"s{scene['n']}_{i}"
            ph = phonemes_for(line.get("tts", line["say"]))
            audio, sr = kokoro.create(ph, voice=v["name"], speed=speed, is_phonemes=True)
            audio = trim(np.asarray(audio, dtype=np.float32), sr)
            if str(scene["n"]) in v.get("max_pause", {}):
                audio = tighten(audio, sr, v["max_pause"][str(scene["n"])])
            sf.write(OUT / f"{key}.wav", audio, sr)
            meta[key] = {"say": line["say"], "phonemes": ph, "speed": speed, "seconds": round(len(audio) / sr, 3)}
            print(f"{key}  {meta[key]['seconds']:.2f}s  x{speed}  {line['say']}  /{ph}/")
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    for scene in script["scenes"]:
        total = sum(meta[f"s{scene['n']}_{i}"]["seconds"] for i in range(len(scene["lines"])) if f"s{scene['n']}_{i}" in meta)
        print(f"scene {scene['n']}: {total:.2f}s of speech in a {scene['end'] - scene['start']:.1f}s slot")


if __name__ == "__main__":
    main()
