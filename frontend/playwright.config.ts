import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: the real web build, driven in a browser, against a real
 * API and a real SQLite database.
 *
 * Nothing is mocked. That is the point — the bugs this suite exists to catch
 * (an offline start that loses sets, a split whose mode the server and screen
 * disagree about) only appear when the whole stack is wired together.
 *
 * `npm run e2e` builds the web bundle first; `npm run e2e:fast` reuses the last
 * build when you're only changing tests.
 */
const API_PORT = 8011;
const WEB_PORT = 8012;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one API + one database; keep the ordering legible
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 430, height: 900 }, // phone-shaped: this is a phone app
  },
  projects: [{ name: 'mobile-web', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bash e2e/api.sh',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `node e2e/serve.mjs`,
      url: `http://127.0.0.1:${WEB_PORT}/`,
      reuseExistingServer: !process.env.CI,
      env: { PORT: String(WEB_PORT) },
    },
  ],
});
