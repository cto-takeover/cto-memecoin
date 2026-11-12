# $CTO demo video: "THE CTO TIMES: SPECIAL BULLETIN"

Status: **EDITED** Thu Nov 12, 2026 (version 4, 70 s), waiting for the human's review, upload and X post. This replaces the 59 s cut made the same morning (kept as `video/out/cto-demo-59s.mp4`); git history keeps the older scripts.

Format: a 70-second satirical news bulletin from THE CTO TIMES about a boardroom coup, at a steady, deadpan pace: the voice waits for the picture. The bulletin is the wrapper; scenes 3–7 are footage of the live app at https://ctotimes.xyz on the demo coin `demo-cto.testnet`, with real testnet transactions. Made by script from `docs/video-agent-prompt.md`: no human, no wallet, no keys (only "Play as ani / budi" through the public demo relayer).

Output: `video/out/cto-demo-70s.mp4` · 1920x1080 · 30 fps · H.264 + AAC · captions burned in (also `video/out/captions.srt` and `docs/video-captions.srt`).

## Script

| # | Time | Band headline / card | Picture and holds | Voiceover (word for word) | Sound |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.0–4.0 | Card: STOP PRESS | Masthead slam on frame 0, headline "EX-CEO LOCKED OUT, BY NEAR ITSELF", then a 1.2 s labelled flash of the real REJECTED stamp. Voice starts 0.4 s after the slam. | "Stop the presses. A memecoin just fired its CEO." | Bulletin sting, stamp thud |
| 2 | 4.0–11.0 | Card: WHO RUNS YOUR MEMECOIN? | "ONE DEV. ONE KEY." is stamped, struck through, then "ONE CEO SEAT. ANYONE CAN TAKE IT." and the RULES box | "Most memecoins: one dev holds the keys. C-T-O has one CEO seat, and anyone can take it." | Teletype bed, stamp thud on the strike-through |
| 3 | 11.0–19.5 | LIVE · TESTNET: LIVE FROM THE BOARDROOM | Front page: ani's face, CEO stamp, seat price 1,400,000, TAKE OVER. The page alone for 0.6 s before the voice. | "Live from the boardroom. ani runs the coin's face and voice. Her seat costs one-point-four times what she paid." | Teletype bed |
| 4 | 19.5–28.0 | LIVE · TESTNET: HOSTILE BID AT THE TAKEOVER DESK | budi picks face #672 tab by tab at normal speed, then TAKE THE SEAT | "Enter budi. A new face from fixed parts. One-point-four million C-T-O. Take the seat." | Typewriter tick per pick |
| 5 | 28.0–38.0 | BREAKING: CEO FIRED, BUT PAID | The app's own takeover sequence, uncut. The voice starts after FIRED!, the new face and NEW CEO have landed. | "ani is fired, but paid: one-point-one-five million back. The rest burns. Supply shrinks." | Stamp thud on FIRED! |
| 6 | 38.0–52.0 | BREAKING: EX-CEO LOCKED OUT, BY NEAR ITSELF | TRY POSTING AS ANI, NEAR's raw error, REJECTED BY NEAR (held), keys panel: ani DELETED / budi ACTIVE (held), "+1,150,000 · Fired, but paid" | "Now ani tries to post as the coin. Her key was deleted in the same transaction. NEAR itself says no: access key not found." | 0.8 s of silence, then stamp thud on REJECTED |
| 7 | 52.0–61.5 | LIVE · TESTNET: THE EVIDENCE | Receipts: steps and VERIFIED, verify PASS lines, chart drawing; 2.5 s of the takeover on a public explorer: DeleteKey + AddKey | "No admin keys. The CEO's voice is a NEAR access key on the coin itself, and every step has a receipt." | Teletype bed |
| 8 | 61.5–70.0 | Card: SIGN-OFF | Elements land one by one, 0.4 s apart: $CTO, tagline, "Built on NEAR · testnet only · no admin keys", ctotimes.xyz, "Built at NEAR HACKATHON · #NEARHackathon", "AI voice · real testnet footage", "THERE CAN ONLY BE ONE CEO." Full card held 2 s after the last word. | "C-T-O. The memecoin where anyone can take over. Testnet only. There can only be one CEO." | Short bulletin sting, stamp thud |

## Rules the video keeps

- **No faking.** Every number on screen is rendered by the app. The REJECTED BY NEAR stamp and NEAR's raw error are the app's own, from a real `AccessKeyNotFound`.
- **The band never overlaps the app.** Footage is 1920x900 at 100% scale; the 180 px broadcast band sits below it. The band carries editorial text only: no amounts, prices, balances or key states.
- **Honest edits.** Waiting time is cut; every cut inside a live scene shows a "CUT" tag in the band for 10 frames. Nothing is sped up. Nothing is cut inside scenes 5 and 6.
- **Flash-forward.** The cold open shows 1.2 s of the real REJECTED moment from the same run, labelled "COMING UP · REAL TESTNET FOOTAGE". Nothing else is out of order.
- **Testnet visible.** The ticker "TESTNET ONLY · NOTHING FOR SALE · NO ADMIN KEYS · …" runs on every frame.
- **No casino or money-hype cues**, no real people or news brands, no third-party music: every sound is synthesized by `video/sfx.py`.
- **AI voice, disclosed.** Narration is Kokoro TTS (voice `af_heart`, Apache-2.0), generated locally at normal speed. The sign-off card says "AI voice · real testnet footage".
- **Ticker style.** Cards say $CTO; amounts read "1,400,000 CTO" as the app shows them; the voiceover says "C-T-O".

