// Shared by band.html and the three cards. Everything on screen is a pure
// function of the time `t` (seconds from the start of the video) and of
// ../out/timeline.json, so a frame renders the same way every time.
//
// A page calls `boot(draw)`; the renderer then calls `window.render(t)` once per
// frame. Opening a page with ?t=12.3 draws that moment for a look.

const TICKER_PX_PER_S = 150;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** 0 → 1 between t0 and t0 + d. */
export const ramp = (t, t0, d) => clamp((t - t0) / d);
export const easeOut = (k) => 1 - (1 - k) ** 3;
/** A stamp landing: big and clear, a small overshoot, then rest. Returns { scale, opacity }. */
export function thunk(t, t0, d = 0.3) {
  if (t < t0) return { scale: 2, opacity: 0 };
  const k = ramp(t, t0, d);
  const scale = k < 0.6 ? 2 - (1.1 * k) / 0.6 : 0.9 + (0.1 * (k - 0.6)) / 0.4;
  return { scale, opacity: clamp(k / 0.25) };
}
/** The 2-frame "page slam": the sheet jumps for two frames when something lands at t0. */
export function slam(t, marks, fps) {
  for (const m of marks) {
    const f = Math.round((t - m) * fps);
    if (f === 0) return 'translate(7px, -5px)';
    if (f === 1) return 'translate(-4px, 3px)';
  }
  return 'none';
}

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let TL;
let tickerWidth = 0;
const parts = {};

function buildBand(withChyron) {
  const band = el('div', 'band');
  if (withChyron) {
    const chyron = el('div', 'chyron');
    parts.tab = el('div', 'tab');
    parts.headline = el('div', 'headline');
    chyron.append(parts.tab, parts.headline, el('div', 'mast', 'THE CTO TIMES'));
    band.append(chyron);
  }
  const caption = el('div', 'caption');
  parts.caption = el('div', 'text');
  parts.tags = el('div', 'tags');
  caption.append(parts.caption, parts.tags);
  const ticker = el('div', 'ticker');
  parts.track = el('span', 'track');
  ticker.append(parts.track);
  band.append(caption, ticker);
  document.body.append(band);

  // One copy of the text is measured; enough copies follow to fill the width.
  parts.track.textContent = TL.ticker;
  tickerWidth = parts.track.getBoundingClientRect().width;
  parts.track.textContent = TL.ticker.repeat(Math.ceil(1920 / tickerWidth) + 2);
}

function drawBand(t) {
  // Constant-speed crawl, continuous across scenes: the offset depends on t only.
  const offset = Math.round((t * TICKER_PX_PER_S) % tickerWidth);
  parts.track.style.transform = `translateX(${-offset}px)`;

  const eps = 1e-6;
  const cap = TL.captions.find((c) => t >= c.start - eps && t < c.end - eps);
  parts.caption.textContent = cap ? cap.text : '';

  parts.tags.replaceChildren(
    ...TL.tags
      .filter((g) => t >= g.start - eps && t < g.end - eps)
      .map((g) => el('span', `tag ${g.kind}`, g.text)),
  );

  if (parts.tab) {
    const c = TL.chyrons.find((x) => t >= x.start - eps && t < x.end - eps);
    if (c) {
      const live = c.tab.startsWith('LIVE');
      parts.tab.className = `tab ${live ? 'live' : 'breaking'}`;
      parts.tab.replaceChildren(...(live ? [el('span', 'dot')] : []), document.createTextNode(c.tab));
      parts.headline.textContent = c.headline;
    }
  }
}

export async function boot(draw, { chyron = false } = {}) {
  TL = await (await fetch('../out/timeline.json', { cache: 'no-store' })).json();
  await Promise.all(
    ["400 40px 'Archivo Black'", "500 40px 'Space Grotesk'", "700 40px 'Space Grotesk'", "500 40px 'JetBrains Mono'", "700 40px 'JetBrains Mono'", "400 40px 'Luckiest Guy'"].map((f) =>
      document.fonts.load(f, 'THE CTO TIMES $·'),
    ),
  );
  await document.fonts.ready;
  buildBand(chyron);
  window.render = async (t) => {
    drawBand(t);
    await draw?.(t, TL);
  };
  window.timeline = TL;
  const q = new URLSearchParams(location.search).get('t');
  await window.render(q === null ? 0 : Number(q));
  window.ready = true;
}

export const scene = (TL, n) => TL.scenes.find((s) => s.n === n);
