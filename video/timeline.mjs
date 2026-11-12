// The edit, as data. Reads the script, the measured voice clips and the run's
// event log, and writes video/out/timeline.json: scene times, voice placement,
// caption chunks, chyrons, CUT tags, sound cues, and for every output
// frame of scenes 3-7 the footage frame that is shown.
//
//   node video/timeline.mjs
//
// Edits allowed by docs/video-agent-prompt.md, and nothing else:
//   - waiting time is cut, and every cut inside a live scene gets a 10-frame CUT tag;
//   - nothing is sped up (the script allows 1.25x on scene 4's face picks; it fits at 1x);
//   - scenes 5 (takeover sequence) and 6 (rejection) are one uncut real-time take each.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FPS, HERE, OUT, RUN } from './lib.mjs';

const script = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'));
const voice = JSON.parse(readFileSync(join(OUT, 'voice', 'voice.json'), 'utf8'));
const run = JSON.parse(readFileSync(join(RUN, 'events.json'), 'utf8'));
const E = run.events;
// Moments read from the frames themselves (video/measure.py): when a scroll really starts, when the stamp lands.
const M = JSON.parse(readFileSync(join(RUN, 'measure.json'), 'utf8'));
if (run.aborted) throw new Error(`the run was aborted: ${run.aborted}`);
if (run.rehearsal && !process.argv.includes('--allow-rehearsal')) throw new Error('events.json is from a rehearsal, not the real run');

const r3 = (x) => Math.round(x * 1000) / 1000;
const frameOf = (t) => Math.round(t * FPS);
const scene = (n) => script.scenes.find((s) => s.n === n);
const CUT_FRAMES = 10;
const WIPE_HALF = 5; // the newsprint wipe: 10 frames across each scene change
const CAP_MIN = 1.3; // seconds a caption chunk stays on screen, at least
const FLASH_SECONDS = 1.2;

// ---------------------------------------------------------------- the run's events
const clipStart = (name) => E.find((e) => e.name === 'clip:start' && e.clip === name)?.t;
/** Events between the start of a clip and the start of the next one. */
function inClip(name) {
  const a = E.findIndex((e) => e.name === 'clip:start' && e.clip === name);
  if (a < 0) throw new Error(`no clip ${name} in events.json`);
  let b = E.findIndex((e, i) => i > a && e.name === 'clip:start');
  if (b < 0) b = E.length;
  return E.slice(a, b);
}
const one = (list, name, label) => {
  const e = list.find((x) => x.name === name && (label === undefined || x.label === label || x.label?.startsWith(label)));
  if (!e) throw new Error(`event ${name} ${label ?? ''} not found`);
  return e.t;
};
const clips = {};
const clip = (name) => (clips[name] ??= JSON.parse(readFileSync(join(RUN, 'footage', name, 'index.json'), 'utf8')).frames);
/** The frame on screen at source time t: the last one captured at or before it. */
function frameAt(name, t) {
  const f = clip(name);
  let lo = 0;
  let hi = f.length - 1;
  if (t < f[0].t - 0.004) {
    // The screencast sends a frame only when the page repaints. Before a clip's first
    // frame the page still shows the last frame of the clip filmed just before it.
    const before = { L3: 'L2', L4: 'L3-exit', L5b: 'L5a' }[name];
    if (before && t >= clip(before).at(-1).t) return frameAt(before, t);
    if (t < f[0].t - 0.2) throw new Error(`${name}: nothing was filmed at ${t} (clip starts ${f[0].t})`);
    return `${name}/${f[0].file}`;
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f[mid].t <= t + 0.004) lo = mid;
    else hi = mid - 1;
  }
  return `${name}/${f[lo].file}`;
}