## As edited (Thu Nov 12, 2026)

| | |
| --- | --- |
| File | `video/out/cto-demo-70s.mp4` · 70.00 s · 2100 frames · 1920x1080 · 30 fps · H.264 yuv420p CRF 17 · AAC 48 kHz · -14 LUFS |
| Also | `video/out/poster.png` (the REJECTED moment), `video/out/captions.srt` (30 chunks, each on screen at least 1.3 s) |
| Footage | The clips of the Nov 12 run (the same run the 59 s cut used; no new transactions). Chromium 1920x900 at device scale factor 1, never scaled; CDP screencast JPEG 92; band 1920x180 below it |
| Pacing | Every scene: at least 0.4 s before the voice, 0.3 s between sentences, 0.5 s after it. Voice at 1.0x everywhere |
| Scene 4 | The seven face picks play at normal speed in one take; one tagged cut skips the scroll down to the button |
| Takeover sequence | 3.85 s from the dialog to its buttons, shown uncut inside a 10 s scene; the finished dialog is held 5.2 s |
| Rejection | NEAR answered 1.45 s after the click. The REJECTED stamp is on screen 3.7 s before the page scrolls (3.5 s after it lands); the keys panel is held 2.8 s |
| Scene 7 | Steps and VERIFIED 3.0 s, verify PASS lines 1.7 s, chart 1.75 s, explorer 2.5 s; three tagged cuts |
| Sign-off | The full card is held 2.0 s after the last word; the last sound ends 2 s before the end |
| Checks | `node video/check.mjs`: 30 of 31 pass (the miss is the RULES hold below) |

Transactions (also in `video/txs.json` and the README):

- ani takes the seat for 1,000,000: `9cktnak12SeqW58zbrTRd2jjwY3TVTFsbegD8quBkrj4`
- ani posts as the coin: `12x8GZ2PeGYFUrM6GVZY6pDZieSmLwZfF2mKgKkJvqiG`
- budi takes it for 1,400,000 (ani +1,150,000, 250,000 burned, `DeleteKey` + `AddKey`): `5zLmBZQUUXzNrbC1HmkhSzBUboXMWPHN68k5co2YGQCV`
- ani's post rejected at 2026-11-12T03:51:16.988Z: `InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound` (no hash: NEAR refuses it before it runs)
- budi posts as the coin, after the video: `GPYdGMibjgUZ1ud81wD41qqg2y1rjCN9fF388NnxVw4a`

Where the video differs from the plan:

- **RULES box (scene 2).** The plan holds the RULES box 1.5 s after the voice ends. At normal voice speed the two sentences take 5.6 s, so the voice ends 0.7 s before the scene does. The box comes up early instead and is on screen 3.3 s in all. A shorter second sentence would give the full hold, for example "C-T-O has one CEO seat. Anyone can take it."
- **Takeover sequence (scene 5).** The app's dialog shows the payout and the total burned, not the new supply. "Supply shrinks." is said over the total-burned counter.
- **Explorer shot.** `testnet.nearblocks.io` puts a bot check in front of headless browsers (checked again Nov 12), so the 2.5 s explorer shot shows the same transaction on NEAR Rocks (`testnet.near.rocks`, by FastNEAR). The band reads "THE EVIDENCE · PUBLIC EXPLORER" during it.
- **Front page.** The live Front page has no "x1.4" label; scene 3 shows "paid 1,000,000 CTO" next to "SEAT PRICE 1,400,000 CTO". "pay 1.4x" is on the Takeover desk in scene 4.
- **Scene 4.** The app already plays as budi when the desk opens (it picks whoever is not CEO), so "acting as budi-cto.testnet" and the selected budi chip are on screen from the first frame. The cut skips the scroll and a second, redundant click on that chip. The finished face is still for 0.2 s before the cut and stays on screen after it, 0.8 s in all before the click.
- **Scene 4 to 5.** The 5 s wait for NEAR after TAKE THE SEAT is cut at the scene change; the band shows a CUT tag there too.
- **Captions.** A short sentence's caption can come up to 0.25 s before its voice, so each chunk gets its 1.3 s.
- **No vertical cut** (it was optional).

## How it is made

See `video/README.md`. Short version: `video/run.mjs` drives the live app in headless Chromium and saves every screencast frame with a timestamp plus an event log; `video/measure.py` reads scroll starts and the stamp landing from the frames; `video/broadcast/` holds the cards and the band (HTML, rendered frame by frame from one timeline); `video/voice.py` and `video/sfx.py` make the sound; `video/assemble.py` composites and exports.
