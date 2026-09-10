/**
 * First run, personal data, and the AI surfaces with no provider configured.
 *
 * No model is ever called here: the point is the opposite — that every AI
 * feature says plainly that it isn't set up instead of hanging, and that the
 * rest of the app works fine without one. "Ollama returns 400" cost a real
 * afternoon because the app couldn't say what was wrong.
 */
import { expect, test, type Page } from '@playwright/test';

import { appReady, authed, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

test('a brand-new account is walked through onboarding and then left alone', async ({
  page,
  request,
}) => {
  const account = await signIn(page, request, { onboarded: false });
  const api = authed(request, account.token);

  await page.goto('/');
  await expect(shown(page, /welcome|get started|skip/i)).toBeVisible({ timeout: 30_000 });

  // Whatever the tour offers, there must be a way out of it.
  const escape = page
    .getByRole('button', { name: /skip|get started|continue|done|finish/i })
    .locator('visible=true')
    .first();
  for (let i = 0; i < 6; i++) {
    if (!(await escape.isVisible().catch(() => false))) break;
    await escape.click();
    await page.waitForTimeout(800);
    if (await page.getByRole('tab', { name: /Home/ }).isVisible().catch(() => false)) break;
  }
  await appReady(page);

  // And it must not come back on the next launch.
  const settings = await api.get('/settings');
  expect(settings.feature_flags.onboarded).toBe(true);
  await page.reload();
  await appReady(page);
});

test('profile details and nutrition targets persist', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await api.patch('/profile', {
    experience_level: 'intermediate',
    goals: 'get stronger',
    injuries: ['left shoulder'],
    calorie_target: 2600,
    protein_target: 180,
  });

  await page.goto('/profile');
  await expect(shown(page, /left shoulder/i)).toBeVisible({ timeout: 30_000 });

  await page.goto('/nutrition');
  await expect(shown(page, /2600|2,600/)).toBeVisible({ timeout: 20_000 });

  // Logging an entry moves the day's totals.
  await api.post('/nutrition', { name: 'Chicken and rice', calories: 700, protein: 60 });
  await page.reload();
  // The day's totals are what the screen is for: intake against the target.
  await expect(shown(page, /700 \/ 2600 cal/)).toBeVisible({ timeout: 20_000 });
  await expect(shown(page, /60 \/ 180 g/)).toBeVisible();
});

test('a weigh-in is recorded and the profile reflects it', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await api.post('/metrics', { weight: 82.5 });
  expect((await api.get('/metrics'))[0].weight).toBe(82.5);

  // Weigh-ins are the one source of weight. The profile reads the latest one
  // rather than keeping a second number you overwrite by hand.
  await page.goto('/profile');
  await expect(shown(page, /82\.5/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Log a weigh-in')).toBeVisible();
});

test('the AI screens say they are not set up rather than hanging', async ({ page, request }) => {
  await signIn(page, request);

  await page.goto('/');
  await appReady(page);
  await page.getByRole('tab', { name: /More/ }).click();
  await page.getByRole('button', { name: /Spotter/ }).click();

  // With no provider it must say so plainly and point at the fix, rather than
  // spinning or failing silently.
  await expect(shown(page, /Set up your AI to use the spotter/i)).toBeVisible({ timeout: 20_000 });
  await expect(shown(page, /Ollama server, Claude key, or OpenAI API key/i)).toBeVisible();
  // ...and the setup is right there, not a hop away in Settings.
  await expect(page.getByText('Ollama server URL', { exact: true })).toBeVisible();
});

test('the spotter offers the providers and never silently picks one', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/');
  await appReady(page);
  // Settings points at the Spotter, which is where the provider is set up.
  await page.getByLabel('Open settings').click();
  await page.getByText('AI provider', { exact: true }).click();
  await expect(shown(page, 'Ollama')).toBeVisible({ timeout: 20_000 });
  // Nothing is configured, and each provider says so ("Set up", not "Ready")
  // rather than the screen implying a working default.
  await expect(shown(page, /^Set up$/)).toBeVisible();
  await expect(page.getByText('Ready').locator('visible=true')).toHaveCount(0);

  // Units are the one setting that changes every number in the app.
  const before = (await api.get('/settings')).units;
  expect(['kg', 'lb']).toContain(before);

  await api.patch('/settings', { units: before === 'kg' ? 'lb' : 'kg' });
  expect((await api.get('/settings')).units).not.toBe(before);
});

test('the exercise Q&A is offered only when AI is configured', async ({ page, request }) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);
  const rows = await api.get('/exercises?limit=1');
  const exercise = (Array.isArray(rows) ? rows : rows.items)[0];

  await page.goto(`/exercise/${exercise.id}`);
  await expect(shown(page, exercise.name)).toBeVisible({ timeout: 30_000 });
  // No provider set up: the box isn't offered at all, rather than failing on tap.
  await expect(page.getByLabel('Question about this exercise')).toHaveCount(0);
});

test('notification preferences persist on the account, not the device', async ({
  page,
  request,
}) => {
  const account = await signIn(page, request);
  const api = authed(request, account.token);

  await page.goto('/');
  await appReady(page);
  await page.getByLabel('Open settings').click();
  await expect(shown(page, 'Rest timer alerts')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('switch', { name: 'Rest timer alerts' }).click();
  // Whatever the switch does visually, the preference has to reach the server —
  // a second phone should already know.
  await expect
    .poll(async () => (await api.get('/settings')).feature_flags.rest_alerts, {
      timeout: 20_000,
    })
    .toBe(true);
});