// ---------------------------------------------------------------- voice placement
// A voice clip keeps 0.015 s of quiet before the first sound and 0.045 s after the
// last (voice.py trim). Pauses are counted on what is heard, not on the clip edges.
const PAD = { lead: 0.015, tail: 0.045 };
const dur = (key) => voice[key].seconds;
const heard = (p) => ({ start: p.start + PAD.lead, end: p.end - PAD.tail });
const placed = [];
/** One sentence, heard from `at`. */
const line = (n, i, at) => {
  const key = `s${n}_${i}`;
  const start = at - PAD.lead;
  return { key, scene: n, start: r3(start), end: r3(start + dur(key)), text: scene(n).lines[i].say };
};
/** A scene's sentences one after another, the first heard at `at`, `gaps` seconds of quiet between them. */
function say(n, at, gaps) {
  const out = [];
  let t = at;
  scene(n).lines.forEach((_, i) => {
    const p = line(n, i, t);
    out.push(p);
    t = heard(p).end + (Array.isArray(gaps) ? (gaps[i] ?? 0) : gaps);
  });
  return out;
}
/** The pacing rules: 0.4 s before the voice, 0.3 s between sentences, 0.5 s after it. */
const mustFit = (n, lines) => {
  const s = scene(n);
  const first = heard(lines[0]);
  const last = heard(lines[lines.length - 1]);
  if (first.start < s.start + 0.4 - 1e-3) throw new Error(`scene ${n}: the voice starts ${(first.start - s.start).toFixed(2)} s into the scene, under 0.4 s`);
  if (last.end > s.end - 0.5 + 1e-3) throw new Error(`scene ${n}: the voice ends ${(s.end - last.end).toFixed(2)} s before the scene does, under 0.5 s. Shorten pauses, or propose a shorter line.`);
  for (let i = 1; i < lines.length; i++) {
    const gap = heard(lines[i]).start - heard(lines[i - 1]).end;
    if (gap < 0.3 - 1e-3) throw new Error(`scene ${n}: only ${gap.toFixed(2)} s between sentences ${i - 1} and ${i}`);
  }
  placed.push(...lines);
  s.pace = { before: r3(first.start - s.start), after: r3(s.end - last.end) };
  return lines;
};

const edl = [];
const tags = [];
const sfx = [];
const chyrons = [];
const beds = [];
/** Append footage to a live scene; returns the output time where it ends. */
function seg(n, out0, name, src0, src1, speed = 1) {
  const len = (src1 - src0) / speed;
  edl.push({ scene: n, clip: name, out0: r3(out0), out1: r3(out0 + len), src0, speed });
  if (speed !== 1) tags.push({ start: r3(out0), end: r3(out0 + len), kind: 'speed', text: `${speed}x` });
  return out0 + len;
}
const cutTag = (at) => tags.push({ start: r3(at), end: r3(at + CUT_FRAMES / FPS), kind: 'cut', text: 'CUT' });

