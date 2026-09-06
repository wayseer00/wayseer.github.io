// Usage: run with `playwright test tests/sitrep-format.spec.mjs` after generating `_site`.
// Evidence boundary: verifies responsive hierarchy and disclosure behavior, not live repository freshness.
import { test, expect } from '@playwright/test';

test('SITREP supports scan, dependency-map navigation, summary, and full-evidence reading depths', async ({ page }) => {
  await page.goto('/sitrep/');

  await expect(page.getByRole('navigation', { name: 'Repository situation index' }).locator('a')).toHaveCount(11);
  await expect(page.locator('.sitrep-card')).toHaveCount(11);
  await expect(page.locator('.sitrep-reading-key > div')).toHaveCount(3);

  const desktopColumns = await page.locator('.sitrep-dual').first().evaluate(element => getComputedStyle(element).gridTemplateColumns);
  expect(desktopColumns.trim().split(/\s+/)).toHaveLength(2);

  const map = page.locator('[data-sitrep-map]');
  await expect(map.locator('svg')).toBeVisible();
  await expect(map.locator('.sitrep-map-node')).not.toHaveCount(0);
  await expect(map).toHaveAttribute('data-scale', '1.00');
  await page.getByRole('button', { name: 'Zoom in repository dependency map' }).click();
  await expect(map).toHaveAttribute('data-scale', '1.22');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(map).toHaveAttribute('data-scale', '1.00');

  const firstCard = page.locator('.sitrep-card').first();
  const frontierButton = firstCard.locator('[data-sitrep-section="frontier"]');
  await frontierButton.click();
  await expect(frontierButton).toHaveAttribute('aria-expanded', 'true');
  await expect(firstCard.locator('.sitrep-details')).toHaveAttribute('open', '');
  await expect(firstCard.locator('[data-sitrep-detail="frontier"]')).toBeVisible();

  await firstCard.getByText('Open full report').click();
  await expect(firstCard.locator('.sitrep-details')).not.toHaveAttribute('open', '');
  await expect(frontierButton).toHaveAttribute('aria-expanded', 'false');

  await page.locator('.sitrep-control-plane > summary').click();
  await expect(page.locator('.sitrep-contract-grid')).toBeVisible();
});

test('SITREP remains contained and sequential on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sitrep/');

  const mobileColumns = await page.locator('.sitrep-dual').first().evaluate(element => getComputedStyle(element).gridTemplateColumns);
  expect(mobileColumns.trim().split(/\s+/)).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  const index = page.getByRole('navigation', { name: 'Repository situation index' });
  await expect(index.locator('a')).toHaveCount(11);
  await expect(page.locator('.sitrep-reading-key > div')).toHaveCount(3);
  await expect(page.locator('[data-sitrep-map] svg')).toBeVisible();
  await expect(page.locator('.sitrep-metric').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
