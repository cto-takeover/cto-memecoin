// E2E-1, 2, 3, 4 and 6: the judge's story with real clicks on the demo coin.
// Each test reads the seat first and adapts (whoever is not CEO takes the seat).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { announcements, balance, budget, cto, demoWho, history, S, seat, supply, taker, txStatus, type Face } from './chain';

const PARTS = ['bg', 'eyes', 'mouth', 'extra'] as const;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Takeover desk: pick 4 parts and play as `account`. Returns the face picked. */
async function prepareDesk(page: Page, account: string): Promise<Face> {
  const player = page.getByRole('radio', { name: new RegExp(`^${escape(account)}`) });
  await player.click();
  await expect(player).toHaveAttribute('aria-checked', 'true');
  const face = {} as Face;
  for (const part of PARTS) {
    await page.locator(`#tab-${part}`).click();
    const swatches = page.getByRole('tabpanel').getByRole('button');
    const pick = Math.floor(Math.random() * (await swatches.count()));
    await swatches.nth(pick).click();
    await expect(swatches.nth(pick)).toHaveAttribute('aria-pressed', 'true');
    face[part] = pick;
  }
  await expect(page.getByRole('button', { name: 'TAKE THE SEAT' })).toHaveAttribute('aria-disabled', 'false');
  return face;
}

async function affordable(account: string, price: string) {
  const have = await balance(account);
  expect(have >= BigInt(price), `${account} has ${cto(have)} CTO, the seat costs ${cto(price)}; wait a few minutes for the demo price to decay`).toBe(true);
}

/** E2E-1 (and E2E-6 with reduced motion): Front page → desk → takeover → Front page. */
async function takeover(page: Page, during?: (dialog: Locator) => Promise<void>) {
  const before = await seat();
  const supplyBefore = await supply();
  const { account } = taker(before);
  await affordable(account, before.current_price);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'TAKE OVER →' }).first().click();
  await expect(page).toHaveURL(/\/takeover/);
  const face = await prepareDesk(page, account);

  await budget('take-seat');
  await page.getByRole('button', { name: 'TAKE THE SEAT' }).click();
  const dialog = page.getByRole('dialog', { name: 'Takeover complete' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator('p.hd')).toHaveText(`BREAKING: ${account} IS THE NEW CEO`);

  // The chain agrees with what the sequence showed.
  const [t] = await history(1);
  expect(t.ceo).toBe(account);
  expect(t.previous_ceo).toBe(before.ceo);
  expect(t.face).toEqual(face);
  expect(await supply()).toBe(supplyBefore - BigInt(t.burned));
  if (t.previous_ceo) await expect(dialog).toContainText(`+${cto(t.payout)} CTO → ${t.previous_ceo}`);
  await during?.(dialog);

  // The tx link points at the real, successful take_seat.
  const link = dialog.getByRole('link', { name: /view on explorer/ });
  const href = (await link.getAttribute('href')) ?? '';
  const hash = /\/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})$/.exec(href)?.[1];
  expect(hash, href).toBeTruthy();
  if (S.explorer) expect(href).toBe(`https://testnet.nearblocks.io/txns/${hash}`);
  const tx = await txStatus(hash!, account);
  expect(Object.keys(tx.status)).toEqual(['SuccessValue']);

  await page.getByRole('button', { name: 'Close' }).click();
  const started = Date.now();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Front page' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(account, { timeout: 6_000 });
  expect(Date.now() - started).toBeLessThan(6_000);
}

test('E2E-1 takeover, desktop 1920×1080', async ({ page }) => {
  await takeover(page);
});