// ------------------------------------------------ scene 1: cold open (card)
{
  const s = scene(1);
  // The masthead and headline are on frame 0; the voice starts 0.4 s after the slam.
  mustFit(1, say(1, s.start + 0.4, 0.3));
  // The 1.2 s flash of the real rejection runs up to the wipe, so its last frame is never held.
  const insetFrames = Math.round(FLASH_SECONDS * FPS);
  s.marks = { stamp: r3(5 / FPS), inset: r3(s.end - (WIPE_HALF + insetFrames) / FPS), insetFrames };
  sfx.push({ t: 0, name: 'sting' }, { t: s.marks.stamp + 0.06, name: 'thud' });
}
// ------------------------------------------------ scene 2: the premise (card)
{
  const s = scene(2);
  const a = line(2, 0, s.start + 0.4);
  // "ONE DEV. ONE KEY." is stamped in the pause after "Most memecoins:", before the words
  // it shows; it is struck through when the sentence ends, and the $CTO line lands before
  // the voice gets to it.
  const strike = heard(a).end + 0.02;
  const b = line(2, 1, heard(a).end + 0.4);
  mustFit(2, [a, b]);
  s.marks = { stampIn: r3(heard(a).start + 0.8), strike: r3(strike), swap: r3(strike + 0.1), rules: r3(strike + 0.65) };
  if (s.marks.strike - s.marks.stampIn < 0.7) throw new Error('scene 2: ONE DEV. ONE KEY. sits for under 0.7 s');
  s.notes = { rulesOnScreen: r3(s.end - WIPE_HALF / FPS - s.marks.rules), rulesAfterVoice: r3(s.end - heard(b).end) };
  sfx.push({ t: s.marks.stampIn + 0.06, name: 'thud', gain: 0.55 }, { t: s.marks.strike + 0.03, name: 'thud' });
  beds.push({ start: s.start, end: s.end });
}
// ------------------------------------------------ scene 3: the boardroom (L1, one take, no clicks)
{
  const s = scene(3);
  const len = s.end - s.start;
  const src1 = clipStart('L2') - 0.2;
  const src0 = src1 - len;
  if (src0 < one(inClip('L1'), 'front:shown') + 0.9) throw new Error('scene 3: the Front page take is too short');
  seg(3, s.start, 'L1', src0, src1);
  // The Front page alone for 0.6 s, then the voice.
  mustFit(3, say(3, s.start + 0.6, 0.5));
  beds.push({ start: s.start, end: s.end });
}
// ------------------------------------------------ scene 4: the hostile bid (L2 at normal speed, one cut)
{
  const s = scene(4);
  const ev = inClip('L2');
  const picks0 = one(ev, 'picks:start');
  const lastPick = one(ev, 'click', 'part: extra');
  const chip = one(ev, 'click', 'play as budi');
  const take = one(ev, 'click', 'TAKE THE SEAT');
  // The take runs until the page starts to scroll down to the button (read from the frames).
  const faceUntil = M.desk_scroll.start - 0.03;
  if (faceUntil < lastPick + 0.12) throw new Error('scene 4: the page scrolls before the finished face is shown');
  // One tagged cut: the scroll down, and a click on the "budi" chip the app had already
  // selected (the app plays as whoever is not CEO). The take resumes after that click,
  // with the finished face still on screen above the button.
  const resume = chip + 0.45;
  const lead = 0.5;
  const hold = s.end - s.start - lead - (faceUntil - picks0) - (take - resume); // "SENDING TO NEAR…" on the button
  if (hold < 0.4) throw new Error(`scene 4 does not fit at normal speed: ${(0.4 - hold).toFixed(2)} s over`);
  if (take + hold > clipStart('L3') + 0.5) throw new Error('scene 4: not enough footage after the click');
  let t = seg(4, s.start, 'L2', picks0 - lead, faceUntil);
  const cutAt = t;
  cutTag(t);
  t = seg(4, t, 'L2', resume, take + hold);
  // The wait for NEAR between the click and the sequence is cut at the scene change; say so.
  cutTag(s.end - (CUT_FRAMES + WIPE_HALF) / FPS);
  for (const c of ev.filter((e) => e.name === 'click' && /^(tab|part): /.test(e.label))) {
    sfx.push({ t: s.start + lead + (c.t - picks0), name: 'tick', gain: c.label.startsWith('part') ? 1 : 0.6 });
  }
  const takeOut = s.end - hold;
  sfx.push({ t: takeOut, name: 'tick' });
  const lines = say(4, s.start + 0.4, [0.45, 0.75]).slice(0, 3);
  // "Take the seat." is said once the button is on screen (after the cut); the click lands in it.
  lines.push(line(4, 3, cutAt + 0.03));
  mustFit(4, lines);
  const faceDone = s.start + lead + (lastPick + 0.1 - picks0);
  s.notes = { firstPick: r3(s.start + lead + (one(ev, 'click', 'part: bg') - picks0)), faceDone: r3(faceDone), cut: r3(cutAt), click: r3(takeOut), faceOnScreenBeforeClick: r3(takeOut - faceDone), sendingHeld: r3(hold) };
  if (s.notes.faceOnScreenBeforeClick < 0.5) throw new Error('scene 4: the finished face is on screen for under 0.5 s before the click');
}
// ------------------------------------------------ scene 5: the takeover sequence (L3, uncut)
let seqOut;
{
  const s = scene(5);
  const l3 = inClip('L3');
  const seq = one(l3, 'sequence:start');
  const lead = 0.9; // the end of the real wait: "SENDING TO NEAR…"
  const src1 = seq - lead + (s.end - s.start);
  if (src1 > clipStart('L3-exit') + 0.05) throw new Error('scene 5: the take ends before the scene does');
  seg(5, s.start, 'L3', seq - lead, src1);
  seqOut = s.start + lead;
  sfx.push({ t: seqOut - 0.05, name: 'thud' }); // FIRED! is on the old face as the dialog opens
  // The voice waits for FIRED!, the new face and the NEW CEO stamp (1.3 s into the sequence).
  const lines = mustFit(5, say(5, seqOut + 1.3, [0.45, 0.45]));
  const buttons = s.start + lead + (one(l3, 'sequence:buttons-shown') - seq);
  s.notes = { sequenceStart: r3(seqOut), sequenceSeconds: r3(one(l3, 'sequence:buttons-shown') - seq), finishedAt: r3(buttons), heldAfter: r3(s.end - buttons), quietAtEnd: r3(s.end - heard(lines[2]).end) };
  if (s.notes.heldAfter < 1.0) throw new Error('scene 5: the finished sequence is held for under 1 s');
}
// ------------------------------------------------ scene 6: locked out (L4, uncut)
let stampOut;
{
  const s = scene(6);
  const ev = inClip('L4');
  const stamp = M.rejected_stamp.landed; // the app's stamp at rest, read from the frames
  const click = one(ev, 'click', 'TRY POSTING AS');
  const d = [0, 1].map((i) => dur(`s6_${i}`) - PAD.lead - PAD.tail);
  const SILENCE = 0.8;
  // The stamp lands X seconds into the scene: after two sentences and 0.8 s of silence.
  const X = Math.max(6.2, 0.4 + d[0] + 0.3 + d[1] + SILENCE);
  const src0 = stamp - X;
  if (src0 < clipStart('L4') + 0.05) throw new Error('scene 6: not enough footage before the click');
  seg(6, s.start, 'L4', src0, src0 + (s.end - s.start));
  stampOut = s.start + X;
  const lines = [line(6, 0, s.start + 0.4), line(6, 1, stampOut - SILENCE - d[1]), line(6, 2, stampOut + 0.45)];
  mustFit(6, lines);
  sfx.push({ t: stampOut, name: 'thud', gain: 1.15 });
  const keysFrom = s.start + (M.press_scroll.end - src0);
  s.notes = {
    clickAt: r3(s.start + (click - src0)),
    stampFirstSeen: r3(stampOut - (stamp - M.rejected_stamp.first_seen)),
    stampAt: r3(stampOut),
    silenceBeforeThud: r3(stampOut - heard(lines[1]).end),
    stampHeldFor: r3(M.press_scroll.start - M.rejected_stamp.first_seen), // on screen before the page moves
    stampHeldAfterLanding: r3(M.press_scroll.start - stamp),
    keysPanelFrom: r3(keysFrom),
    keysPanelHeldFor: r3(s.end - WIPE_HALF / FPS - keysFrom),
  };
  if (s.notes.stampHeldFor < 3.5) throw new Error(`scene 6: the REJECTED stamp is held for ${s.notes.stampHeldFor} s, under 3.5 s`);
  if (s.notes.keysPanelHeldFor < 2.5) throw new Error(`scene 6: the keys panel is held for ${s.notes.keysPanelHeldFor} s, under 2.5 s`);
}
// ------------------------------------------------ scene 7: the evidence (L5a/b/c, three tagged cuts)
{
  const s = scene(7);
  const a = inClip('L5a');
  const b = inClip('L5b');
  const c = inClip('L5c');
  const verified = one(a, 'receipts:VERIFIED');
  const summary = one(a, 'click', 'npm run verify output');
  const busy = one(b, 'click', 'chart: BUSY');
  const explorer = one(c, 'explorer:DeleteKey+AddKey');
  const parts = [
    ['L5a', summary - 0.25, M.verify_output_open + 1.7], // the verify PASS lines
    ['L5b', busy - 0.15, busy + 1.75], // the 60-day chart drawing
    ['L5c', explorer - 0.3, explorer + 2.2], // the takeover on a public explorer, 2.5 s
  ];
  const rest = parts.reduce((x, [, p, q]) => x + (q - p), 0);
  const first = s.end - s.start - rest; // the steps and the VERIFIED stamp
  const a1 = M.receipts_scroll.start - 0.03; // until the page starts to scroll
  if (a1 - first < one(a, 'click', 'nav: Receipts') + 0.25) throw new Error('scene 7: the Receipts take is too short');
  s.notes = { verifiedHeldFor: r3(a1 - verified), stepsAndStamp: r3(first), passLines: r3(parts[0][2] - M.verify_output_open), chart: r3(parts[1][2] - busy), explorer: r3(parts[2][2] - parts[2][1]) };
  if (Math.min(...Object.values(s.notes)) < 1.5) throw new Error(`scene 7: a hold is under 1.5 s: ${JSON.stringify(s.notes)}`);
  let t = seg(7, s.start, 'L5a', a1 - first, a1);
  for (const [name, p, q] of parts) {
    cutTag(t);
    if (name === 'L5c') chyrons.push({ start: r3(t), end: s.end, tab: s.tab, headline: `${s.headline} · PUBLIC EXPLORER` });
    t = seg(7, t, name, p, q);
  }
  mustFit(7, say(7, s.start + 0.4, 0.45));
  beds.push({ start: s.start, end: s.end });
}
// ------------------------------------------------ scene 8: sign-off (card)
{
  const s = scene(8);
  const lines = mustFit(8, say(8, s.start + 0.4, 0.3));
  // Seven elements land one by one, 0.4 s apart; the closing stamp is the last.
  const lands = Array.from({ length: 7 }, (_, i) => r3(s.start + (WIPE_HALF + 1) / FPS + i * 0.4));
  s.marks = { lands, stamp: lands[6] };
  s.notes = { fullCardAfterLastWord: r3(s.end - heard(lines[3]).end), lastSoundBeforeEnd: r3(s.end - heard(lines[3]).end) };
  if (s.notes.fullCardAfterLastWord < 2.0) throw new Error(`scene 8: the full card is held ${s.notes.fullCardAfterLastWord} s after the last word, under 2 s`);
  sfx.push({ t: s.start, name: 'sting-short' }, { t: s.marks.stamp + 0.07, name: 'thud' });
}

