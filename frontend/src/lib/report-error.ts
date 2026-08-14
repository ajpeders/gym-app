import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { API_BASE } from '@/api/client';
import { getItem, TOKEN_KEY } from '@/lib/storage';

/**
 * Send a crash to the API so it lands in the server log.
 *
 * Nothing recorded errors before this — a crash mid-session vanished with the
 * app, which is the one moment you'd most want a trace.
 *
 * Uses plain fetch rather than the api client on purpose: the client throws
 * ApiError, and something that reports failures must not be able to fail
 * loudly. Every path here swallows.
 */
export async function reportError(
  error: unknown,
  context?: string,
): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    await fetch(`${API_BASE}/errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: err.message || 'Unknown error',
        stack: err.stack ?? null,
        context: context ?? null,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? null,
      }),
    });
  } catch {
    // Offline, or the API is down — which is frequently *why* it crashed.
    // A report that can't be delivered is not worth a second error.
  }
}

/**
 * Route uncaught errors to the API, once, at startup.
 *
 * The existing handler is kept and called afterwards: React Native's shows the
 * redbox in development and ends the process on a fatal in production, and
 * losing either would be worse than losing the report.
 */
export function installGlobalErrorReporting(): void {
  const globalWithErrorUtils = global as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => void;
    };
    __gymErrorReportingInstalled?: boolean;
  };
  const errorUtils = globalWithErrorUtils.ErrorUtils;
  if (!errorUtils || globalWithErrorUtils.__gymErrorReportingInstalled) return;
  globalWithErrorUtils.__gymErrorReportingInstalled = true;

  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    void reportError(error, isFatal ? 'fatal' : 'uncaught');
    previous(error, isFatal);
  });
}
