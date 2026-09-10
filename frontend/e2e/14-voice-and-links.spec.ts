/**
 * Two ways in that aren't typing: a deep link (which is what makes a Siri
 * Shortcut possible without a native App Intent) and the microphone.
 *
 * Neither needs a model to be worth testing — what matters is that the words
 * reach the existing parse pipeline, and that an unavailable microphone is
 * simply absent rather than a button that does nothing.
 */
import { expect, test, type Page } from '@playwright/test';

import { findExercise, signIn } from './helpers';

const shown = (page: Page, text: string | RegExp) =>
  page.getByText(text).locator('visible=true').first();

test('a deep-linked phrase is parsed on arrival', async ({ page, request }) => {
  const account = await signIn(page, request);
  const bench = await findExercise(request, account.token, 'bench');

  // What a Shortcut opens: gymapp://log-chat?text=… — same route on the web.
  await page.goto(`/log-chat?text=${encodeURIComponent(`${bench.name} 3x8 at 60kg`)}`);

  // The phrase is sent without waiting for a tap, and notation needs no
  // model: the sets come back as a proposal to add, on an account with no AI.
  await expect(shown(page, `${bench.name} 3x8 at 60kg`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Add to session' })).toBeVisible({ timeout: 30_000 });
});

test('prose the rules cannot read still says AI is not set up', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/log-chat?text=did%20some%20benching%20and%20it%20felt%20fine');
  await expect(shown(page, /set up|configure|settings/i)).toBeVisible({ timeout: 30_000 });
});

test('the same phrase is not re-sent when the screen re-renders', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/log-chat?text=squat%205x5');

  await expect(shown(page, 'squat 5x5')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  // Exactly one attempt — a Shortcut firing twice would log the set twice.
  await expect(page.getByText('squat 5x5')).toHaveCount(1);
});

test('the microphone button appears only where speech works', async ({ page, request }) => {
  await signIn(page, request);

  // Chromium exposes webkitSpeechRecognition, so the button should be offered.
  await page.goto('/log-chat');
  await expect(page.getByLabel('Speak your sets')).toBeVisible({ timeout: 30_000 });

  // With the API removed before any app code runs, it must be absent rather
  // than present-and-broken.
  const context = page.context();
  await context.addInitScript(() => {
    // @ts-expect-error - deleting a browser global for the test
    delete window.SpeechRecognition;
    // @ts-expect-error - deleting a browser global for the test
    delete window.webkitSpeechRecognition;
  });
  const fresh = await context.newPage();
  await fresh.goto('/log-chat');
  await expect(fresh.getByLabel('Read these sets')).toBeVisible({ timeout: 30_000 });
  await expect(fresh.getByLabel('Speak your sets')).toHaveCount(0);
  await fresh.close();
});

test('what the microphone hears goes straight to the parser', async ({ page, request }) => {
  await signIn(page, request);

  // Stand in for the platform's recogniser: the app should treat a transcript
  // exactly like typed text.
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: 'deadlift 3x5 at 100kg' }]] });
          this.onend?.();
        }, 50);
      }
      stop() {
        this.onend?.();
      }
    }
    // @ts-expect-error - installing a stand-in for the platform API
    window.SpeechRecognition = FakeRecognition;
    // @ts-expect-error - installing a stand-in for the platform API
    window.webkitSpeechRecognition = FakeRecognition;
  });

  await page.goto('/log-chat');
  await page.getByLabel('Speak your sets').click();

  await expect(shown(page, 'deadlift 3x5 at 100kg')).toBeVisible({ timeout: 30_000 });
});
