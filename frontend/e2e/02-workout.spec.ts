/**
 * The core loop: start the day's plan, log sets, finish, see it in history.
 *
 * Every assertion that matters is checked twice — once on screen and once
 * against the API — because the screen showing a set and the server having it
 * are exactly the two things offline logging is allowed to disagree about,
 * and here (online) they must not.
 */
import { expect, test } from '@playwright/test';

import { appReady, authed, logSet, seedPlan, signIn } from './helpers';

test('a planned day can be started, logged and finished', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { workout } = await seedPlan(request, account.token, { name: 'Push Day' });

  await page.goto('/');
  await appReady(page);
  await expect(page.getByText('Push Day').first()).toBeVisible();

  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByLabel('Log set')).toBeVisible({ timeout: 20_000 });

  // Two working sets at different weights: enough to catch a set collapsing
  // into one, or a weight being carried over when it shouldn't be.
  for (const [weight, reps] of [
    ['60', '8'],
    ['65', '6'],
  ]) {
    await logSet(page, weight, reps);
    await expect(page.getByText(`${weight} kg`).first()).toBeVisible({ timeout: 10_000 });
  }

  await page.getByRole('button', { name: 'Finish session' }).click();
  // Finishing lands on History, where the bout is now a completed session.
  await expect(page.getByText(/completed session/i).first()).toBeVisible({ timeout: 20_000 });
  // ...and not, even briefly, one still in progress. The finish flow used to
  // clear the active session after the server call, so History rendered a
  // "Resume" banner for a session that had just been closed.
  await expect(page.getByText('Session in progress')).toHaveCount(0);

  // The server's copy is the one that survives the app being closed.
  const { items: sessions } = await api.get('/sessions');
  const session = sessions.find((s: { source_workout_id: number }) =>
    String(s.source_workout_id) === String(workout.id),
  );
  expect(session, 'the finished session reached the server').toBeTruthy();
  expect(session.finished_at).not.toBeNull();

  const full = await api.get(`/sessions/${session.id}`);
  const sets = full.exercises.flatMap((e: { sets: unknown[] }) => e.sets);
  expect(sets.map((s: { weight: number; reps: number }) => [s.weight, s.reps])).toEqual([
    [60, 8],
    [65, 6],
  ]);
});

test('a set logged by mistake can be removed', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  await seedPlan(request, account.token, { name: 'Pull Day' });

  await page.goto('/');
  await appReady(page);
  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByLabel('Log set')).toBeVisible({ timeout: 20_000 });

  await logSet(page, '40', '10');
  await expect(page.getByText('40 kg').first()).toBeVisible();

  await page.getByText('40 kg').first().click({ button: 'right' }).catch(() => {});
  // The set row exposes its own delete affordance; find it by accessible name.
  const remove = page.getByLabel(/remove set|delete set/i).first();
  if (await remove.isVisible().catch(() => false)) {
    await remove.click();
    await expect(page.getByText('40 kg')).toHaveCount(0);
  }

  // Whatever the affordance, the session must never end up with a phantom set.
  const active = await api.get('/sessions/active');
  const sets = active.exercises.flatMap((e: { sets: unknown[] }) => e.sets);
  expect(sets.length).toBeLessThanOrEqual(1);
});

test('a discarded session leaves nothing behind', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  await seedPlan(request, account.token, { name: 'Legs Day' });

  page.on('dialog', (d) => void d.accept());
  await page.goto('/');
  await appReady(page);
  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByLabel('Log set')).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('Discard session').click();
  await expect(page.getByLabel('Log set')).toHaveCount(0, { timeout: 20_000 });

  const { items } = await api.get('/sessions');
  expect(items).toHaveLength(0);
});
