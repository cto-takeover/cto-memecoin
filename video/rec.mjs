// Recording helpers: a Chromium page at the recording size, a CDP screencast that
// writes every frame with its timestamp, a visible cursor (headless Chromium draws
// none), human-paced mouse moves, and an event log.
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { OUT, VIEW, sleep } from './lib.mjs';

/** Runs in the page before any app code: an ink arrow with a cream outline, plus a click ring. */
function cursorScript() {
  const make = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:36px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);will-change:transform';
    c.innerHTML =
      '<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg"><path d="M3 2 L3 27 L9.5 21.2 L14 31.5 L18.6 29.5 L14.2 19.4 L23 19 Z" fill="#111111" stroke="#FFF6E0" stroke-width="2" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div');
    ring.id = '__ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border:3px solid #111111;border-radius:50%;box-shadow:0 0 0 2px #FFF6E0;z-index:2147483646;pointer-events:none;opacity:0';
    document.documentElement.append(ring, c);
    const place = (e) => {
      c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`;
    };
    window.addEventListener('mousemove', place, true);
    window.addEventListener(
      'mousedown',
      (e) => {
        place(e);
        ring.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
        ring.animate(
          [
            { opacity: 0.9, scale: '0.35' },
            { opacity: 0, scale: '1.15' },
          ],
          { duration: 420, easing: 'ease-out' },
        );
      },
      true,
    );
  };
  if (document.documentElement) make();
  document.addEventListener('DOMContentLoaded', make);
}

export async function openRecorder({ height = VIEW.height, quality = 92 } = {}) {
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  const context = await browser.newContext({ viewport: { width: VIEW.width, height }, deviceScaleFactor: 1, reducedMotion: 'no-preference', locale: 'en-US' });
  await context.addInitScript(cursorScript);

  const events = [];
  const clips = {};
  const pending = [];
  const now = () => Date.now() / 1000;
  /** Log one event (clicks, responses, DOM moments) with a wall-clock timestamp. */
  const ev = (name, data = {}) => {
    const e = { t: now(), name, ...data };
    events.push(e);
    console.log(`[${new Date(e.t * 1000).toISOString().slice(11, 23)}] ${name}`, Object.keys(data).length ? JSON.stringify(data) : '');
    return e.t;
  };

  /** One page with its own screencast; frames go to the clip named by `film()`. */
  async function newPage() {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const state = { clip: null, mouse: { x: VIEW.width - 200, y: 420 } };
    cdp.on('Page.screencastFrame', (f) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
      const clip = state.clip;
      if (!clip) return;
      const i = clip.frames.length;
      const file = `${String(i).padStart(6, '0')}.jpg`;
      clip.frames.push({ t: f.metadata.timestamp, file });
      pending.push(writeFile(join(clip.dir, file), Buffer.from(f.data, 'base64')));
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: VIEW.width, maxHeight: height, everyNthFrame: 1 });

    /** Send the frames that follow to `name` (null: not filming). Never stops the screencast. */
    const film = (name) => {
      if (name === null) {
        if (state.clip) ev('clip:end', { clip: state.clip.name, frames: state.clip.frames.length });
        state.clip = null;
        return;
      }
      const dir = join(OUT, 'footage', name);
      mkdirSync(dir, { recursive: true });
      if (state.clip) ev('clip:end', { clip: state.clip.name, frames: state.clip.frames.length });
      clips[name] = state.clip = { name, dir, frames: [] };
      ev('clip:start', { clip: name });
      // A still page sends no frames; an invisible repaint makes it send one now.
      void page
        .evaluate(() => {
          const c = document.getElementById('__cursor');
          if (c) c.style.opacity = c.style.opacity === '0.999' ? '1' : '0.999';
        })
        .catch(() => undefined);
    };

    /** Move the pointer like a hand would: eased, about `ms` long. */
    const glide = async (x, y, ms = 420) => {
      const from = { ...state.mouse };
      const steps = Math.max(2, Math.round(ms / 16));
      const t0 = Date.now();
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
        const due = t0 + (ms * i) / steps;
        if (due > Date.now()) await sleep(due - Date.now());
      }
      state.mouse = { x, y };
    };
    const center = async (locator) => {
      const b = await locator.boundingBox({ timeout: 10_000 });
      if (!b) throw new Error('nothing to point at');
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      if (cx < 0 || cy < 0 || cx > VIEW.width || cy > page.viewportSize().height) throw new Error(`the target is off screen at ${Math.round(cx)},${Math.round(cy)}`);
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
    };
    /** Move to the element, wait a beat, click. Logs the click. */
    const click = async (locator, label, { ms = 420, pause = 300, dx = 0, dy = 0 } = {}) => {
      const p = await center(locator);
      await glide(p.x + dx, p.y + dy, ms);
      await sleep(pause);
      const t = ev('click', { label, x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
      await page.mouse.down();
      await sleep(70);
      await page.mouse.up();
      return t;
    };
    const hover = async (locator, { ms = 420, dx = 0, dy = 0 } = {}) => {
      const p = await center(locator);
      await glide(p.x + dx, p.y + dy, ms);
    };
    /** Scroll with the wheel, eased, about `ms` long (0: at once). */
    const wheel = async (dy, ms = 700) => {
      dy = Math.round(dy);
      if (!dy) return;
      const steps = ms ? Math.max(2, Math.round(ms / 16)) : 1;
      const t0 = Date.now();
      let sent = 0;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const target = Math.round(dy * e);
        if (target !== sent) await page.mouse.wheel(0, target - sent);
        sent = target;
        const due = t0 + (ms * i) / steps;
        if (due > Date.now()) await sleep(due - Date.now());
      }
      ev('scroll', { dy, ms, y: await page.evaluate(() => Math.round(window.scrollY)) });
    };

    // Every relayer answer goes into the log, unedited (tx hashes, NEAR's errors).
    page.on('response', (r) => {
      const url = new URL(r.url());
      if (!url.pathname.startsWith('/api/demo/') || r.request().method() !== 'POST') return;
      const t = now();
      void r
        .json()
        .then((body) => {
          const e = { t, name: 'relayer', path: url.pathname, status: r.status(), request: r.request().postDataJSON(), body };
          events.push(e);
          console.log(`[relayer] ${url.pathname} ${r.status()} ${JSON.stringify(body).slice(0, 200)}`);
        })
        .catch(() => undefined);
    });
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/demo/') && r.method() === 'POST') ev('relayer:request', { path: new URL(r.url()).pathname });
    });

    return { page, cdp, film, glide, click, hover, wheel, state };
  }

  /** Write events.json and one index per clip, after all frames are on disk. */
  async function save(extra = {}) {
    await Promise.all(pending);
    mkdirSync(OUT, { recursive: true });
    for (const c of Object.values(clips)) writeFileSync(join(c.dir, 'index.json'), JSON.stringify({ clip: c.name, frames: c.frames }));
    writeFileSync(join(OUT, 'events.json'), JSON.stringify({ ...extra, events }, null, 2));
  }

  return { browser, context, newPage, ev, events, clips, save, now };
}

/** Frames per second actually captured in a clip (the screencast sends a frame per repaint). */
export function clipStats(clip) {
  const f = clip.frames;
  if (f.length < 2) return { frames: f.length, seconds: 0, fps: 0, maxGapMs: 0 };
  let maxGap = 0;
  for (let i = 1; i < f.length; i++) maxGap = Math.max(maxGap, f[i].t - f[i - 1].t);
  const seconds = f[f.length - 1].t - f[0].t;
  return { frames: f.length, seconds: +seconds.toFixed(2), fps: +((f.length - 1) / seconds).toFixed(1), maxGapMs: Math.round(maxGap * 1000) };
}
