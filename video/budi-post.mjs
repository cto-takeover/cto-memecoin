// Off camera, after the run: budi (the CEO) posts one line as the coin through the
// app, and a public explorer is read for the payout. Evidence for the spec 3
// testnet boxes; adds `budi_announcement` and `explorer` to video/out/txs.json.
//
//   node --import ./video/ts-resolve.mjs video/budi-post.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { announcements, budget, S, seat } from '../e2e/chain.ts';
import { APP, OUT } from './lib.mjs';

const file = join(OUT, 'txs.json');
const txs = JSON.parse(readFileSync(file, 'utf8'));
if ((await seat()).ceo !== S.budi) throw new Error('budi is not CEO any more');
const [before] = await announcements(1);
const posted = Boolean(txs.budi_announcement);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
if (!posted) {
  await page.goto(`${APP}/press`);
  await page.getByRole('radio', { name: /The face is mine until someone pays/ }).check();
  await budget('announce');
  const reply = page.waitForResponse((r) => r.url().endsWith('/api/demo/announce'));
  await page.getByRole('button', { name: 'SIGN AS THE COIN' }).click();
  const body = await (await reply).json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  await page.getByText(/✓ Signed by /).waitFor({ timeout: 20_000 });
  const [after] = await announcements(1);
  if (after.index !== before.index + 1 || after.ceo !== S.budi) throw new Error('the post is not in get_announcements');
  txs.budi_announcement = { txHash: body.txHash, index: after.index, text: after.text };
}

// What a public explorer shows for budi's takeover.
const url = `https://testnet.near.rocks/tx/${txs.budi_takeover}`;
await page.goto(url);
await page.getByText('DeleteKey', { exact: true }).first().waitFor({ timeout: 30_000 });
await page.getByText(/CTOD/).first().waitFor({ timeout: 30_000 }); // token amounts load after the page
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
txs.explorer = {
  url,
  transfer: /budi-cto\.testnet → ani-cto\.testnet ([\d.]+ CTOD)/.exec(text)?.[1] ?? null,
  burn: /Burn budi-cto\.testnet → ([\d.]+ CTOD)/.exec(text)?.[1] ?? null,
  deleteKey: text.includes('DeleteKey'),
  addKey: /AddKey \(FunctionCall → demo-cto\.testnet\)/.test(text),
};
await browser.close();
writeFileSync(file, JSON.stringify(txs, null, 2));
console.log(txs);
