/**
 * The reference surfaces: the exercise catalog, and what training you've done.
 */
import { expect, test, type Page } from '@playwright/test';

import { appReady, authed, findExercise, seedPlan, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

/** The library's search box — the placeholder carries the catalog size, and the
 * picker sheet has one of its own, so match on the shape rather than the text. */
const searchCatalog = (page: Page, term: string) =>
  page.getByPlaceholder(/Search \d* ?exercises|e\.g\. Half-kneeling/i)
    .locator('visible=true')
    .first()
    .fill(term);

test('the catalog can be searched and an exercise inspected', async ({ page, request }) => {
  const account = await signIn(page, request);
  // Whatever the catalog holds here — the full wger set locally, a single
  // created row in CI — searching for it must find it.
  const target = await findExercise(request, account.token, 'deadlift');

  await page.goto('/exercises');
  await expect(page.getByPlaceholder(/Search/)).toBeVisible({ timeout: 30_000 });

  await searchCatalog(page, target.name);
  await expect(shown(page, target.name)).toBeVisible({ timeout: 20_000 });

  await shown(page, target.name).click();
  // The detail screen is what tells you how to do the movement.
  await expect(shown(page, /instructions|how to|muscles/i)).toBeVisible({ timeout: 20_000 });
});

test('a custom exercise is created and is usable in a workout', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  const created = await api.post('/exercises', {
    name: 'Sandbag Carry E2E',
    category: 'strength',
    equipment: 'other',
    primary_muscles: ['quadriceps'],
    instructions: ['Pick it up.', 'Walk.'],
  });
  expect(created.is_custom).toBe(true);

  await page.goto('/exercises');
  await searchCatalog(page, 'Sandbag');
  await expect(shown(page, 'Sandbag Carry E2E')).toBeVisible({ timeout: 20_000 });

  // And it behaves like any other exercise once it's in a plan.
  const workout = await api.post('/workouts', {
    name: 'Carry Day',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    exercises: [{ exercise_id: created.id, target_sets: 2, target_reps: 1, order: 0 }],
  });
  await page.goto(`/workout/${workout.id}`);
  await expect(shown(page, 'Sandbag Carry E2E')).toBeVisible({ timeout: 20_000 });
});

test('history shows a finished session and its sets', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { workout, exercise } = await seedPlan(request, account.token, { name: 'Recorded' });

  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  await api.post('/sessions/log', {
    name: 'Recorded',
    source_workout_id: Number(workout.id),
    started_at: yesterday,
    exercises: [
      {
        exercise_id: exercise.id,
        sets: [
          { reps: 5, weight: 100, set_type: 'working' },
          { reps: 5, weight: 100, set_type: 'working' },
        ],
      },
    ],
  });

  await page.goto('/');
  await appReady(page);
  await page.getByRole('tab', { name: /History/ }).click();
  await expect(shown(page, /completed session/i)).toBeVisible({ timeout: 20_000 });
  // The history rows carry the session's age; that's what distinguishes them
  // from the same name appearing in the "start from a split" shortcuts above.
  await shown(page, /1d ago/).click();

  await expect(shown(page, exercise.name)).toBeVisible({ timeout: 20_000 });
  await expect(shown(page, /100/)).toBeVisible();
});

test('stats count what was actually logged', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { workout, exercise } = await seedPlan(request, account.token, { name: 'Counted' });

  await api.post('/sessions/log', {
    name: 'Counted',
    source_workout_id: Number(workout.id),
    started_at: new Date(Date.now() - 3_600_000).toISOString(),
    exercises: [
      { exercise_id: exercise.id, sets: [{ reps: 10, weight: 50, set_type: 'working' }] },
    ],
  });

  const summary = await api.get('/stats/summary');
  expect(summary.total_workouts).toBe(1);

  await page.goto('/');
  await appReady(page);
  await page.getByRole('tab', { name: /History/ }).click();
  // 1 session, 500kg of volume — the numbers on screen come from the same place.
  await expect(shown(page, /500/)).toBeVisible({ timeout: 20_000 });
});
