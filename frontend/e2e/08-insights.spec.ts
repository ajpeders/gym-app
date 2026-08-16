/**
 * Insights: where the volume went, and what to add next time.
 *
 * The maths has unit tests; what these check is that the screen is reading the
 * athlete's own logged sets — the failure that matters is a plausible-looking
 * number that belongs to nobody.
 */
import { expect, test, type Page } from '@playwright/test';

import { appReady, authed, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

async function customExercise(
  api: ReturnType<typeof authed>,
  name: string,
  primary: string[],
  secondary: string[] = [],
) {
  return api.post('/exercises', {
    name,
    category: 'strength',
    equipment: 'barbell',
    primary_muscles: primary,
    secondary_muscles: secondary,
    instructions: [],
  });
}

test('volume by muscle counts the sets that were actually logged', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const bench = await customExercise(api, 'E2E Bench', ['chest'], ['triceps']);

  await api.post('/sessions/log', {
    name: 'Push',
    started_at: new Date(Date.now() - 86_400_000).toISOString(),
    exercises: [
      {
        exercise_id: bench.id,
        sets: [
          { reps: 8, weight: 60, set_type: 'working' },
          { reps: 8, weight: 60, set_type: 'working' },
          { reps: 8, weight: 60, set_type: 'working' },
        ],
      },
    ],
  });

  await page.goto('/insights');
  await expect(shown(page, 'Volume by muscle')).toBeVisible({ timeout: 30_000 });
  // The default window is four weeks, which averages three sets down to 0.75 —
  // correct, and exactly why the window is switchable.
  await expect(shown(page, '0.75 sets/wk')).toBeVisible();
  await page.getByRole('radio', { name: 'This week' }).click();
  await expect(shown(page, '3 sets/wk')).toBeVisible();
  // Secondary muscles get half credit — bench trains triceps, but not like an
  // extension does.
  await expect(shown(page, '1.5 sets/wk')).toBeVisible();
  // And the muscles that saw nothing are named rather than quietly omitted.
  await expect(shown(page, 'Gaps')).toBeVisible();
  await expect(shown(page, /Quadriceps/)).toBeVisible();
});

test('an account with no training gets the screen, not an error', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/insights');
  await expect(shown(page, 'Volume by muscle')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, /0 hard sets/)).toBeVisible();
});

test('next-time targets follow the plan and the last session', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const press = await customExercise(api, 'E2E Overhead', ['shoulders']);

  const split = await api.post('/splits', { name: 'Progress split' });
  await api.patch(`/splits/${split.id}`, { is_active: true });
  await api.post('/workouts', {
    name: 'Press Day',
    split_id: Number(split.id),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    exercises: [
      { exercise_id: press.id, order: 0, target_sets: 3, target_reps: 6, target_reps_max: 8 },
    ],
  });

  // Every working set at the top of the range: the jump is earned.
  await api.post('/sessions/log', {
    name: 'Press Day',
    started_at: new Date(Date.now() - 86_400_000).toISOString(),
    exercises: [
      {
        exercise_id: press.id,
        sets: [
          { reps: 8, weight: 50, set_type: 'working' },
          { reps: 8, weight: 50, set_type: 'working' },
          { reps: 8, weight: 50, set_type: 'working' },
        ],
      },
    ],
  });

  await page.goto('/insights');
  await expect(shown(page, 'Next time: Press Day')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, /Add weight.*52\.5kg/)).toBeVisible();
  await expect(shown(page, /Cleared 8 on every set/)).toBeVisible();
});

test('falling short of the range asks for the same weight again', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const row = await customExercise(api, 'E2E Row', ['back']);

  const split = await api.post('/splits', { name: 'Pull split' });
  await api.patch(`/splits/${split.id}`, { is_active: true });
  await api.post('/workouts', {
    name: 'Pull Day',
    split_id: Number(split.id),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    exercises: [
      { exercise_id: row.id, order: 0, target_sets: 3, target_reps: 6, target_reps_max: 8 },
    ],
  });
  await api.post('/sessions/log', {
    name: 'Pull Day',
    started_at: new Date(Date.now() - 86_400_000).toISOString(),
    exercises: [
      {
        exercise_id: row.id,
        sets: [
          { reps: 8, weight: 70, set_type: 'working' },
          { reps: 6, weight: 70, set_type: 'working' },
          { reps: 8, weight: 70, set_type: 'working' },
        ],
      },
    ],
  });

  await page.goto('/insights');
  await expect(shown(page, 'Next time: Pull Day')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, /Same again/)).toBeVisible();
});

test('insights are reachable from history', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/');
  await appReady(page);
  await page.getByRole('tab', { name: /History/ }).click();
  await page.getByRole('button', { name: 'Insights' }).click();
  await expect(shown(page, 'Volume by muscle')).toBeVisible({ timeout: 30_000 });
});

test('milestones describe the log rather than awarding anything', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const lift = await customExercise(api, 'E2E Milestone Lift', ['chest']);

  await api.post('/sessions/log', {
    name: 'One',
    started_at: new Date(Date.now() - 86_400_000).toISOString(),
    exercises: [{ exercise_id: lift.id, sets: [{ reps: 5, weight: 100, set_type: 'working' }] }],
  });

  await page.goto('/insights');
  await expect(shown(page, 'Milestones')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, /✓ First session/)).toBeVisible();
  // Unearned ones show progress instead of hiding — "1 of 10", not a padlock.
  await expect(shown(page, /1 of 10/)).toBeVisible();
});

test('recovery is read from when each muscle was last trained', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const fly = await customExercise(api, 'E2E Fly', ['chest']);

  await api.post('/sessions/log', {
    name: 'Chest',
    started_at: new Date().toISOString(),
    exercises: [{ exercise_id: fly.id, sets: [{ reps: 10, weight: 20, set_type: 'working' }] }],
  });

  await page.goto('/insights');
  await expect(shown(page, 'Recovery')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, /Chest/)).toBeVisible();
  await expect(shown(page, /Trained recently/)).toBeVisible();
  // And muscles that haven't been touched are named, not just the tired ones.
  await expect(shown(page, /Not trained lately/)).toBeVisible();
});
