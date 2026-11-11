// E2E-7: Receipts on both coins. Numbers equal get_config, full-access keys 0,
// the 60-day chart loads /sim/busy.csv.
import { expect, test } from '@playwright/test';
import { config, cto, fullAccessKeys, S } from './chain';

for (const coin of ['demo', 'main'] as const) {
  test(`E2E-7 receipts: ${coin} coin`, async ({ page }) => {
    const id = coin === 'demo' ? S.demo : S.main;
    const [c, full] = await Promise.all([config(id), fullAccessKeys(id)]);
    expect(full).toBe(0);

    const csv = page.waitForResponse((r) => r.url().endsWith('/sim/busy.csv') && r.status() === 200);
    await page.goto(coin === 'main' ? '/receipts?coin=main' : '/receipts');
    await csv;

    const row = (name: string) => page.locator('.rrow').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).first().locator('b');
    await expect(row('full-access keys')).toHaveText('0');
    await expect(row('takeover price')).toContainText(`(${c.takeover_ratio})`);
    await expect(row('old CEO payout')).toContainText(`(${c.payout_ratio} of the price)`);
    await expect(row('opening price / floor')).toHaveText(`${cto(c.opening_price as string)} CTO`);
    await expect(row('voice key')).toContainText(`may only call ${c.voice_key_method}`);
    await expect(page.getByText(id).first()).toBeVisible();
    await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  });
}
