// Step 6 of docs/video-agent-prompt.md: checks on the exported video, plus stills
// to look at (scene boundaries, stamps, every 2 s) in video/out/stills/.
//
//   node video/check.mjs [file.mp4]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, HERE, OUT, ROOT } from './lib.mjs';

const file = process.argv[2] ?? join(OUT, 'cto-demo-70s.mp4');
const voiceMeta = JSON.parse(readFileSync(join(OUT, 'voice', 'voice.json'), 'utf8'));
const TL = JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8'));
const script = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'));
const run = JSON.parse(readFileSync(join(OUT, 'events.json'), 'utf8'));
const constants = JSON.parse(readFileSync(join(ROOT, 'reference/constants.json'), 'utf8'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const ff = (args, opts = {}) => spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });

// ---------------------------------------------------------------- format
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }));
const v = probe.streams.find((s) => s.codec_type === 'video');
const a = probe.streams.find((s) => s.codec_type === 'audio');
const seconds = Number(probe.format.duration);
check('1920x1080, 30 fps, H.264, yuv420p', v.width === 1920 && v.height === 1080 && v.r_frame_rate === '30/1' && v.codec_name === 'h264' && v.pix_fmt === 'yuv420p', `${v.width}x${v.height} ${v.r_frame_rate} ${v.codec_name} ${v.pix_fmt}`);
check('AAC, 48 kHz', a?.codec_name === 'aac' && a?.sample_rate === '48000', `${a?.codec_name} ${a?.sample_rate}`);
check('68.0 to 70.0 s long', seconds >= 68.0 && seconds <= 70.0, `${seconds.toFixed(2)} s, ${v.nb_frames} frames`);
const loud = ff(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr;
const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(loud.slice(loud.lastIndexOf('Summary:')))?.[1]);
check('loudness about -14 LUFS', Math.abs(I + 14) <= 1, `${I} LUFS`);

