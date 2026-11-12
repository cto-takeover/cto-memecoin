// Renders the broadcast package frame by frame: the band under the footage
// (scenes 3-7), the three full-frame cards (scenes 1, 2, 8) and the 10 wipe frames.
// The pages draw from a frame clock (window.render(t)), never from wall-clock
// time, so captions and tags are frame-exact and a re-render gives the same PNGs.
//
//   node video/render.mjs [band|cards|wipe ...] [--frames 0-89]
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';
import { BAND, FRAME, HERE, OUT } from './lib.mjs';

const args = process.argv.slice(2);
const range = (() => {
  const i = args.indexOf('--frames');
  if (i < 0) return null;
  const [a, b] = args[i + 1].split('-').map(Number);
  return [a, b ?? a];
})();
const want = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--frames');
const doing = (what) => want.length === 0 || want.includes(what);

const TL = JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

// A local static server for video/ only (the pages fetch ../out/timeline.json and fonts).
const server = createServer((req, res) => {
  const path = normalize(join(HERE, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(HERE) || !existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/broadcast`;

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
const name = (f) => `${String(f).padStart(6, '0')}.png`;
const inRange = (f) => !range || (f >= range[0] && f <= range[1]);

async function open(file, size) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => {
    throw e;
  });
  page.on('console', (m) => m.type() === 'error' && console.error(`[${file}] ${m.text()}`));
  await page.goto(`${base}/${file}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 15_000 });
  return page;
}

async function shoot(page, dir, list, opts = {}) {
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  let n = 0;
  for (const f of list) {
    if (!inRange(f)) continue;
    await page.evaluate((t) => window.render(t), f / TL.fps);
    await page.screenshot({ path: join(dir, name(f)), type: 'png', ...opts });
    n++;
  }
  console.log(`${dir.replace(`${OUT}/`, '')}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const framesOf = (s) => Array.from({ length: Math.round((s.end - s.start) * TL.fps) }, (_, i) => Math.round(s.start * TL.fps) + i);

if (doing('band')) {
  const page = await open('band.html', BAND);
  await shoot(page, join(OUT, 'band'), TL.scenes.filter((s) => s.kind === 'live').flatMap(framesOf));
  await page.close();
}
if (doing('cards')) {
  for (const s of TL.scenes.filter((x) => x.kind === 'card')) {
    const page = await open(`${s.card}.html`, FRAME);
    await shoot(page, join(OUT, 'cards'), framesOf(s));
    await page.close();
  }
}
if (doing('wipe')) {
  const page = await browser.newPage({ viewport: { width: FRAME.width, height: FRAME.height - 52 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/wipe.html`);
  await page.waitForFunction(() => window.ready === true);
  mkdirSync(join(OUT, 'wipe'), { recursive: true });
  for (let i = 0; i < 2 * TL.wipeHalf; i++) {
    await page.evaluate((k) => window.render(k), i);
    await page.screenshot({ path: join(OUT, 'wipe', `${i}.png`), type: 'png', omitBackground: true });
  }
  console.log(`wipe: ${2 * TL.wipeHalf} frames`);
  await page.close();
}

await browser.close();
server.close();