test('E2E-2 wow moment: the ex-CEO is rejected by NEAR', async ({ page }) => {
  // Needs a takeover between ani and budi; on a fresh chain the first one took a vacant seat.
  if (!demoWho((await history(1))[0]?.previous_ceo ?? null)) await takeover(page);
  const [latest, previous] = await history(2);
  const who = demoWho(latest.previous_ceo);
  expect(who, 'the latest takeover replaced a demo account').toBeTruthy();

  await page.goto('/press');
  const stamp = page.getByText('REJECTED BY NEAR');
  let stampsBeforeResponse = -1;
  let body: { error?: { source: string; type: string } } = {};
  await page.route('**/api/demo/announce', async (route) => {
    const response = await route.fetch();
    body = await response.json();
    stampsBeforeResponse = await stamp.count();
    await route.fulfill({ response });
  });

  await budget('announce');
  await page.getByRole('button', { name: `TRY POSTING AS ${who!.toUpperCase()}` }).click();
  await expect(stamp).toBeVisible();
  expect(stampsBeforeResponse, 'no stamp before NEAR answered').toBe(0);
  expect(body.error?.source).toBe('near');
  expect(body.error?.type).toMatch(/AccessKeyNotFound$/);
  await expect(page.getByTestId('near-error')).toContainText('AccessKeyNotFound');

  const card = page.getByText('Same transaction as the takeover', { exact: true }).locator('..');
  await expect(card).toContainText(`+${cto(latest.payout)} CTO`);
  await expect(card).toContainText(`paid to ${latest.previous_ceo}`);
  await expect(card).toContainText(cto(previous.paid));
  await expect(card).toContainText(cto(latest.payout));
});

test('E2E-3 the CEO posts as the coin', async ({ page }) => {
  const s = await seat();
  test.skip(!demoWho(s.ceo), 'the CEO is not a demo account');
  const [prev] = await announcements(1);

  await page.goto('/press');
  await page.getByRole('radio', { name: /The face is mine until someone pays/ }).check();
  await budget('announce');
  await page.getByRole('button', { name: 'SIGN AS THE COIN' }).click();

  await expect.poll(async () => (await announcements(1))[0]?.index, { timeout: 30_000 }).toBe((prev?.index ?? -1) + 1);
  const [a] = await announcements(1);
  expect(a.ceo).toBe(s.ceo);
  expect(a.text).toMatch(/^The face is mine until someone pays \d{1,3}(,\d{3})* CTO\.$/);
  const release = page.locator('article', { hasText: a.text }).first();
  await expect(release).toBeVisible();
  await expect(release).toContainText(`SIGNED BY ${S.demo}`);
});

test('E2E-4 price moved: the second click loses and pays nothing', async ({ browser }) => {
  const before = await seat();
  const { account } = taker(before);
  await affordable(account, before.current_price);
  const [ctxA, ctxB] = [await browser.newContext(), await browser.newContext()];
  const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];

  // Both people open the desk at the same price.
  await b.clock.install();
  for (const p of [a, b]) {
    await p.goto('/takeover');
    await prepareDesk(p, account);
  }
  // B's tab stops refreshing, so B still sees the old price when clicking.
  await b.clock.pauseAt(Date.now() + 1_000);

  await budget('take-seat');
  await a.getByRole('button', { name: 'TAKE THE SEAT' }).click();
  await expect(a.getByRole('dialog', { name: 'Takeover complete' })).toBeVisible({ timeout: 30_000 });
  const after = await seat();
  expect(after.ceo).toBe(account);

  // The relayer allows one takeover per 10 s, so B's click lands just after.
  await budget('take-seat');
  const held = await balance(account);
  await b.getByRole('button', { name: 'TAKE THE SEAT' }).click();
  await b.clock.resume();
  const alert = b.getByRole('alert');
  await expect(alert).toContainText('Price moved');
  // B's max is the price B saw (the seat may have been decaying), so only the new price is exact.
  await expect(alert).toContainText(new RegExp(`CTO: price moved to ${escape(cto(after.current_price))} CTO, above your max [0-9,]+`));
  await expect(b.getByRole('button', { name: 'Try again at the new price' })).toBeVisible();
  expect(await balance(account), 'balance unchanged').toBe(held);
  expect((await seat()).ceo).toBe(account);
  await ctxA.close();
  await ctxB.close();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('E2E-6 takeover with reduced motion', async ({ page }) => {
    const none = async () => expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await takeover(page, async (dialog) => {
      await expect(dialog.getByRole('link', { name: 'GO TO THE PRESS OFFICE →' })).toBeVisible();
      await none();
    });
    await none();
  });
});