const endPcm = ff(['-v', 'error', '-sseof', '-0.3', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { encoding: 'buffer' }).stdout;
let endPeak = 0;
for (let i = 0; i + 1 < endPcm.length; i += 2) endPeak = Math.max(endPeak, Math.abs(endPcm.readInt16LE(i)));
check('the last 0.3 s are quiet', endPeak / 32768 < 0.01, `peak ${(20 * Math.log10(Math.max(endPeak, 1) / 32768)).toFixed(0)} dBFS`);

// ---------------------------------------------------------------- every frame: ticker, band edge, brightness
// Three thin strips per frame, as gray bytes: the ticker row, the band's top
// edge (y 900-903, ink in live scenes), and a coarse picture for brightness.
const W = 1920;
const strip = (y, h) => ff(['-v', 'error', '-i', file, '-vf', `crop=${W}:${h}:0:${y},format=gray`, '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
const ticker = strip(1028, 52);
const edge = strip(901, 2);
const frames = ticker.length / (W * 52);
check('frame count matches the timeline', frames === TL.frames, `${frames} vs ${TL.frames}`);
let tickerBad = 0;
let edgeBad = 0;
const wipe = (f) => TL.wipes.some((b) => f >= b - TL.wipeHalf && f < b + TL.wipeHalf);
for (let f = 0; f < frames; f++) {
  const row = ticker.subarray(f * W * 52, (f + 1) * W * 52);
  let dark = 0;
  let light = 0;
  for (let i = 0; i < row.length; i += 3) {
    if (row[i] < 60) dark++;
    else if (row[i] > 170) light++;
  }
  const n = row.length / 3;
  if (dark / n < 0.7 || light / n < 0.03) tickerBad++;
  if (TL.footage[f] && !wipe(f)) {
    const e = edge.subarray(f * W * 2, (f + 1) * W * 2);
    let d = 0;
    for (let i = 0; i < e.length; i += 4) if (e[i] < 70) d++;
    if (d / (e.length / 4) < 0.98) edgeBad++;
  }
}
check('the ticker is on every frame', tickerBad === 0, `${tickerBad} frames without it`);
check('the band edge sits at y = 900 in every live frame (footage above, band below)', edgeBad === 0, `${edgeBad} frames`);

const luma = ff(['-v', 'error', '-i', file, '-vf', 'scale=64:36,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' }).stdout;
const mean = (f) => luma.subarray(f * 2304, (f + 1) * 2304).reduce((x, y) => x + y, 0) / 2304;
check('frame 0 is the masthead, not black', mean(0) > 120, `mean brightness ${mean(0).toFixed(0)}`);
let dips = 0;
for (let f = 1; f < frames - 1; f++) if (mean(f) < 40 || (Math.abs(mean(f) - mean(f - 1)) > 60 && Math.abs(mean(f) - mean(f + 1)) > 60)) dips++;
check('no black or flashing frames', dips === 0, `${dips} frames`);

// ---------------------------------------------------------------- the edit
check('frames 0-90 are the cold open; the live app is on by 11.0 s', TL.footage.slice(0, 91).every((x) => x === null) && TL.footage[Math.round(11.0 * TL.fps) + TL.wipeHalf] !== null && TL.scenes.find((s) => s.kind === 'live').start <= 11.0);
const cuts = [];
for (let i = 1; i < TL.edl.length; i++) {
  const [p, q] = [TL.edl[i - 1], TL.edl[i]];
  if (p.scene !== q.scene) continue;
  const pEnd = p.src0 + (p.out1 - p.out0) * p.speed;
  if (p.clip !== q.clip || Math.abs(q.src0 - pEnd) > 0.05) cuts.push(q);
}
const tagAt = (kind, t) => TL.tags.some((g) => g.kind === kind && Math.abs(g.start - t) < 0.02);
check('every cut inside a live scene has a CUT tag of 10 frames', cuts.every((c) => tagAt('cut', c.out0)) && TL.tags.filter((g) => g.kind === 'cut').every((g) => Math.round((g.end - g.start) * TL.fps) === 10), `${cuts.length} cuts, ${TL.tags.filter((g) => g.kind === 'cut').length} tags`);
const sped = TL.edl.filter((g) => g.speed !== 1);
check('speed-ups: only scene 4, at most 1.25x, tagged', sped.every((g) => g.scene === 4 && g.speed <= 1.25 && tagAt('speed', g.out0)), sped.length ? sped.map((g) => `scene ${g.scene} x${g.speed} ${g.out0}-${g.out1}`).join('; ') : 'none: everything plays at normal speed');
for (const n of [5, 6]) {
  const segs = TL.edl.filter((g) => g.scene === n);
  const s = TL.scenes.find((x) => x.n === n);
  check(`scene ${n} is one uncut take at 1x`, segs.length === 1 && segs[0].speed === 1 && !TL.tags.some((g) => g.start >= s.start && g.start < s.end));
}
const s6 = TL.scenes.find((x) => x.n === 6).notes;
check('the REJECTED stamp is held at least 3.5 s, the keys panel at least 2.5 s', s6.stampHeldFor >= 3.5 && s6.keysPanelHeldFor >= 2.5, `stamp on screen ${s6.stampHeldFor} s before the page scrolls (${s6.stampHeldAfterLanding} s after it lands), keys panel ${s6.keysPanelHeldFor} s; click ${s6.clickAt}, stamp ${s6.stampAt}, keys panel from ${s6.keysPanelFrom}`);
check('0.8 s of silence before the REJECTED thud', s6.silenceBeforeThud >= 0.8 - 1e-6, `${s6.silenceBeforeThud} s`);
const note = (n) => TL.scenes.find((x) => x.n === n).notes;
check('scene 4: the finished face is on screen at least 0.5 s before TAKE THE SEAT is clicked', note(4).faceOnScreenBeforeClick >= 0.5, `${note(4).faceOnScreenBeforeClick} s (${(note(4).cut - note(4).faceDone).toFixed(2)} s before the cut, the rest after it)`);
check('scene 5: the voice starts after FIRED! lands; the finished sequence is held at least 1 s', TL.voice.find((x) => x.scene === 5).start > note(5).sequenceStart && note(5).heldAfter >= 1, `sequence at ${note(5).sequenceStart}, ${note(5).sequenceSeconds} s long, held ${note(5).heldAfter} s`);
check('scene 7: steps + VERIFIED, PASS lines, chart at least 1.5 s each; explorer 2.5 s', Math.min(note(7).verifiedHeldFor, note(7).passLines, note(7).chart) >= 1.5 && note(7).explorer >= 2.5, JSON.stringify(note(7)));
check('scene 8: the full card is held at least 2 s after the last word', note(8).fullCardAfterLastWord >= 2, `${note(8).fullCardAfterLastWord} s`);
check('the voice is never faster than 1.0x', Object.values(voiceMeta).every((x) => x.speed <= 1.0), [...new Set(Object.values(voiceMeta).map((x) => x.speed))].join(', '));
check('every scene: at least 0.4 s before the voice and 0.5 s after it', TL.scenes.every((x) => x.pace.before >= 0.4 - 1e-3 && x.pace.after >= 0.5 - 1e-3), TL.scenes.map((x) => `${x.n}: ${x.pace.before}/${x.pace.after}`).join('  '));
const rulesAfter = note(2).rulesAfterVoice;
check('scene 2: the RULES box is held 1.5 s after the voice ends', rulesAfter >= 1.5, `${rulesAfter} s after the voice; on screen ${note(2).rulesOnScreen} s in all`);

// ---------------------------------------------------------------- text
check('captions: at most 42 characters, at least 1.3 s each', TL.captions.every((c) => c.text.length <= 42 && c.end - c.start >= 1.3 - 1e-6), `${TL.captions.length} chunks`);
const late = TL.captions.map((c) => {
  const line = TL.voice.find((x) => x.scene === c.scene && x.start <= c.end && x.end >= c.start);
  return line ? 0 : 1;
});
check('every caption overlaps its sentence in the voice track', late.every((x) => x === 0));
const bandText = [TL.ticker, ...TL.chyrons.flatMap((c) => [c.tab, c.headline]), ...TL.captions.map((c) => c.text), ...TL.tags.filter((g) => g.kind !== 'speed').map((g) => g.text)];
const digits = bandText.filter((t) => /\d/.test(t));
check('the band shows no numbers except a "1.25x" tag', digits.length === 0 && TL.tags.filter((g) => g.kind === 'speed').every((g) => g.text === '1.25x'), digits.join(' | '));
check('"TESTNET ONLY · NOTHING FOR SALE" is in the ticker', TL.ticker.includes('TESTNET ONLY · NOTHING FOR SALE'));

const BANNED = ['win', 'jackpot', 'bet', '777', 'moon', 'pump', 'gains', 'profit', 'rich', 'early', 'invest', 'guaranteed', "don't miss"];
const cardText = readdirSync(join(HERE, 'broadcast'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => readFileSync(join(HERE, 'broadcast', f), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' '))
  .join(' ');
const scanned = [readFileSync(join(OUT, 'captions.srt'), 'utf8'), cardText, ...bandText, ...script.scenes.flatMap((s) => s.lines.map((l) => l.say))].join('\n');
const hits = BANNED.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(scanned));
check('no banned words in captions, cards, band or voiceover', hits.length === 0, hits.length ? hits.join(', ') : `scanned for: ${BANNED.join(', ')}`);

// ---------------------------------------------------------------- the chain
const n = constants.story_numbers;
const commas = (x) => Number(x).toLocaleString('en-US');
const chain = run.events.find((e) => e.name === 'chain:budi-is-ceo');
const ani = run.events.find((e) => e.name === 'chain:ani-is-ceo');
check('amounts on chain match the script: 1,000,000 → 1,400,000 / 1,150,000 / 250,000', ani?.paid === commas(n.ani_pays_vacant) && chain?.paid === commas(n.budi_pays) && chain?.payout === commas(n.ani_payout) && chain?.burned === commas(n.burned_on_takeover), `ani paid ${ani?.paid}; budi paid ${chain?.paid}, ani got ${chain?.payout}, burned ${chain?.burned}`);
const rejected = run.txs?.ex_ceo_rejected_post;
check("the rejection is NEAR's AccessKeyNotFound", /AccessKeyNotFound$/.test(rejected?.error ?? ''), rejected?.error);

// ---------------------------------------------------------------- stills to look at
const stills = join(OUT, 'stills');
rmSync(stills, { recursive: true, force: true });
mkdirSync(stills, { recursive: true });
const want = new Map();
const add = (f, label) => f >= 0 && f < frames && !want.has(f) && want.set(f, label);
for (let t = 0; t < TL.duration; t += 2) add(Math.round(t * TL.fps), 'every-2s');
for (const s of TL.scenes) {
  add(Math.round(s.start * TL.fps) + TL.wipeHalf, `scene${s.n}-first`);
  add(Math.round(s.end * TL.fps) - TL.wipeHalf - 1, `scene${s.n}-last`);
  for (const [k, t] of Object.entries(s.marks ?? {})) if (typeof t === 'number' && t > 1 && k !== 'insetFrames') add(Math.round(t * TL.fps) + 12, `scene${s.n}-${k}`);
}
add(0, 'frame0');
add(12 + Math.round(TL.scenes[0].marks.stamp * TL.fps), 'scene1-stamp');
for (const c of TL.sfx.filter((x) => x.name === 'thud')) add(Math.round(c.t * TL.fps) + 12, 'stamp');
for (const g of TL.tags) add(Math.round(g.start * TL.fps) + 3, `tag-${g.kind}`);
for (const t of TL.scenes.find((s) => s.n === 8).marks.lands) add(Math.round(t * TL.fps) + 8, 'signoff-lands');
add(TL.poster.frame, 'poster');
const list = [...want.keys()].sort((x, y) => x - y);
ff(['-v', 'error', '-i', file, '-vf', `select='${list.map((f) => `eq(n\\,${f})`).join('+')}'`, '-vsync', '0', join(stills, 'tmp-%04d.png')]);
list.forEach((f, i) => execFileSync('mv', [join(stills, `tmp-${String(i + 1).padStart(4, '0')}.png`), join(stills, `${(f / TL.fps).toFixed(2).padStart(5, '0')}s-${want.get(f)}.png`)]));
console.log(`\n${list.length} stills in ${stills}`);

// ---------------------------------------------------------------- hosted demo (HACKATHON.md Q-012)
try {
  const st = await (await fetch(`${APP}/api/demo/state`)).json();
  const near = (x) => Number(BigInt(x) / 10n ** 20n) / 10_000;
  const cto = (x) => (BigInt(x) / 10n ** 18n).toLocaleString('en-US');
  const perTakeover = Number(constants.take_seat_attached_near) + 0.001;
  for (const who of ['ani', 'budi']) {
    const left = near(st[who].near);
    console.log(`${st[who].account}: ${left} NEAR, ${cto(st[who].cto)} CTOD → about ${Math.floor((left - 1) / perTakeover)} more takeovers${left < 5 ? '  ** BELOW 5 NEAR **' : ''}`);
  }
} catch (e) {
  console.log(`demo state not read: ${e.message}`);
}

const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'check.json'), JSON.stringify({ file, seconds, results }, null, 2));
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
