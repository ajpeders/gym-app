/**
 * Rolling splits: a rotation with no calendar in it.
 *
 * The backend has its own tests for the maths; these check the half that can't
 * be unit-tested — that the screens actually read the mode, so someone whose
 * rest days move around is told what's next instead of what today's date says.
 */
import { expect, test } from '@playwright/test';

import { appReady, authed, seedPlan, signIn } from './helpers';

const PPL = ['Push', 'Pull', 'Legs'];

test('home offers the next day in the rotation, and advances when it is done', async ({
  page,
  request,
}) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  await seedPlan(request, account.token, { mode: 'rolling', days: PPL });

  await page.goto('/');
  await appReady(page);

  // Not "scheduled today" — a rolling day was never given a date.
  await expect(page.getByText('next in rotation').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Start next in rotation')).toBeVisible();
  await expect(page.getByText('Push').first()).toBeVisible();

  await page.getByText('Start next in rotation').click();
  await expect(page.getByLabel('Log set')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Added weight').fill('60');
  await page.getByLabel('Reps').fill('8');
  await page.getByLabel('Log set').click();
  await expect(page.getByText('60 kg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByText(/completed session/i).first()).toBeVisible({ timeout: 20_000 });

  // The cycle moved on: Pull is up next, from the log rather than the calendar.
  const today = await api.get('/splits/today');
  const upNext = today.find((w: { up_next: boolean }) => w.up_next);
  expect(upNext.name).toBe('Pull');
  expect(today.every((w: { missed: boolean }) => !w.missed), 'nothing is ever missed').toBeTruthy();

  await page.getByRole('tab', { name: /Home/ }).click();
  await expect(page.getByRole('button', { name: /Pull.*next in rotation/ })).toBeVisible({
    timeout: 20_000,
  });
  // And the finished day must not still be sitting there as "ongoing".
  await expect(page.getByText('ONGOING')).toHaveCount(0);
});

test('the split screen shows the rotation in order, with position and progress', async ({
  page,
  request,
}) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { split } = await seedPlan(request, account.token, { mode: 'rolling', days: PPL });

  await page.goto(`/split/${split.id}`);
  await expect(page.getByText('Rotation').first()).toBeVisible({ timeout: 30_000 });
  // Numbered by position, not laid out over a week.
  await expect(page.getByText('1. Push')).toBeVisible();
  await expect(page.getByText('2. Pull')).toBeVisible();
  await expect(page.getByText('3. Legs')).toBeVisible();
  await expect(page.getByText('Up next').first()).toBeVisible();
  await expect(page.getByText('Weekly schedule')).toHaveCount(0);

  // Reordering is the only way to schedule a rolling split, so it has to work
  // from here — a day's own screen can't say anything about its neighbours.
  await page.getByLabel('Move Legs earlier in the rotation').click();
  await expect(page.getByText('2. Legs')).toBeVisible({ timeout: 20_000 });

  const fresh = await api.get(`/splits/${split.id}`);
  const order = [...fresh.workouts]
    .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
    .map((w: { name: string }) => w.name);
  expect(order).toEqual(['Push', 'Legs', 'Pull']);
});

test('a weekday split can be switched to a rotation and back', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { split } = await seedPlan(request, account.token, { name: 'Upper', days: ['Upper'] });

  await page.goto(`/split/${split.id}`);
  await expect(page.getByText('Weekly schedule')).toBeVisible({ timeout: 30_000 });

  await page.getByText('Edit', { exact: true }).click();
  await page.getByText('Rotation', { exact: true }).click();
  await page.getByText('Save changes').click();

  await expect(page.getByText('Rotation').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Weekly schedule')).toHaveCount(0);
  expect((await api.get(`/splits/${split.id}`)).mode).toBe('rolling');

  // Going back must be as easy as going forward — the mode is a preference,
  // not a one-way migration.
  await page.getByText('Edit', { exact: true }).click();
  await page.getByText('By weekday', { exact: true }).click();
  await page.getByText('Save changes').click();

  await expect(page.getByText('Weekly schedule')).toBeVisible({ timeout: 20_000 });
  expect((await api.get(`/splits/${split.id}`)).mode).toBe('rigid');
});

test('a rolling day has no weekday picker to confuse anyone', async ({ page, request }) => {
  const account = await signIn(page, request);
  const { workouts } = await seedPlan(request, account.token, { mode: 'rolling', days: PPL });

  await page.goto(`/workout/${workouts[0].id}`);
  await expect(page.getByText('Schedule').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/runs as a rotation/i)).toBeVisible();
  await expect(page.getByText('Repeat on these days')).toHaveCount(0);
});
