/**
 * Building and keeping a plan: splits, days, and the catch-up backlog.
 *
 * expo-router keeps every tab mounted, so text from an off-screen tab is still
 * in the DOM. Assertions here scope to what's actually visible — otherwise a
 * screen that never rendered would still "pass".
 */
import { expect, test, type Page } from '@playwright/test';

import { appReady, authed, findExercise, seedPlan, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

test('a split can be created, filled with a day, and made active', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const target = await findExercise(request, account.token, 'bench press');

  await page.goto('/');
  await appReady(page);
  await page.getByRole('tab', { name: /Splits/ }).click();
  await expect(shown(page, 'Organize your week')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /New day/ }).click();
  await expect(shown(page, /Add exercise/)).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('e.g. Push Day').locator('visible=true').first().fill('Chest Day');
  await page.getByRole('button', { name: /Add exercise/ }).first().click();

  // Pick a known exercise out of the browser sheet.
  await page.getByPlaceholder('Search exercises').locator('visible=true').first().fill(target.name);
  await page.waitForTimeout(1500);
  await shown(page, target.name).click();

  await page.getByRole('button', { name: /Save workout/ }).click();

  const workouts = await api.get('/workouts');
  expect(workouts.map((w: { name: string }) => w.name)).toContain('Chest Day');
  expect(workouts[0].exercises.length).toBeGreaterThan(0);
});

test('the active split is the one Home plans from', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  await seedPlan(request, account.token, { name: 'First', days: ['First Day'] });
  // A second split, created later and not active.
  const other = await api.post('/splits', { name: 'Second split' });
  await api.post('/workouts', {
    name: 'Second Day',
    split_id: Number(other.id),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    exercises: [],
  });

  await page.goto('/');
  await appReady(page);
  await expect(shown(page, 'First Day')).toBeVisible({ timeout: 20_000 });

  // Switching the active split changes what Home offers.
  await page.goto(`/split/${other.id}`);
  await page.getByRole('button', { name: /Make this my active split/ }).click();
  await expect(shown(page, /Active/)).toBeVisible({ timeout: 20_000 });

  await page.goto('/');
  await expect(shown(page, 'Second Day')).toBeVisible({ timeout: 20_000 });
  expect((await api.get('/splits')).filter((s: { is_active: boolean }) => s.is_active)).toHaveLength(
    1,
  );
});

test('deleting a split keeps its days as standalone workouts', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { split } = await seedPlan(request, account.token, { name: 'Doomed', days: ['Keep Me'] });

  page.on('dialog', (d) => void d.accept());
  await page.goto(`/split/${split.id}`);
  await page.getByRole('button', { name: /Delete split/ }).click();
  await expect(shown(page, 'Splits')).toBeVisible({ timeout: 20_000 });

  expect(await api.get('/splits')).toHaveLength(0);
  // The workout survives with no split — losing exercises to a deleted plan
  // would be the worst possible reading of "delete this split".
  const workouts = await api.get('/workouts');
  expect(workouts.map((w: { name: string }) => w.name)).toEqual(['Keep Me']);
  expect(workouts[0].split_id).toBeNull();
});

test('catch-up shows what was scheduled against what was logged', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { workout } = await seedPlan(request, account.token, { name: 'Daily', days: ['Daily'] });

  // A session two days ago, so the backlog has both a logged day and gaps.
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await api.post('/sessions/log', {
    name: 'Daily',
    source_workout_id: Number(workout.id),
    started_at: twoDaysAgo,
    exercises: [],
  });

  await page.goto('/catch-up');
  await expect(shown(page, /Daily/)).toBeVisible({ timeout: 30_000 });
  // A scheduled day with nothing logged is an outstanding one, offered as a
  // backlog item rather than quietly skipped.
  await expect(shown(page, 'Log it')).toBeVisible();

  const days = await api.get('/splits/catchup?days=7&tz_offset=0');
  expect(days).toHaveLength(7);
  expect(days.filter((d: { logged: boolean }) => d.logged)).toHaveLength(1);
  expect(days.every((d: { scheduled: unknown[] }) => d.scheduled.length === 1)).toBeTruthy();
});
