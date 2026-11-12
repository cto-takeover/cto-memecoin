// Front page numbers against the chain: the takeover count and the date of the
// first takeover, which sits past the 8 entries the page polls once there are more.
import { expect, test } from '@playwright/test';
import { firstTakeover, history } from './chain';

test('front page: takeovers since launch and the first one\'s date', async ({ page }) => {
  const [latest] = await history(1);
  test.skip(!latest, 'no takeover yet');
  const first = await firstTakeover();
  expect(first?.index).toBe(0);
  const date = new Date(Number(BigInt(first!.at_ns) / 1_000_000n)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  await page.goto('/');
  const card = page.locator('.card').filter({ has: page.getByText('Takeovers', { exact: true }) });
  await expect(card).toContainText(/since launch · first /, { timeout: 15_000 });
  await expect(card).toContainText(`since launch · first ${date}`);
  const count = Number((await card.locator('p.mono').first().textContent())!.replace(/,/g, ''));
  expect(count).toBeGreaterThanOrEqual(latest.index + 1); // the seat may change hands while the page loads
});
