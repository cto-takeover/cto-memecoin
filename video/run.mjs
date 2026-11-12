// Steps 2 and 3 of docs/video-agent-prompt.md: the story on demo-cto.testnet,
// filmed from the live app. Only the public site and its relayer are used
// ("Play as ani / budi"); this script reads no keys.
//
//   node --import ./video/ts-resolve.mjs video/run.mjs               the real run
//   node --import ./video/ts-resolve.mjs video/run.mjs --rehearsal   budi takes the seat from whoever holds it
//                                                                   (also the off-camera step when ani is CEO)
//
// The real run needs: ani is not CEO, and the price is back at the opening price
// (5 quiet minutes). Any NEAR error other than the expected rejection aborts it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import constants from '../reference/constants.json' with { type: 'json' };
import { announcements, balance, budget, cto, history, S, seat } from '../e2e/chain.ts';
import { APP, OUT, ROOT, VIEW, sleep } from './lib.mjs';
import { clipStats, openRecorder } from './rec.mjs';

const REHEARSAL = process.argv.includes('--rehearsal');
const ONE = 10n ** BigInt(constants.decimals);
const whole = (n) => BigInt(n) * ONE;
const PARTS = ['bg', 'eyes', 'mouth', 'extra'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Story faces: the part indexes live in scripts/deploy.mjs (which checks them
// against the face formula); read them from there instead of retyping.
const deploySrc = readFileSync(join(ROOT, 'scripts/deploy.mjs'), 'utf8');
const faceOf = (name) => {
  const m = new RegExp(`const ${name} = \\{([^}]+)\\}`).exec(deploySrc);
  if (!m) throw new Error(`${name} not found in scripts/deploy.mjs`);
  return Object.fromEntries([...m[1].matchAll(/(\w+): (\d+)/g)].map(([, k, v]) => [k, Number(v)]));
};
const P = constants.face_parts;
const faceId = (f) => f.bg * P.eyes * P.mouth * P.extra + f.eyes * P.mouth * P.extra + f.mouth * P.extra + f.extra + 1;
const ANI_FACE = faceOf('ANI_FACE');
const BUDI_FACE = faceOf('BUDI_FACE');
if (faceId(ANI_FACE) !== 2626 || faceId(BUDI_FACE) !== 672) throw new Error('story face ids do not match the formula');

const rec = await openRecorder();
const txs = {};
const fail = async (why) => {
  rec.ev('ABORT', { why });
  await rec.save({ rehearsal: REHEARSAL, aborted: why });
  await rec.browser.close();
  console.error(`\nABORTED: ${why}\nWait 5 quiet minutes and start again from Step 2.`);
  process.exit(1);
};
const relayerReply = (path) => rec.events.findLast((e) => e.name === 'relayer' && e.path === path);

try {
  // ------------------------------------------------------------ Step 2: the chain is ready
  const s0 = await seat();
  const state = await (await fetch(`${APP}/api/demo/state`)).json();
  rec.ev('chain:before', { ceo: s0.ceo, price: cto(s0.current_price), ani: { cto: cto(state.ani.cto), near: state.ani.near }, budi: { cto: cto(state.budi.cto), near: state.budi.near } });
  if (!REHEARSAL) {
    if (s0.ceo === S.ani) await fail('ani is CEO: run --rehearsal first (budi takes the seat off camera), then wait 5 quiet minutes');
    if (BigInt(s0.current_price) !== whole(constants.opening_price)) await fail(`the seat costs ${cto(s0.current_price)} CTO, not the opening price yet`);
  } else if (s0.ceo === S.budi) await fail('budi is CEO already: nothing to rehearse');
  for (const who of [S.ani, S.budi]) {
    if ((await balance(who)) < whole(constants.story_numbers.budi_pays)) await fail(`${who} holds less than ${constants.story_numbers.budi_pays} CTOD`);
  }

  const m = await rec.newPage();
  const { page } = m;
  const nav = (name) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name });
  const takeBtn = page.getByRole('button', { name: 'TAKE THE SEAT' });
  const dialog = page.getByRole('dialog', { name: 'Takeover complete' });
  const radio = (account) => page.getByRole('radio', { name: new RegExp(`^${esc(account)}`) });
  const swatch = (i) => page.getByRole('tabpanel').getByRole('button').nth(i);

  // ------------------------------------------------------------ off camera: ani takes the seat and posts
  if (!REHEARSAL) {
    await page.goto(`${APP}/takeover`);
    await takeBtn.waitFor();
    // budi is CEO, so the app already plays as ani. No "Play as" click here: an explicit
    // choice would stick to this browser session and show up later in budi's scene.
    if ((await radio(S.ani).getAttribute('aria-checked')) !== 'true') await fail('the app is not playing as ani by default');
    for (const part of PARTS) {
      await page.locator(`#tab-${part}`).click();
      await swatch(ANI_FACE[part]).click();
    }
    await page.getByText(`Face #${faceId(ANI_FACE).toLocaleString('en-US')} of`).waitFor({ timeout: 5000 });
    await budget('take-seat');
    const reply = page.waitForResponse((r) => r.url().endsWith('/api/demo/take-seat'));
    rec.ev('offcamera:ani-take-seat');
    await takeBtn.click();
    const r = await (await reply).json();
    if (r.error) await fail(`ani's takeover: ${JSON.stringify(r.error)}`);
    txs.ani_takeover = r.txHash;
    await dialog.waitFor({ timeout: 30_000 });
    const s1 = await seat();
    if (s1.ceo !== S.ani || BigInt(s1.paid) !== whole(constants.story_numbers.ani_pays_vacant) || BigInt(s1.current_price) !== whole(constants.story_numbers.budi_pays)) {
      await fail(`after ani's takeover the seat reads ${JSON.stringify({ ceo: s1.ceo, paid: cto(s1.paid), price: cto(s1.current_price) })}`);
    }
    rec.ev('chain:ani-is-ceo', { paid: cto(s1.paid), price: cto(s1.current_price), tx: r.txHash });

    await dialog.getByRole('link', { name: 'GO TO THE PRESS OFFICE →' }).click();
    await page.getByRole('radio', { name: /The face is mine until someone pays/ }).check();
    await budget('announce');
    const posted = page.waitForResponse((x) => x.url().endsWith('/api/demo/announce'));
    await page.getByRole('button', { name: 'SIGN AS THE COIN' }).click();
    const a = await (await posted).json();
    if (a.error) await fail(`ani's announcement: ${JSON.stringify(a.error)}`);
    txs.ani_announcement = a.txHash;
    await page.getByText(/✓ Signed by /).waitFor({ timeout: 20_000 });
    const [line] = await announcements(1);
    rec.ev('chain:ani-posted', { text: line.text, tx: a.txHash });
    // Let the page pick up the new press release before the cameras roll.
    await page.getByText(line.text).first().waitFor({ timeout: 15_000 });
  } else {
    await page.goto(`${APP}/press`);
    await page.getByRole('heading', { level: 1 }).waitFor();
  }
  const takenAt = Date.now();
  const before = await seat();
  const exCeo = before.ceo;
  const exWho = exCeo === S.ani ? 'ani' : 'budi';

  // ------------------------------------------------------------ L1: the boardroom (Front page, no clicks)
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await m.glide(1500, 92, 0);
  m.film('L1');
  await sleep(400);
  await m.click(nav('Front page'), 'nav: Front page', { dy: 12, dx: 30 });
  await page.getByRole('link', { name: 'TAKE OVER →' }).first().waitFor({ timeout: 10_000 });
  await page.getByRole('heading', { level: 1 }).filter({ hasText: exCeo }).waitFor({ timeout: 10_000 });
  rec.ev('front:shown');
  await m.glide(1610, 470, 700);
  await sleep(8500);
  const takeOver = page.getByRole('link', { name: 'TAKE OVER →' }).first();
  await m.hover(takeOver, { ms: 800, dx: 70, dy: 14 });
  await sleep(700);

  // ------------------------------------------------------------ L2: the hostile bid (Takeover desk, budi)
  await budget('take-seat');
  m.film('L2');
  await sleep(300);
  await m.click(takeOver, 'TAKE OVER', { ms: 0, dx: 70, dy: 14 });
  await takeBtn.waitFor();
  rec.ev('desk:shown');
  await m.glide(1610, 420, 500);
  const kicker = page.locator('p.kick', { hasText: /^Takeover desk/ });
  const kTop = (await kicker.boundingBox()).y;
  await m.wheel(kTop - 14, 550);
  await sleep(500);
  rec.ev('picks:start');
  for (const part of PARTS) {
    if (part !== 'bg') await m.click(page.locator(`#tab-${part}`), `tab: ${part}`, { ms: 280, pause: 260, dx: 18, dy: 12 });
    await m.click(swatch(BUDI_FACE[part]), `part: ${part} ${BUDI_FACE[part]}`, { ms: 280, pause: 260, dx: 26, dy: 26 });
  }
  rec.ev('picks:end');
  await page.getByText(`Face #${faceId(BUDI_FACE).toLocaleString('en-US')} of`).waitFor({ timeout: 5000 });
  const seenNow = seat();
  const btnBox = await takeBtn.boundingBox();
  await m.wheel(btnBox.y + btnBox.height + 22 - VIEW.height, 500);
  await sleep(150);
  await m.click(radio(S.budi), 'play as budi', { ms: 380, dx: 60, dy: 12 });
  if ((await radio(S.budi).getAttribute('aria-checked')) !== 'true') await fail('could not play as budi');
  if (!REHEARSAL && Date.now() - takenAt > (constants.coins.demo.decay_delay_s - 15) * 1000) await fail('budi is too late: the price is about to fall');
  const seen = await seenNow;
  if (seen.ceo !== exCeo || (!REHEARSAL && BigInt(seen.current_price) !== whole(constants.story_numbers.budi_pays))) await fail(`before budi's click the seat reads ${cto(seen.current_price)} CTO, CEO ${seen.ceo}`);
  const reply = page.waitForResponse((r) => r.url().endsWith('/api/demo/take-seat'));
  const tClick = await m.click(takeBtn, 'TAKE THE SEAT', { ms: 420, dx: 95, dy: 14 });

  // ------------------------------------------------------------ L3: the takeover sequence, as the app plays it
  const r = await (await reply).json();
  m.film('L3');
  if (r.error) await fail(`budi's takeover: ${JSON.stringify(r.error)}`);
  txs.budi_takeover = r.txHash;
  await dialog.waitFor({ timeout: 30_000 });
  const tDialog = rec.ev('sequence:start', { waitedMs: Math.round(Date.now() - tClick * 1000) });
  await dialog.locator('p.hd').filter({ hasText: `BREAKING: ${S.budi} IS THE NEW CEO` }).waitFor({ timeout: 10_000 });
  rec.ev('sequence:headline-typed');
  await dialog.getByText('Total burned').waitFor({ timeout: 10_000 });
  rec.ev('sequence:burn-shown');
  const press = dialog.getByRole('link', { name: 'GO TO THE PRESS OFFICE →' });
  await press.waitFor({ timeout: 10_000 });
  rec.ev('sequence:buttons-shown', { sinceStartMs: Math.round(Date.now() - tDialog * 1000) });
  const [t] = await history(1);
  rec.ev('chain:budi-is-ceo', { ceo: t.ceo, previous: t.previous_ceo, paid: cto(t.paid), payout: cto(t.payout), burned: cto(t.burned), face: t.face, tx: r.txHash });
  if (t.ceo !== S.budi || t.previous_ceo !== exCeo || faceId(t.face) !== faceId(BUDI_FACE)) await fail('the chain does not show budi as the new CEO with face #672');
  if (!REHEARSAL) {
    const n = constants.story_numbers;
    if (BigInt(t.paid) !== whole(n.budi_pays) || BigInt(t.payout) !== whole(n.ani_payout) || BigInt(t.burned) !== whole(n.burned_on_takeover)) await fail('the amounts on chain are not 1,400,000 / 1,150,000 / 250,000');
  }
  await sleep(Math.max(0, 10_500 - (Date.now() - tDialog * 1000)));

  // ------------------------------------------------------------ L4: locked out (Press office)
  m.film('L3-exit');
  await m.click(press, 'GO TO THE PRESS OFFICE', { ms: 600, dx: 120, dy: 14 });
  const tryBtn = page.getByRole('button', { name: `TRY POSTING AS ${exWho.toUpperCase()}` });
  await tryBtn.waitFor({ timeout: 20_000 });
  await page.getByText('DELETED', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText('ACTIVE', { exact: true }).waitFor({ timeout: 20_000 });
  await m.glide(1640, 300, 500);
  const panelTop = (await page.getByText(/tries to post as the coin$/).boundingBox()).y - 24;
  await m.wheel(panelTop - 14, 600);
  await sleep(1500);
  await budget('announce');
  m.film('L4');
  rec.ev('press:shown');
  await sleep(6500);
  const stamp = page.getByText('REJECTED BY NEAR');
  if (await stamp.count()) await fail('a REJECTED stamp is on screen before the click');
  const answered = page.waitForResponse((x) => x.url().endsWith('/api/demo/announce'));
  const tTry = await m.click(tryBtn, `TRY POSTING AS ${exWho.toUpperCase()}`, { ms: 650, dx: 120, dy: 16 });
  await m.glide(1640, 330, 600);
  const rej = await (await answered).json();
  rec.ev('near:answered', { sinceClickMs: Math.round(Date.now() - tTry * 1000) });
  if (rej.error?.source !== 'near' || !/AccessKeyNotFound$/.test(rej.error?.type ?? '')) await fail(`expected NEAR's AccessKeyNotFound, got ${JSON.stringify(rej).slice(0, 400)}`);
  await stamp.waitFor({ timeout: 10_000 });
  const tStamp = rec.ev('stamp:REJECTED BY NEAR', { sinceClickMs: Math.round(Date.now() - tTry * 1000) });
  txs.ex_ceo_rejected_post = { account: exCeo, error: rej.error.type, txHash: rej.txHash ?? null, at: new Date(tStamp * 1000).toISOString() };
  if (!(await page.getByTestId('near-error').innerText()).includes('AccessKeyNotFound')) await fail("NEAR's raw error is not on screen");
  await sleep(600);
  const deletedBox = await page.getByText('DELETED', { exact: true }).boundingBox();
  rec.ev('press:layout', { deletedBottom: Math.round(deletedBox.y + deletedBox.height), errorBox: await page.getByTestId('near-error').boundingBox() });
  await sleep(2700);
  const need = deletedBox.y + deletedBox.height + 170 - VIEW.height;
  if (need > 0) await m.wheel(need, 800);
  await sleep(7000);
  m.film(null);

  // ------------------------------------------------------------ L5: the evidence (Receipts, then the explorer)
  await page.evaluate(() => window.scrollTo(0, 0));
  await m.glide(1500, 140, 0);
  await sleep(500);
  m.film('L5a');
  await sleep(300);
  await m.click(nav('Receipts'), 'nav: Receipts', { dy: 12, dx: 26 });
  await m.glide(1640, 330, 600);
  await page.getByText('VERIFIED', { exact: true }).waitFor({ timeout: 40_000 });
  rec.ev('receipts:VERIFIED');
  await sleep(1400);
  const summary = page.getByText(/npm run verify · latest CI run/);
  await m.wheel((await page.getByText('Receipts · the calm page').boundingBox()).y - 14, 600);
  await m.click(summary, 'npm run verify output', { ms: 500, dx: -150, dy: 4 });
  await m.glide(1640, 420, 500);
  rec.ev('receipts:verify-open');
  await sleep(3000);
  m.film('L5b');
  await m.wheel((await page.getByRole('heading', { name: 'SUPPLY OVER 60 DAYS' }).boundingBox()).y - 40, 800);
  await sleep(700);
  await m.click(page.getByRole('tab', { name: 'QUIET' }), 'chart: QUIET', { ms: 500, dx: 20, dy: 12 });
  await m.glide(1640, 520, 500);
  await sleep(2600);
  await m.click(page.getByRole('tab', { name: 'BUSY' }), 'chart: BUSY', { ms: 500, dx: 16, dy: 12 });
  await m.glide(1640, 520, 500);
  rec.ev('chart:BUSY-drawing');
  await sleep(3000);
  m.film(null);

  // The same takeover on a public explorer: the receipt with DeleteKey + AddKey.
  // (testnet.nearblocks.io puts a bot check in front of headless browsers, so this
  // shot uses NEAR Rocks, the explorer run by FastNEAR.)
  const x = await rec.newPage();
  const explorer = `https://testnet.near.rocks/tx/${txs.budi_takeover}`;
  for (let i = 0; ; i++) {
    await x.page.goto(explorer);
    try {
      await x.page.getByText('DeleteKey', { exact: true }).first().waitFor({ timeout: 20_000 });
      break;
    } catch (e) {
      if (i >= 5) throw e;
      await sleep(10_000);
    }
  }
  const del = x.page.getByText('DeleteKey', { exact: true }).first();
  await x.page.getByText('AddKey').first().waitFor({ timeout: 5000 });
  await x.glide(1500, 260, 0);
  await sleep(1200);
  x.film('L5c');
  rec.ev('explorer:shown', { url: explorer });
  await sleep(1800);
  await x.wheel((await del.boundingBox()).y - 430, 900);
  const d = await del.boundingBox();
  await x.glide(d.x + 470, d.y + 30, 500);
  rec.ev('explorer:DeleteKey+AddKey');
  await sleep(4000);
  x.film(null);

  const after = await (await fetch(`${APP}/api/demo/state`)).json();
  rec.ev('chain:after', { ceo: after.ceo, ani: { cto: cto(after.ani.cto), near: after.ani.near }, budi: { cto: cto(after.budi.cto), near: after.budi.near } });
  txs.run = { rehearsal: REHEARSAL, coin: S.demo, at: new Date().toISOString() };
  await rec.save({ rehearsal: REHEARSAL, txs });
  writeFileSync(join(OUT, REHEARSAL ? 'txs-rehearsal.json' : 'txs.json'), JSON.stringify(txs, null, 2));
  for (const [name, c] of Object.entries(rec.clips)) console.log(name, clipStats(c));
  console.log(txs);
  await rec.browser.close();
} catch (e) {
  await fail(e.stack ?? String(e));
}
