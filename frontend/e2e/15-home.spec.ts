import { expect, test } from '@playwright/test';
import { appReady, seedPlan, signIn } from './helpers';

test('home keeps an empty account focused and tools reachable', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, request);
  await page.goto('/');
  await appReady(page);
  await expect(page.getByRole('button', { name: 'Choose workout' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empty session' })).toBeVisible();
  await expect(page.getByText('Import your first split')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home-empty.png'), fullPage: true });
  await page.getByRole('tab', { name: /More/ }).click();
  await expect(page.getByText('Catch up', { exact: true })).toBeVisible();
  await expect(page.getByText('Nutrition', { exact: true })).toBeVisible();
});

test('home offers one clear workout and resumes it', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const account = await signIn(page, request);
  await seedPlan(request, account.token, { name: 'Upper body strength' });
  await page.goto('/');
  await appReady(page);
  await expect(page.getByRole('button', { name: 'Start now' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home-planned.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByLabel('Log set')).toBeVisible();
  await page.goto('/');
  await appReady(page);
  await expect(page.getByRole('button', { name: 'Continue session' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start now' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Empty session' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('home-ongoing.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue session' }).click();
  await expect(page.getByLabel('Log set')).toBeVisible();
});

test('a failed refresh preserves the plan and can be retried', async ({ page, request }) => {
  const account = await signIn(page, request);
  await seedPlan(request, account.token, { name: 'My saved day' });
  await page.goto('/');
  await appReady(page);
  await expect(page.getByRole('button', { name: 'Start now' })).toBeVisible();
  await page.getByRole('tab', { name: /More/ }).click();
  await page.route('**/api/splits/today', route => route.abort());
  await page.getByRole('tab', { name: /Home/ }).click();
  await expect(page.getByText(/Couldn’t refresh your plan/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start now' })).toBeVisible();
  await expect(page.getByText('Import your first split')).toHaveCount(0);
  await page.unroute('**/api/splits/today');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(/Couldn’t refresh your plan/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start now' })).toBeEnabled();
});
