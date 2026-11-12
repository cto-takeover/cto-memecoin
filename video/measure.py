"""Read moments straight from the recorded frames, where the event log is not exact.

    video/.venv/bin/python video/measure.py

The recorder logs a scroll when it ends and a stamp when the test tool notices it,
which is a little after the page shows it. The edit needs the real moments: a cut
must sit before the page starts to move, and the stamp thud must land with the stamp.
Writes video/out/measure.json (times on the same clock as events.json).
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).parent / "out"
events = json.loads((OUT / "events.json").read_text())["events"]


def when(name: str, label: str | None = None, nth: int = 0) -> float:
    return [e["t"] for e in events if e["name"] == name and (label is None or e.get("label", "").startswith(label))][nth]


def in_clip(clip: str) -> list[dict]:
    a = next(i for i, e in enumerate(events) if e["name"] == "clip:start" and e["clip"] == clip)
    b = next((i for i, e in enumerate(events) if i > a and e["name"] == "clip:start"), len(events))
    return events[a:b]


def frames(clip: str, t0: float, t1: float):
    index = json.loads((OUT / "footage" / clip / "index.json").read_text())["frames"]
    for f in index:
        if t0 <= f["t"] <= t1:
            yield f["t"], Image.open(OUT / "footage" / clip / f["file"])


def motion(clip: str, t0: float, t1: float, box: tuple, threshold: float) -> list[float]:
    """Times of the frames that differ from the frame before them inside `box`."""
    out, prev = [], None
    for t, img in frames(clip, t0, t1):
        cur = np.asarray(img.convert("L").crop(box), dtype=np.int16)
        if prev is not None and np.abs(cur - prev).mean() > threshold:
            out.append(t)
        prev = cur
    return out


m = {}

# Scene 4: the scroll down to the button after the last face pick (the deal memo is still until then).
l2 = in_clip("L2")
last_pick = next(e["t"] for e in l2 if e["name"] == "click" and e["label"].startswith("part: extra"))
down = [e for e in l2 if e["name"] == "scroll"][1]
moved = motion("L2", last_pick + 0.15, down["t"] + 0.2, (960, 480, 1530, 760), 1.0)
m["desk_scroll"] = {"start": moved[0], "end": moved[-1]}

# Scene 6: the REJECTED BY NEAR stamp (red ink in the ex-CEO panel) and the scroll to the keys panel.
l4 = in_clip("L4")
click = next(e["t"] for e in l4 if e["name"] == "click")
logged = next(e["t"] for e in l4 if e["name"].startswith("stamp:"))
red = []
for t, img in frames("L4", click + 0.3, logged + 1.0):
    px = np.asarray(img.convert("RGB").crop((400, 30, 1000, 330)), dtype=np.int16)
    red.append((t, int(((px[..., 0] > 180) & (px[..., 1] < 60) & (px[..., 2] < 70)).sum())))
rest = red[-1][1]
m["rejected_stamp"] = {
    "first_seen": next(t for t, n in red if n > 0.2 * rest),
    "landed": next(t for t, n in red if n >= 0.98 * rest),
    "logged": logged,
}
scroll = next(e for e in l4 if e["name"] == "scroll")
moved = motion("L4", logged + 1.0, scroll["t"] + 0.2, (1000, 300, 1530, 600), 1.0)
m["press_scroll"] = {"start": moved[0], "end": moved[-1]}

# Scene 7: the scroll on Receipts after VERIFIED, and the moment the verify output opens.
l5a = in_clip("L5a")
verified = next(e["t"] for e in l5a if e["name"] == "receipts:VERIFIED")
scroll = next(e for e in l5a if e["name"] == "scroll")
summary = next(e["t"] for e in l5a if e["name"] == "click" and e["label"].startswith("npm run verify"))
moved = motion("L5a", verified + 0.3, scroll["t"] + 0.2, (400, 100, 1530, 860), 4.0)
m["receipts_scroll"] = {"start": moved[0], "end": moved[-1]}
m["verify_output_open"] = motion("L5a", summary, summary + 1.5, (400, 100, 1530, 860), 10.0)[0]

(OUT / "measure.json").write_text(json.dumps(m, indent=2))
t0 = events[0]["t"]
for k, v in m.items():
    print(k, {a: round(b - t0, 3) for a, b in v.items()} if isinstance(v, dict) else round(v - t0, 3))
