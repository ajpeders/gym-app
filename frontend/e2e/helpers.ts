import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const API = 'http://127.0.0.1:8011/api';

/** A fresh account per test — the API is shared, the data never is. */
export function newUser() {
  const tag = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return { email: `e2e-${tag}@example.com`, password: 'Testing123!', name: `E2E ${tag}` };
}

/** The address the test API treats as its operator (see e2e/api.sh). Signing
 * in as an admin uses the real bootstrap path rather than a test-only door. */
export const ADMIN_EMAIL = 'e2e-admin@example.com';
const ADMIN_PASSWORD = 'Testing123!';

export interface Account {
  email: string;
  password: string;
  name: string;
  token: string;
}

/**
 * Register through the API, then hand the browser the token.
 *
 * The registration *screen* has its own test; every other test starts from
 * "signed in" rather than re-driving that form, which keeps failures pointing
 * at the thing under test.
 */
export async function signIn(
  page: Page,
  request: APIRequestContext,
  opts: { onboarded?: boolean; admin?: boolean } = {},
): Promise<Account> {
  const user = opts.admin
    ? { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'E2E Admin' }
    : newUser();
  const res = await request.post(`${API}/auth/register`, {
    data: { email: user.email, password: user.password, display_name: user.name },
  });
  // The admin account is shared across tests, so the second one to ask for it
  // logs in rather than failing on the duplicate.
  let token: string;
  if (res.ok()) {
    token = (await res.json()).token as string;
  } else {
    expect(opts.admin, `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const login = await request.post(`${API}/auth/login`, {
      data: { email: user.email, password: user.password },
    });
    expect(login.ok(), `admin login failed: ${login.status()}`).toBeTruthy();
    token = (await login.json()).token as string;
  }

  // The app's own register screen writes `onboarded: false`, which is what
  // sends a new account to the welcome tour; registering through the API sets
  // no flag at all. Both states are worth testing, so both are set explicitly.
  await request.patch(`${API}/settings`, {
    headers: { authorization: `Bearer ${token}` },
    data: { feature_flags: { onboarded: opts.onboarded !== false } },
  });

  // Seed the token the way the app stores it, before any app code runs.
  await page.addInitScript((t) => {
    window.localStorage.setItem('gymapp.token', t);
  }, token);

  return { ...user, token };
}

/**
 * Quote a value for use inside `new RegExp(...)`.
 *
 * Exercise names reach these tests as data, and `findExercise`'s fallback names
 * them "<term> (e2e)" — whose parentheses become a *group* once interpolated
 * into a pattern, so the regex silently stops matching the label it was built
 * from and the click waits out the full timeout.
 */
export function rx(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function authed(request: APIRequestContext, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  return {
    get: async (path: string) => {
      const r = await request.get(`${API}${path}`, { headers });
      expect(r.ok(), `GET ${path} -> ${r.status()}`).toBeTruthy();
      return r.json();
    },
    post: async (path: string, data: unknown) => {
      const r = await request.post(`${API}${path}`, { headers, data });
      expect(r.ok(), `POST ${path} -> ${r.status()} ${await r.text()}`).toBeTruthy();
      // 204s (a password reset, say) have no body to parse.
      const body = await r.text();
      return body ? JSON.parse(body) : null;
    },
    patch: async (path: string, data: unknown) => {
      const r = await request.patch(`${API}${path}`, { headers, data });
      expect(r.ok(), `PATCH ${path} -> ${r.status()}`).toBeTruthy();
      return r.json();
    },
  };
}

/**
 * Register through the API without seeding the browser, then log in through
 * the form. Used by tests that reload the page: the token-seeding init script
 * re-runs on every navigation, which would silently undo a log out.
 */
export async function registerOnly(
  request: APIRequestContext,
  opts: { onboarded?: boolean } = {},
): Promise<Account> {
  const user = newUser();
  const res = await request.post(`${API}/auth/register`, {
    data: { email: user.email, password: user.password, display_name: user.name },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const token = (await res.json()).token as string;
  if (opts.onboarded !== false) {
    await request.patch(`${API}/settings`, {
      headers: { authorization: `Bearer ${token}` },
      data: { feature_flags: { onboarded: true } },
    });
  }
  return { ...user, token };
}

export async function loginViaUi(page: Page, user: Account) {
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').locator('visible=true').fill(user.email);
  await page.getByPlaceholder('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022').locator('visible=true').fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/**
 * An exercise to build plans from: the first catalog match for `term`, or a
 * custom one created on the spot.
 *
 * The fallback is what lets this suite run anywhere. Locally the API starts
 * from a copy of the dev database and has the full 828-row wger catalog; CI
 * has no seeded catalog and no network to fetch one, and neither should decide
 * whether the tests can run.
 */
export async function findExercise(request: APIRequestContext, token: string, term: string) {
  const api = authed(request, token);
  const rows = await api.get(`/exercises?q=${encodeURIComponent(term)}&limit=1`);
  const list = Array.isArray(rows) ? rows : (rows.items ?? []);
  if (list.length) return list[0];
  return api.post('/exercises', {
    name: `${term} (e2e)`,
    category: 'strength',
    equipment: 'barbell',
    primary_muscles: ['chest'],
    instructions: ['Lift it.'],
  });
}

/**
 * An active split with one day scheduled every weekday, so "today" always has
 * something to start whatever day the suite runs on.
 */
export async function seedPlan(
  request: APIRequestContext,
  token: string,
  opts: { name?: string; exercise?: string; mode?: 'rigid' | 'rolling'; days?: string[] } = {},
) {
  const api = authed(request, token);
  const exercise = await findExercise(request, token, opts.exercise ?? 'bench');
  const split = await api.post('/splits', {
    name: `${opts.name ?? 'Day'} split`,
    mode: opts.mode ?? 'rigid',
  });
  await api.patch(`/splits/${split.id}`, { is_active: true });

  const everyDay = [0, 1, 2, 3, 4, 5, 6];
  const names = opts.days ?? [opts.name ?? 'Push Day'];
  const workouts = [];
  for (const [i, name] of names.entries()) {
    workouts.push(
      await api.post('/workouts', {
        name,
        split_id: Number(split.id),
        // A rolling split schedules by order alone; a rigid one needs a weekday
        // that is always today.
        weekdays: opts.mode === 'rolling' ? [] : everyDay,
        order: i,
        exercises: [
          { exercise_id: exercise.id, target_sets: 3, target_reps: 8, order: 0 },
        ],
      }),
    );
  }
  return { split, workout: workouts[0], workouts, exercise };
}

/**
 * Log a set on the active-session screen.
 *
 * The weight field is named for the movement — "Added weight" for a bodyweight
 * exercise, "Weight" for a loaded one — so tests address whichever is there
 * rather than depending on which exercise the catalog happened to supply.
 */
export async function logSet(page: Page, weight: string, reps: string) {
  await page.getByLabel(/^(Added weight|Weight)$/).fill(weight);
  await page.getByLabel('Reps').fill(reps);
  await page.getByLabel('Log set').click();
}

/** Wait for the app shell to finish booting (it renders a splash first). */
export async function appReady(page: Page) {
  await expect(page.getByText('Home', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}
