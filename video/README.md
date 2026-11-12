# video/: how the demo video is made

"THE CTO TIMES: SPECIAL BULLETIN", 70 s, made by script from `docs/video-agent-prompt.md`. Script and rules: `docs/video-script.md`. No human, no wallet, no keys: the footage is the live app at https://ctotimes.xyz on `demo-cto.testnet`, driven through "Play as ani / budi".

Outputs go to `video/out/` (not in git): `cto-demo-70s.mp4`, `poster.png`, `captions.srt`, `txs.json`, `events.json`, `measure.json`, `timeline.json`. The earlier 59 s cut is kept there as `cto-demo-59s.mp4`.

## Steps

```bash
# once
sudo apt-get install -y ffmpeg
npm ci                                        # Playwright (already used by e2e/)
uv venv --python 3.12 video/.venv
uv pip install --python video/.venv/bin/python kokoro-onnx soundfile numpy pillow
mkdir -p video/models && cd video/models      # Kokoro v1.0 (Apache-2.0), 350 MB
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
cd ../..

# 0. check the live app has what the script needs (read-only)
node --import ./video/ts-resolve.mjs video/step0.mjs

# 1. the chain: ani must take the seat at the floor, so if ani is CEO now,
#    budi takes it once off camera; then wait 5 quiet minutes
node --import ./video/ts-resolve.mjs video/run.mjs --rehearsal

# 2. the real run: ani takes the seat and posts (off camera), then L1-L5 are filmed
node --import ./video/ts-resolve.mjs video/run.mjs

# 3. sound
video/.venv/bin/python video/voice.py         # Kokoro, one clip per sentence
video/.venv/bin/python video/sfx.py           # sting, stamp thud, typewriter tick, teletype bed

# 4. the edit, the broadcast package, the export
video/.venv/bin/python video/measure.py       # scroll starts and the stamp landing, read from the frames
node video/timeline.mjs                       # timeline.json, captions.srt, flash frames
node video/render.mjs                         # band, cards, wipe: one PNG per frame
video/.venv/bin/python video/assemble.py      # cto-demo-70s.mp4, poster.png
node video/check.mjs                          # Step 6 checks and stills
video/.venv/bin/python video/qa_listen.py     # optional: local speech-to-text of the export (needs faster-whisper)

# 5. after the video: budi posts as the coin (spec 3 evidence), then keep the tx record
node --import ./video/ts-resolve.mjs video/budi-post.mjs
cp video/out/txs.json video/txs.json
```

Do not run `npm run test:e2e` against the deployed app while step 1 or 2 is running: the tests share the demo seat and the relayer's limits (6 signing requests a minute per IP, one takeover every 10 s).

## Files

| File | What it does |
| --- | --- |
| `script.json` | The script as data: scene times, voiceover word for word, caption chunks, ticker text, voice settings |
| `step0.mjs` | Step 0: element checks and screenshots at the recording size |
| `rec.mjs` | Recorder: 1920x900 Chromium page, CDP screencast (JPEG 92, every frame, timestamps), injected cursor, eased mouse moves, event log |
| `run.mjs` | The story on the demo coin and the five footage clips; aborts on any NEAR error except the expected `AccessKeyNotFound` |
| `voice.py` | Narration with Kokoro (`af_heart`); fixed phonemes for "ani", "budi", "memecoin", "Testnet" |
| `sfx.py` | Every sound, synthesized with numpy |
| `measure.py` | Reads from the frames what the event log only approximates: when a scroll starts, when the REJECTED stamp lands |
| `timeline.mjs` | The edit: which footage frame is on screen at each output frame, voice placement and its pacing rules, captions, CUT tags, sound cues |
| `broadcast/` | `band.html` (1920x180), `cold-open.html`, `premise.html`, `signoff.html`, `wipe.html`; the app's colors and fonts; drawn from a frame clock |
| `render.mjs` | Screenshots the broadcast pages once per frame |
| `assemble.py` | Composites footage + band or card, mixes the sound to about -14 LUFS (teletype bed about -31 LUFS), exports H.264 + AAC |
| `check.mjs` | Step 6: stills at scene boundaries, stamps and every 2 s; format, length, banned-word and tag checks |
| `qa_listen.py` | Optional: transcribes the exported audio locally, to check the narration without ears |
| `budi-post.mjs` | Off camera, after the run: budi posts a line; reads a public explorer for the payout |
| `txs.json` | The transactions of the recorded run (a copy of `out/txs.json`) |

## What is and is not edited

- The footage is never scaled, retouched or drawn over. It sits at 100% in the top 1920x900; the band is below it.
- Waiting time is cut. Every cut inside a live scene shows "CUT" in the band for 10 frames. The wait for NEAR between budi's click and the takeover sequence is cut at the scene change and is tagged too.
- Nothing is sped up. Scene 4's face picks play at normal speed; its one cut skips the scroll down to the button and a second click on the "budi" chip the app had already selected.
- Scenes 5 (takeover sequence) and 6 (rejection) are each one real-time take with no cut.
- The cold open shows 1.2 s of the rejection from the same run, cropped at native pixels and labelled "COMING UP · REAL TESTNET FOOTAGE".
- The cursor is drawn by the recorder (headless Chromium has none): an ink arrow with a cream outline and a click ring.

## Notes

- **Explorer shot.** `testnet.nearblocks.io` answers headless browsers with a bot check, so the 2.5 s explorer shot in scene 7 uses NEAR Rocks (`testnet.near.rocks`, the explorer run by FastNEAR). It shows the same takeover transaction and its receipt with `DeleteKey` and `AddKey`. The band says "PUBLIC EXPLORER" during that shot.
- **Fonts.** The app loads its four fonts from Google Fonts; `broadcast/fonts/` holds the same files (latin subset, OFL / Apache-2.0) so rendering needs no network.
- **Voice.** Kokoro runs through `kokoro-onnx` with espeak phonemes, at 1.0x throughout. In scene 2 the pauses inside the two sentences are shortened to 0.2 s. Every scene keeps 0.4 s before the voice, 0.3 s between sentences and 0.5 s after it; `timeline.mjs` refuses to build otherwise.
- **Reusing a run.** The edit is separate from the recording: the 70 s cut was made from the clips of the Nov 12 run without touching the chain again. Change `script.json`, then repeat steps 3 and 4.
- **A rejected post has no transaction hash**: NEAR refuses it before it runs. `txs.json` records NEAR's error type and the time instead.
