/**
 * Training with no signal.
 *
 * The gym is where phones lose reception, so every one of these runs with the
 * browser context offline: the session is started, logged and finished with no
 * server at all, and only then is the network handed back. What the server
 * ends up with has to match what the athlete saw on the screen — same sets,
 * same order, same weights, one session and not two.
 */
import { expect, test } from '@playwright/test';

import { appReady, authed, logSet, seedPlan, signIn } from './helpers';

/** Give the queue a moment to drain once connectivity returns. */
async function synced(check: () => Promise<boolean>, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

test('a workout started offline arrives intact when signal returns', async ({
  page,
  context,
  request,
}) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const { workout, exercise } = await seedPlan(request, account.token, { name: 'Push Day' });

  // Look at the plan while still online — this is what fills the cache the
  // offline start builds its session from.
  await page.goto('/');
  await appReady(page);
  await expect(page.getByText('Push Day').first()).toBeVisible();

  await context.setOffline(true);

  await page.getByRole('button', { name: 'Start now' }).click();
  // The session opens with the plan's exercise and targets already on it,
  // rather than an empty shell to rebuild by hand.
  await expect(page.getByLabel('Log set')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(exercise.name).first()).toBeVisible();
  await expect(page.getByText(/Target: 3 x 8/).first()).toBeVisible();

  for (const [weight, reps] of [
    ['60', '8'],
    ['62.5', '7'],
  ]) {
    await logSet(page, weight, reps);
    await expect(page.getByText(`${weight} kg`).first()).toBeVisible({ timeout: 10_000 });
  }

  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByLabel('Log set')).toHaveCount(0, { timeout: 20_000 });

  // Nothing can have reached the server yet — that's the whole premise.
  expect((await api.get('/sessions')).items).toHaveLength(0);

  await context.setOffline(false);

  const landed = await synced(async () => (await api.get('/sessions')).items.length > 0);
  expect(landed, 'the queued session reached the server').toBeTruthy();

  const { items } = await api.get('/sessions');
  expect(items, 'one session, not one per queued write').toHaveLength(1);
  expect(String(items[0].source_workout_id)).toBe(String(workout.id));

  const allSets = await synced(async () => {
    const full = await api.get(`/sessions/${items[0].id}`);
    return full.exercises.flatMap((e: { sets: unknown[] }) => e.sets).length === 2;
  });
  expect(allSets, 'both sets survived the queue').toBeTruthy();

  const full = await api.get(`/sessions/${items[0].id}`);
  const sets: { weight: number; reps: number }[] = full.exercises.flatMap(
    (e: { sets: { weight: number; reps: number }[] }) => e.sets,
  );
  expect(sets.map((s) => [s.weight, s.reps])).toEqual([
    [60, 8],
    [62.5, 7],
  ]);
  // Finished offline means finished then, not when the queue drained.
  expect(full.finished_at).not.toBeNull();
});

test('an offline session survives the app being closed and reopened', async ({
  page,
  request,
}) => {
  // This one blocks the API rather than the whole context: a native app is
  // already installed when it restarts, whereas a web build would have to be
  // fetched, so a fully offline reload would test the wrong thing.
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  await seedPlan(request, account.token, { name: 'Pull Day' });

  await page.goto('/');
  await appReady(page);
  const cutTheApi = (route: { abort: () => Promise<void> }) => route.abort();
  await page.route('**/api/**', cutTheApi);

  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByLabel('Log set')).toBeVisible({ timeout: 20_000 });
  await logSet(page, '50', '12');
  await expect(page.getByText('50 kg').first()).toBeVisible();

  // Kill the app mid-session, still with no signal. The session has no server
  // id yet, so resuming it can only come from the device.
  await page.reload();
  await expect(page.getByText('50 kg').first()).toBeVisible({ timeout: 30_000 });

  await page.unroute('**/api/**', cutTheApi);
  // What the OS tells the app when the network comes back.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const landed = await synced(async () => {
    const { items } = await api.get('/sessions');
    if (!items.length) return false;
    const full = await api.get(`/sessions/${items[0].id}`);
    return full.exercises.flatMap((e: { sets: unknown[] }) => e.sets).length === 1;
  });
  expect(landed, 'the set logged before the restart still synced').toBeTruthy();
});

test('a set logged offline is not lost when the queue is flushed twice', async ({
  page,
  context,
  request,
}) => {
  // Regression guard for replay: the start carries an idempotency key, so a
  // second flush must not open a second session.
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  await seedPlan(request, account.token, { name: 'Legs Day' });

  await page.goto('/');
  await appReady(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByLabel('Log set')).toBeVisible({ timeout: 20_000 });
  await logSet(page, '80', '5');
  await expect(page.getByText('80 kg').first()).toBeVisible();

  await context.setOffline(false);
  expect(await synced(async () => (await api.get('/sessions')).items.length > 0)).toBeTruthy();

  // Flap the connection: another flush runs, replaying anything still queued.
  await context.setOffline(true);
  await context.setOffline(false);
  await page.waitForTimeout(3_000);

  const { items } = await api.get('/sessions');
  expect(items, 'the replayed start reused the first session').toHaveLength(1);
  const full = await api.get(`/sessions/${items[0].id}`);
  expect(full.exercises.flatMap((e: { sets: unknown[] }) => e.sets)).toHaveLength(1);
});
