/**
 * The two "stop doing maths in your head" surfaces: the food shelf and the
 * gym-floor calculators.
 *
 * Both compute server-side, so these check the round trip — the number on the
 * screen is the number the API worked out, not a second implementation that
 * will eventually disagree with it.
 */
import { expect, test, type Page } from '@playwright/test';

import { appReady, authed, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

test('a food can be picked and logged with its macros filled in', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/nutrition');
  await expect(shown(page, 'Common foods')).toBeVisible({ timeout: 30_000 });

  await page.getByPlaceholder(/Search foods/).fill('chicken');
  await shown(page, 'Chicken breast').click();
  // The shelf shows what it's about to log, before it logs it.
  await expect(shown(page, /165 cal · 31g protein per 100g/)).toBeVisible();

  await page.getByLabel('Amount').fill('200');
  await page.getByRole('button', { name: 'Log it' }).click();

  // 200g of chicken breast: double the per-100g figures, worked out by the API.
  await expect(shown(page, /330/)).toBeVisible({ timeout: 20_000 });

  const entries = await api.get('/nutrition');
  expect(entries).toHaveLength(1);
  expect(entries[0].calories).toBe(330);
  expect(entries[0].protein).toBe(62);
  expect(entries[0].label).toContain('Chicken breast');
});

test('typing a meal by hand still works and is not overwritten', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await api.post('/nutrition', { label: 'Mum roast', calories: 900, protein: 55 });
  await page.goto('/nutrition');
  await expect(shown(page, 'Mum roast')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, /900/)).toBeVisible();
});

test('the plate calculator says what goes on each side', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/calculators');
  await expect(shown(page, 'Plates')).toBeVisible({ timeout: 30_000 });

  await page.getByLabel(/Target/).fill('100');
  await page.getByRole('button', { name: 'Work it out' }).click();
  await expect(shown(page, /per side/)).toBeVisible({ timeout: 20_000 });
  await expect(shown(page, /20kg bar · 100kg total/)).toBeVisible();
});

test('an unloadable target says how close it can get', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/calculators');
  await page.getByLabel(/Target/).fill('101');
  await page.getByRole('button', { name: 'Work it out' }).click();
  // Better than refusing: "100, and you're 1kg short" is something you can act on.
  await expect(shown(page, /1kg short of 101kg/)).toBeVisible({ timeout: 20_000 });
});

test('the warmup ramp starts at the bar', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/calculators');
  await page.getByLabel(/Working weight/).fill('100');
  await page.getByRole('button', { name: 'Build ramp' }).click();
  await expect(shown(page, '20kg x 10')).toBeVisible({ timeout: 20_000 });
  await expect(shown(page, '90kg x 1')).toBeVisible();
});

test('the estimated max comes with the percentages people train off', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/calculators');
  await page.getByLabel(/Weight/).fill('100');
  await page.getByLabel('Reps').fill('5');
  await page.getByRole('button', { name: 'Estimate' }).click();

  await expect(shown(page, /116\.67/)).toBeVisible({ timeout: 20_000 });
  await expect(shown(page, /80%/)).toBeVisible();
});

test('the calculators are reachable from history', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/');
  await appReady(page);
  await page.getByRole('tab', { name: /History/ }).click();
  await page.getByRole('button', { name: 'Calculators' }).click();
  await expect(shown(page, 'Estimated max')).toBeVisible({ timeout: 30_000 });
});