// ---------------------------------------------------------------- chyrons, captions
// A scene's own chyron comes after any override for part of it, so the override wins.
for (const s of script.scenes) if (s.kind === 'live') chyrons.push({ start: s.start, end: s.end, tab: s.tab, headline: s.headline });

const captions = [];
for (const s of script.scenes) {
  const chunks = [];
  s.lines.forEach((line, i) => {
    const p = placed.find((x) => x.key === `s${s.n}_${i}`);
    const total = line.captions.reduce((n, c) => n + c.length, 0);
    let t = p.start;
    for (const text of line.captions) {
      if (text.length > 42) throw new Error(`caption over 42 characters: ${text}`);
      const d = ((p.end - p.start) * text.length) / total;
      chunks.push({ text, start: t, spokenEnd: t + d });
      t += d;
    }
    if (line.captions.join(' ') !== line.say) throw new Error(`scene ${s.n}: captions differ from the voiceover: ${line.say}`);
  });
  chunks.forEach((c, i) => {
    // On screen from just before it is spoken until the next chunk, at least 1.3 s.
    c.start = Math.max(s.start, c.start - 0.05, i ? chunks[i - 1].end : 0);
    const next = chunks[i + 1];
    // A short sentence comes up to 0.25 s early, so the next caption is not late for its voice.
    const short = next ? CAP_MIN - (next.start - 0.05 - c.start) : 0;
    if (short > 0) c.start = Math.max(s.start, i ? chunks[i - 1].end : 0, c.start - Math.min(short, 0.25));
    c.end = Math.min(s.end, Math.max(c.start + CAP_MIN, Math.min(next ? next.start - 0.05 : Infinity, c.spokenEnd + 0.7)));
    if (c.end - c.start < CAP_MIN - 1e-6) throw new Error(`scene ${s.n}: "${c.text}" would be on screen for ${(c.end - c.start).toFixed(2)} s`);
    captions.push({ scene: s.n, start: r3(frameOf(c.start) / FPS), end: r3(frameOf(c.end) / FPS), text: c.text });
  });
}

