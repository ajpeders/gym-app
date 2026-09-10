/**
 * Bringing a training history in from another app, and taking it out again.
 *
 * The moat argument is that it should be trivial to move *in*; the honesty
 * argument is that it must be equally trivial to move out, and that the export
 * has to be something this app can read back.
 */
import { expect, test, type Page } from '@playwright/test';

import { API, authed, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

const STRONG_EXPORT = [
  'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Notes,RPE',
  '"2026-07-01 09:00:00","Push","Bench Press",1,60,8,"",',
  '"2026-07-01 09:00:00","Push","Bench Press",2,62.5,6,"",8',
  '"2026-07-03 09:00:00","Legs","Squat",1,100,5,"",',
].join('\n');

test('a Strong export becomes real sessions', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/history');
  await page.getByRole('button', { name: /Coming from Hevy or Strong/ }).click();
  await expect(shown(page, 'Import a logged history')).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('CSV export').fill(STRONG_EXPORT);
  await page.getByRole('button', { name: 'Import history' }).click();

  await expect(shown(page, /Imported 2 sessions and 3 sets/)).toBeVisible({ timeout: 30_000 });

  const { items } = await api.get('/sessions');
  expect(items).toHaveLength(2);
  // Dated when they happened, not when they were imported — a year of history
  // stamped "today" is worse than no history.
  expect(items.every((s: { started_at: string }) => s.started_at.startsWith('2026-07'))).toBeTruthy();
});

test('a file that is not an export is refused with an explanation', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/history');
  await page.getByRole('button', { name: /Coming from Hevy or Strong/ }).click();
  await page.getByLabel('CSV export').fill('name,email\nalex,a@b.c');
  await page.getByRole('button', { name: 'Import history' }).click();

  await expect(shown(page, /Hevy or Strong export/i)).toBeVisible({ timeout: 30_000 });
});

test('the export is a file this app can read back in', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  await api.post('/sessions/import-csv', { csv: STRONG_EXPORT });

  const exported = await request.get(`${API}/sessions/export.csv`, {
    headers: { authorization: `Bearer ${account.token}` },
  });
  expect(exported.ok()).toBeTruthy();
  const text = await exported.text();
  expect(text).toContain('Bench Press');

  // Round-trip: a second account imports the first one's export unchanged.
  const second = await signIn(page, request);
  const back = await authed(request, second.token).post('/sessions/import-csv', { csv: text });
  expect(back.sessions_created).toBe(2);
  expect(back.sets_imported).toBe(3);
});
