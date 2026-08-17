/**
 * Supersets end to end: paired in the plan, shown while training.
 *
 * The labelling rules have unit tests (`src/lib/supersets.test.ts`). What this
 * checks is that a pairing made in the editor survives the save, the session
 * start, and lands on the screen you actually look at between sets.
 */
import { expect, test, type Page } from '@playwright/test';

import { appReady, authed, findExercise, rx, seedPlan, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

test('two exercises can be paired, and the pairing reaches the session', async ({
  page,
  request,
}) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const curl = await findExercise(request, account.token, 'curl');
  const pushdown = await findExercise(request, account.token, 'pushdown');

  const workout = await api.post('/workouts', {
    name: 'Arms',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    exercises: [
      { exercise_id: curl.id, order: 0, target_sets: 3, target_reps: 10 },
      { exercise_id: pushdown.id, order: 1, target_sets: 3, target_reps: 10 },
    ],
  });

  // Pair them in the editor.
  await page.goto(`/workout/${workout.id}`);
  await expect(shown(page, curl.name)).toBeVisible({ timeout: 30_000 });
  // The first exercise's row is expanded on open, so the pairing toggle for it
  // is already on screen — clicking the name would collapse it.
  await page.getByLabel(new RegExp(`Superset with ${rx(pushdown.name)}`, 'i')).click();
  await page.getByRole('button', { name: /Save workout/ }).click();
  // Saving returns to the splits tab; asserting before that races the request.
  await page.waitForURL(/workouts|\/$/, { timeout: 30_000 });

  const saved = await api.get(`/workouts/${workout.id}`);
  expect(saved.exercises.map((e: { superset_group: string | null }) => e.superset_group)).toEqual([
    'A',
    'A',
  ]);

  // Starting the session snapshots it, and the card says which group it's in.
  const session = await api.post('/sessions/start', { workout_id: String(workout.id) });
  expect(session.exercises.map((e: { superset_group: string | null }) => e.superset_group)).toEqual(
    ['A', 'A'],
  );

  await page.goto(`/session/active/${session.id}`);
  await expect(page.getByLabel('Log set').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('A', { exact: true }).locator('visible=true').first()).toBeVisible();
});

test('an ordinary workout shows no superset badges at all', async ({ page, request }) => {
  const account = await signIn(page, request);
  const { workout } = await seedPlan(request, account.token, { name: 'Plain Day' });
  const api = authed(request, account.token);

  const session = await api.post('/sessions/start', { workout_id: String(workout.id) });
  await page.goto(`/session/active/${session.id}`);
  await expect(page.getByLabel('Log set').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('A', { exact: true })).toHaveCount(0);
});
