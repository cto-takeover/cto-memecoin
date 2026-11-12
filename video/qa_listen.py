"""Optional QA for a builder who cannot listen: transcribe the exported audio
locally (faster-whisper, base.en) and print what a listener would hear.

    uv pip install --python video/.venv/bin/python faster-whisper
    video/.venv/bin/python video/qa_listen.py [video/out/cto-demo.mp4]
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

src = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "out" / "cto-demo.mp4")
wav = src.with_suffix(".16k.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
audio, _ = sf.read(wav, dtype="float32")
model = WhisperModel("base.en", device="cpu", compute_type="int8", cpu_threads=2)
segments, _ = model.transcribe(audio, word_timestamps=False, vad_filter=False)
for s in segments:
    print(f"{s.start:6.2f}-{s.end:6.2f} {s.text.strip()}")
peak = np.max(np.abs(audio))
print(f"peak {20 * np.log10(peak):.1f} dBFS")
wav.unlink()