// ---------------------------------------------------------------- footage per output frame
const frames = Math.round(script.duration * FPS);
const footage = new Array(frames).fill(null);
for (const g of edl) {
  for (let f = frameOf(g.out0); f < frameOf(g.out1) && f < frames; f++) {
    footage[f] = frameAt(g.clip, g.src0 + (f / FPS - g.out0) * g.speed);
  }
}
for (const s of script.scenes) {
  for (let f = frameOf(s.start); f < frameOf(s.end); f++) {
    if ((s.kind === 'live') !== (footage[f] !== null)) throw new Error(`frame ${f} (scene ${s.n}) has ${footage[f] ? 'footage on a card' : 'no footage'}`);
  }
}

// The flash-forward: 1.2 s of this run's real rejection, cropped at native pixels
// around the ex-CEO panel (account name, stamp and NEAR's error stay together).
const stampSrc = M.rejected_stamp.first_seen;
const flashDir = join(OUT, 'flash');
rmSync(flashDir, { recursive: true, force: true });
mkdirSync(flashDir, { recursive: true });
const FLASH = { x: 392, y: 8, w: 560, h: 320, from: -0.1 };
for (let k = 0; k < scene(1).marks.insetFrames; k++) {
  const src = join(RUN, 'footage', frameAt('L4', stampSrc + FLASH.from + k / FPS));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `crop=${FLASH.w}:${FLASH.h}:${FLASH.x}:${FLASH.y}`, join(flashDir, `${String(k).padStart(2, '0')}.png`)]);
}

