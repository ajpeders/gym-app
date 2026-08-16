/**
 * The operator's view, and the wall around it.
 *
 * This is the first screen that shows one account anything about another, so
 * the boundary gets as much attention as the features: an ordinary user must
 * not see the entry point, and must not get the data if they navigate straight
 * to it.
 */
import { expect, test, type Page } from '@playwright/test';

import { API, appReady, authed, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

test('an ordinary account is not offered the admin view', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/');
  await appReady(page);
  await page.getByLabel('Open settings').click();

  await expect(shown(page, 'AI Provider')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
});

test('an ordinary account is refused the admin data outright', async ({ page, request }) => {
  const account = await signIn(page, request);
  for (const path of ['/admin/overview', '/admin/users', '/admin/errors', '/admin/ai']) {
    const res = await request.get(`${API}${path}`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
    expect(res.status(), path).toBe(403);
  }

  // And the screen says why rather than showing four failed requests.
  await page.goto('/admin');
  await expect(shown(page, /person who runs this server/i)).toBeVisible({ timeout: 30_000 });
});

test('an admin sees the install, its accounts and its crashes', async ({ page, request }) => {
  const account = await signIn(page, request, { admin: true });
  const api = authed(request, account.token);

  // A crash from a signed-out client, which is the case most likely to be lost.
  await request.post(`${API}/errors`, {
    data: { message: 'E2E crash on the workout screen', platform: 'web', context: '/workout/1' },
  });

  await page.goto('/admin');
  await expect(shown(page, 'This install')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, 'Accounts')).toBeVisible();
  await expect(shown(page, account.email)).toBeVisible();
  await expect(shown(page, 'E2E crash on the workout screen')).toBeVisible();

  // The API agrees with the screen.
  const overview = await api.get('/admin/overview');
  expect(overview.users).toBeGreaterThan(0);
  expect(overview.exercises).toBeGreaterThan(0);
});

test('AI failures are visible instead of being a hunt', async ({ page, request }) => {
  const account = await signIn(page, request, { admin: true });

  // No provider is configured, so this fails — which is exactly the shape of
  // the failure the operator view exists to surface.
  await request.get(`${API}/ai/models`, {
    headers: { authorization: `Bearer ${account.token}` },
  });

  await page.goto('/admin');
  await expect(shown(page, 'AI health')).toBeVisible({ timeout: 30_000 });
  await expect(shown(page, /ai\/models/)).toBeVisible();
  await expect(shown(page, /HTTP 5\d\d/)).toBeVisible();
});

test('a forgotten password can be reset from the admin view', async ({ page, request }) => {
  const admin = await signIn(page, request, { admin: true });
  const api = authed(request, admin.token);

  // A second account to recover.
  const victim = {
    email: `locked-out-${Date.now()}@example.com`,
    password: 'original-password',
  };
  await request.post(`${API}/auth/register`, {
    data: { ...victim, display_name: 'Locked Out' },
  });

  await page.goto('/admin');
  await expect(shown(page, victim.email)).toBeVisible({ timeout: 30_000 });

  const users = await api.get('/admin/users');
  const target = users.find((u: { email: string }) => u.email === victim.email);
  await api.post(`/admin/users/${target.id}/password`, { password: 'rescued-password' });

  const login = await request.post(`${API}/auth/login`, {
    data: { email: victim.email, password: 'rescued-password' },
  });
  expect(login.ok()).toBeTruthy();
});
