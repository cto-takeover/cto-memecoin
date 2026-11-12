// E2E-5: phone 375×812. Sticky TAKE OVER bar, no sideways scroll, targets ≥ 44 px
// (buttons, nav pills, the coin switch and tx chips).
import { expect, test, type Page } from '@playwright/test';
import { smallTargets } from './chain';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

async function phoneChecks(page: Page, barAction: string) {
  const bar = page.getByRole('region', { name: 'Seat price' });
  await expect(bar).toBeVisible();
  await expect(bar.getByText(barAction)).toBeVisible();
  const box = await bar.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(812 + 1); // stuck to the bottom of the screen
  await page.mouse.wheel(0, 1500);
  await expect(bar).toBeInViewport();

  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(width.scroll, 'no sideways scroll').toBeLessThanOrEqual(width.view);

  const small = await smallTargets(page);
  expect(small, 'targets smaller than 44 px').toEqual([]);
}

test('E2E-5 phone: front page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await phoneChecks(page, 'TAKE OVER →');
});

test('E2E-5 phone: takeover desk', async ({ page }) => {
  await page.goto('/takeover');
  await expect(page.getByRole('button', { name: 'TAKE THE SEAT' }).first()).toBeAttached();
  await phoneChecks(page, 'TAKE THE SEAT');
});
