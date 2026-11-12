#!/usr/bin/env node
// Link-preview image: writes web/public/og.png (1200×630) for og:image / twitter:image.
// Renders an HTML card in the DESIGN.md "Boardroom Tabloid" style with the launch
// face (Face [0,0,1,0], drawn by web/src/lib/faces.ts, the same SVG as the chain's
// face_svg) and screenshots it with Playwright's chromium. Same input, same PNG.
//   node scripts/og-image.mjs            (run `npx playwright install chromium` once if needed)
// Fonts come from Google Fonts like the app; without network the fallbacks are used.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'web/public/og.png');
// Node ≥ 23 strips the types from the generated faces module on import.
const { faceSvg } = await import(join(ROOT, 'web/src/lib/faces.ts'));
const LAUNCH_FACE = { bg: 0, eyes: 0, mouth: 1, extra: 0 };

// DESIGN.md tokens.
const C = { paper: '#FFF6E0', ink: '#111111', near: '#00EC97', red: '#D7141A', hi: '#FFD60A', muted: '#5C5346', card: '#FFFFFF' };
const face = faceSvg(LAUNCH_FACE).replace('width="200" height="200"', 'width="360" height="360"');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@500;700&family=Luckiest+Guy&family=Space+Grotesk:wght@500;700&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: ${C.paper}; color: ${C.ink}; font-family: 'Space Grotesk', system-ui, sans-serif; }
  .page { position: relative; width: 1200px; height: 630px; display: flex; flex-direction: column;
    background-image: radial-gradient(#e9d9b0 1.6px, transparent 1.8px); background-size: 14px 14px; }
  .mast { display: flex; justify-content: space-between; align-items: flex-end; padding: 26px 56px 14px; border-bottom: 6px solid ${C.ink}; background: ${C.paper}; }
  .mast .name { font-family: 'Archivo Black', Impact, sans-serif; font-size: 44px; line-height: 1; letter-spacing: -0.01em; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .mast .ed { font-size: 17px; font-weight: 700; letter-spacing: .1em; }
  .body { flex: 1; display: flex; align-items: center; gap: 56px; padding: 0 56px; }
  .facewrap { position: relative; flex: none; }
  .card { background: ${C.card}; border: 5px solid ${C.ink}; box-shadow: 10px 10px 0 ${C.ink}; padding: 14px; transform: rotate(-1.5deg); }
  .card svg { display: block; }
  .stamp { position: absolute; top: -22px; right: -30px; font-family: 'Luckiest Guy', cursive; font-size: 46px; letter-spacing: .04em; line-height: 1.1;
    padding: 8px 18px 2px; border: 5px solid ${C.ink}; background: ${C.near}; color: ${C.ink}; transform: rotate(-8deg); }
  .copy { display: grid; gap: 18px; }
  .kick { font-size: 18px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .ticker { font-family: 'Archivo Black', Impact, sans-serif; font-size: 150px; line-height: .92; letter-spacing: -0.02em; margin: 0; }
  .tag { font-size: 38px; font-weight: 700; line-height: 1.15; margin: 0; max-width: 620px; }
  .tag .red { color: ${C.red}; }
  .sticker { justify-self: start; background: ${C.hi}; border: 4px solid ${C.ink}; box-shadow: 5px 5px 0 ${C.ink}; padding: 8px 18px; transform: rotate(-3deg);
    font-size: 26px; font-weight: 700; }
  .foot { background: ${C.ink}; color: ${C.paper}; padding: 14px 56px; font-size: 18px; display: flex; justify-content: space-between; }
</style></head>
<body><div class="page">
  <div class="mast">
    <div class="name">THE CTO TIMES</div>
    <div class="ed mono">TESTNET EDITION · ctotimes.xyz</div>
  </div>
  <div class="body">
    <div class="facewrap">
      <div class="card">${face}</div>
      <div class="stamp">CEO</div>
    </div>
    <div class="copy">
      <div class="kick mono">There can only be one CEO</div>
      <p class="ticker">$CTO</p>
      <p class="tag">The memecoin where anyone can take over · <span class="red">Fired, but paid</span></p>
      <div class="sticker mono">NEAR testnet</div>
    </div>
  </div>
  <div class="foot mono"><span>Testnet only · no sale · no admin keys · open source</span><span>ctotimes.xyz</span></div>
</div></body></html>`;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle', timeout: 20_000 }).catch(() => page.setContent(html, { waitUntil: 'load' }));
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return ['Archivo Black', 'Space Grotesk', 'JetBrains Mono', 'Luckiest Guy'].map((f) => `${f}: ${document.fonts.check(`700 20px "${f}"`) ? 'loaded' : 'FALLBACK'}`);
  });
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`wrote ${OUT}\n${fonts.join('\n')}`);
} finally {
  await browser.close();
}