const timeline = {
  fps: FPS,
  duration: script.duration,
  frames,
  ticker: script.ticker,
  scenes: script.scenes.map(({ lines, ...s }) => s),
  wipes: script.scenes.slice(1).map((s) => frameOf(s.start)),
  wipeHalf: WIPE_HALF,
  chyrons,
  captions,
  tags,
  voice: placed,
  sfx: sfx.map((x) => ({ ...x, t: r3(x.t) })).sort((a, b) => a.t - b.t),
  beds,
  edl,
  flash: { ...FLASH, clip: 'L4', label: 'COMING UP · REAL TESTNET FOOTAGE' },
  poster: { frame: frameOf(stampOut + 1.6) },
  footageDir: join(RUN, 'footage'),
  footage,
};
writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(timeline));

const ts = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
for (const s of script.scenes) if (s.pace) console.log(`scene ${s.n}: voice starts ${s.pace.before.toFixed(2)} s in, ends ${s.pace.after.toFixed(2)} s before the end`, s.notes ?? '');
writeFileSync(join(OUT, 'captions.srt'), captions.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n'));

console.log('edit decision list');
for (const g of edl) console.log(`  scene ${g.scene}  ${g.out0.toFixed(2)}-${g.out1.toFixed(2)}  ${g.clip}  x${g.speed}`);
console.log('tags', tags.map((g) => `${g.text}@${g.start}-${g.end}`).join('  '));
console.log('voice');
for (const p of placed) console.log(`  ${p.start.toFixed(2)}-${p.end.toFixed(2)}  ${p.text}`);
console.log(`captions: ${captions.length}, shortest on screen ${Math.min(...captions.map((c) => c.end - c.start)).toFixed(2)} s`);
