/**
 * The programs shelf: pick a known-good plan instead of building one.
 *
 * The library resolves its movements against whatever catalog is present, so
 * these assert on the *structure* of what gets adopted — days, order, targets,
 * and that it's a copy — rather than on which catalog row each lift became.
 */
import { expect, test, type Page } from '@playwright/test';

import { appReady, authed, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

test('a program can be browsed and adopted in one tap', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/');
  await appReady(page);
  await page.getByRole('tab', { name: /Splits/ }).click();
  await page.getByRole('button', { name: 'Browse programs' }).click();

  await expect(shown(page, 'Push / Pull / Legs')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, 'Upper / Lower')).toBeVisible();
  // Enough detail to choose between them without adopting first.
  await expect(shown(page, /3x \/ week/)).toBeVisible();
  await expect(shown(page, /rotation/)).toBeVisible();

  await page.getByRole('button', { name: 'Use Push / Pull / Legs' }).click();

  // Wait for the navigation, not for text: "rotation" also appears on the list
  // behind it, and Playwright's text match is case-insensitive — asserting on
  // it passed before the adopt had even finished.
  await page.waitForURL(/\/split\//, { timeout: 30_000 });
  await expect(shown(page, '1. Push')).toBeVisible({ timeout: 20_000 });

  const splits = await api.get('/splits');
  expect(splits).toHaveLength(1);
  expect(splits[0].mode).toBe('rolling');
  expect(splits[0].workouts.map((w: { name: string }) => w.name)).toEqual([
    'Push',
    'Pull',
    'Legs',
  ]);
  // Adopted with its targets, not as empty days to fill in.
  expect(splits[0].workouts[0].exercises.length).toBeGreaterThan(0);
  expect(splits[0].workouts[0].exercises[0].target_sets).toBeGreaterThan(0);
});

test('the first program adopted becomes the plan Home trains from', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/presets');
  await page.getByRole('button', { name: 'Use Full Body 3x' }).click();
  await page.waitForURL(/\/split\//, { timeout: 30_000 });
  await expect(shown(page, 'Weekly schedule')).toBeVisible({ timeout: 20_000 });

  const splits = await api.get('/splits');
  expect(splits[0].is_active).toBe(true);

  await page.goto('/');
  await appReady(page);
  // Whatever today is, one of the program's days is now what Home offers.
  await expect(shown(page, /Full Body/)).toBeVisible({ timeout: 20_000 });
});

test('adopting a second program leaves the first one alone', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/presets');
  await page.getByRole('button', { name: 'Use Push / Pull / Legs' }).click();
  await page.waitForURL(/\/split\//, { timeout: 30_000 });

  await page.goto('/presets');
  await page.getByRole('button', { name: 'Use Upper / Lower' }).click();
  await page.waitForURL(/\/split\//, { timeout: 30_000 });
  await expect(shown(page, 'Weekly schedule')).toBeVisible({ timeout: 20_000 });

  const splits = await api.get('/splits');
  expect(splits).toHaveLength(2);
  // Browsing the shelf must not switch what you're training.
  const active = splits.filter((s: { is_active: boolean }) => s.is_active);
  expect(active).toHaveLength(1);
  expect(active[0].name).toBe('Push / Pull / Legs');
});

test('an adopted program is a copy, editable without touching the library', async ({
  page,
  request,
}) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/presets');
  await page.getByRole('button', { name: 'Use StrongLifts 5x5' }).click();
  await page.waitForURL(/\/split\//, { timeout: 30_000 });

  const [split] = await api.get('/splits');
  await api.patch(`/splits/${split.id}`, { name: 'My 5x5' });

  const library = await api.get('/splits/presets');
  const stronglifts = library.find((p: { slug: string }) => p.slug === 'stronglifts-5x5');
  expect(stronglifts.name).toBe('StrongLifts 5x5');
});

test('the importer sends people without a program to the presets shelf', async ({
  page,
  request,
}) => {
  // The importer used to offer to have the AI write a split here. It doesn't:
  // "Don't have one?" is a route to the seven known-good programs, and that
  // path must not depend on an AI provider being configured at all.
  await signIn(page, request);
  await page.goto('/workout-import');
  await expect(shown(page, /Don't have one\?/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Browse programs' }).click();
  await page.waitForURL(/\/presets/, { timeout: 30_000 });
  await expect(shown(page, 'Push / Pull / Legs')).toBeVisible({ timeout: 20_000 });
});
