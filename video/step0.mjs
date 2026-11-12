// Step 0 of docs/video-agent-prompt.md: check the live app has what the video
// needs, and screenshot each page at the recording size. Read-only: no signing.
//
//   node --import ./video/ts-resolve.mjs video/step0.mjs [height]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { balance, cto, history, S, seat } from '../e2e/chain.ts';
import { APP, OUT, VIEW } from './lib.mjs';

const height = Number(process.argv[2] ?? VIEW.height);
const dir = `${OUT}/step0`;
mkdirSync(dir, { recursive: true });

const s = await seat();
const [t] = await history(1);
console.log('seat', { ceo: s.ceo, price: cto(s.current_price), paid: s.paid && cto(s.paid) });
console.log('latest takeover', t && { index: t.index, ceo: t.ceo, previous: t.previous_ceo });
for (const who of [S.ani, S.budi]) console.log(who, cto(await balance(who)), 'CTOD');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: VIEW.width, height }, deviceScaleFactor: 1 });
const report = {};
const has = async (name, locator) => {
  report[name] = (await locator.count()) > 0;
};

await page.goto(APP);
await page.getByRole('heading', { level: 1 }).waitFor();
await page.waitForTimeout(2500);
await has('front: CEO stamp', page.getByText('CEO', { exact: true }));
await has('front: TAKE OVER', page.getByRole('link', { name: 'TAKE OVER →' }));
await has('front: seat price sticker', page.locator('.sticker'));
await has('footer: Testnet only', page.getByText(/Testnet only/).last());
await page.screenshot({ path: `${dir}/front-${height}.png` });
await page.screenshot({ path: `${dir}/front-full.png`, fullPage: true });

await page.getByRole('link', { name: 'TAKE OVER →' }).first().click();
await page.getByRole('button', { name: 'TAKE THE SEAT' }).waitFor();
await page.waitForTimeout(1500);
for (const part of ['bg', 'eyes', 'mouth', 'extra']) await has(`desk: tab ${part}`, page.locator(`#tab-${part}`));
await has('desk: play as budi', page.getByRole('radio', { name: new RegExp(`^${S.budi.replace(/\./g, '\\.')}`) }));
await page.screenshot({ path: `${dir}/desk-${height}.png` });
await page.screenshot({ path: `${dir}/desk-full.png`, fullPage: true });

await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Press office' }).click();
await page.getByRole('heading', { level: 1 }).waitFor();
await page.waitForTimeout(2500);
await has('press: TRY POSTING AS', page.getByRole('button', { name: /^TRY POSTING AS / }));
await has('press: keys panel', page.getByText('WHO HOLDS THE PEN'));
await has('press: ACTIVE', page.getByText('ACTIVE', { exact: true }));
await has('press: DELETED', page.getByText('DELETED', { exact: true }));
await has('press: Fired, but paid.', page.getByText('Fired, but paid.'));
await page.screenshot({ path: `${dir}/press-${height}.png` });
await page.screenshot({ path: `${dir}/press-full.png`, fullPage: true });

await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Receipts' }).click();
await page.getByText('VERIFIED', { exact: true }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);
await has('receipts: VERIFIED', page.getByText('VERIFIED', { exact: true }));
await has('receipts: npm run verify', page.getByText(/npm run verify · latest CI run/));
await has('receipts: 60-day chart', page.locator('polyline.a-draw'));
await page.screenshot({ path: `${dir}/receipts-${height}.png` });
await page.getByText(/npm run verify · latest CI run/).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${dir}/receipts-verify-${height}.png` });
await page.screenshot({ path: `${dir}/receipts-full.png`, fullPage: true });

// Element boxes, to judge what fits in one viewport.
report.boxes = {};
await browser.close();
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
console.log(report);
