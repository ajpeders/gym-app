/**
 * Getting in and out of the app.
 *
 * These are the screens every other test skips past, so they're the ones most
 * likely to rot unnoticed — the logout button being wired to nothing was a real
 * bug found by a real user, not by anything automated.
 *
 * Note the `:visible` filters: expo-router keeps both auth screens mounted, so
 * a bare placeholder lookup matches the login form even while register is on
 * screen.
 */
import { expect, test, type Page } from '@playwright/test';

import { API, appReady, loginViaUi, newUser, registerOnly } from './helpers';

const visible = (page: Page, placeholder: string) =>
  page.getByPlaceholder(placeholder).locator('visible=true');

test('a new account can register and is walked through onboarding', async ({ page }) => {
  const user = newUser();
  await page.goto('/');

  await page.getByRole('button', { name: 'Register' }).click();
  await visible(page, 'Your name').fill(user.name);
  await visible(page, 'you@example.com').fill(user.email);
  await visible(page, 'At least 6 characters').fill(user.password);
  await visible(page, 'Re-enter your password').fill(user.password);
  await page.getByRole('button', { name: 'Sign up' }).click();

  // A fresh account gets the welcome tour before it reaches Home.
  await expect(page.getByText(/welcome|get started|skip/i).first()).toBeVisible({
    timeout: 30_000,
  });
});

test('an existing account logs in and sees Home', async ({ page, request }) => {
  await loginViaUi(page, await registerOnly(request));
  await appReady(page);
});

test('a wrong password is refused, and says so', async ({ page, request }) => {
  const user = newUser();
  await request.post(`${API}/auth/register`, {
    data: { email: user.email, password: user.password, display_name: user.name },
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await visible(page, 'you@example.com').fill(user.email);
  await visible(page, '••••••••').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByText(/incorrect|invalid|wrong|failed/i).first()).toBeVisible();
  // And it must not let you in anyway.
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});

test('logging out returns to the sign-in screen and stays there after a reload', async ({
  page,
  request,
}) => {
  const user = await registerOnly(request);
  page.on('dialog', (d) => void d.accept()); // web confirm() on log out
  await loginViaUi(page, user);
  await appReady(page);

  await page.getByLabel('Open settings').click();
  await page.getByText('Log out').first().click();

  // Signed out lands on the front door: Register or Log in.
  const door = () => page.getByRole('button', { name: 'Register' });
  await expect(door()).toBeVisible({ timeout: 20_000 });
  // A reload must not resurrect the session — the token has to be gone from
  // storage, not merely forgotten by the running app.
  await page.reload();
  await expect(door()).toBeVisible({ timeout: 20_000 });
});

test('a forgotten password has somewhere to go', async ({ page }) => {
  await page.goto('/login');
  await page.getByText('Forgot password?').click();
  await page.waitForURL(/\/forgot/, { timeout: 30_000 });
  await page.getByPlaceholder('you@example.com').locator('visible=true').fill('nobody@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  // The e2e server has no mail relay: it must say so and name who can help,
  // rather than promise an email.
  await expect(page.getByText(/runs it to reset your password/i)).toBeVisible({ timeout: 20_000 });
});

test('no social buttons appear on a server with none configured', async ({ page, request }) => {
  // The default, and the common case for a self-hosted install: a button that
  // fails on tap is worse than one way in that works.
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).first().click();
  await expect(visible(page, 'you@example.com')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Continue with/)).toHaveCount(0);

  const res = await request.get(`${API}/auth/providers`);
  expect(await res.json()).toEqual({ providers: [] });
});
