// E2E-8: axe-core on the four routes, desktop and phone. No serious or critical issues.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ROUTES = ['/', '/takeover', '/press', '/receipts'];

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 375, height: 812 }]] as const) {
  test.describe(label, () => {
    test.use({ viewport });
    for (const route of ROUTES) {
      test(`E2E-8 axe ${label} ${route}`, async ({ page }) => {
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForLoadState('networkidle').catch(() => undefined);
        // Let entrance animations finish: axe would measure a half-faded card.
        await page.waitForFunction(() => document.getAnimations().every((a) => a.effect?.getTiming().iterations === Infinity || a.playState === 'finished'), null, { timeout: 15_000 });
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
      });
    }
  });
}
