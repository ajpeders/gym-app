import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '@/api/client';
import type { User } from '@/api/types';
import { deleteItem, getItem, setItem, TOKEN_KEY } from '@/lib/storage';

// DEMO_MODE: skip the login/register UI and auto-sign-in as a shared demo user.
// Off now that accounts are real: while it was on, logging out deleted the token
// and immediately signed back in as the demo user, so the Log out button looked
// broken — and the login and register screens were unreachable, which also made
// first-run onboarding impossible to ever see.
export const DEMO_MODE = false;
const DEMO_EMAIL = 'demo@gymapp.io';
const DEMO_PASSWORD = 'demo-account';
const DEMO_NAME = 'Demo';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Finish a social sign-in: the server already verified the provider's
   * token and issued ours. */
  loginWithProvider: (provider: string, token: string) => Promise<void>;
  /** Sign in with a token the server already issued (a password reset). */
  loginWithToken: (token: string, user: User) => Promise<void>;
  /** Delete this account and everything it owns, then sign out. */
  deleteAccount: () => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadMe: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The last profile the server confirmed. An app that logs you out the moment
// it restarts without signal is useless in a basement — and the basement is
// where this app is used. The token is what actually authorises anything, so
// trusting a cached profile while offline grants nothing: every request still
// has to pass the server when one is reachable.
const USER_KEY = 'gymapp.user';

async function cacheUser(user: User): Promise<void> {
  await setItem(USER_KEY, JSON.stringify(user));
}

async function cachedUser(): Promise<User | null> {
  const raw = await getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

// Sign in to the shared demo account, creating it on first run.
async function ensureDemoSession(): Promise<User> {
  try {
    const res = await api.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    await setItem(TOKEN_KEY, res.token);
    return res.user;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // network error, etc.
  }
  try {
    const res = await api.register({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      display_name: DEMO_NAME,
    });
    await setItem(TOKEN_KEY, res.token);
    return res.user;
  } catch (err) {
    // Created by a concurrent client between our login and register — just log in.
    if (err instanceof ApiError && err.status === 409) {
      const res = await api.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
      await setItem(TOKEN_KEY, res.token);
      return res.user;
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (): Promise<User | null> => {
    const token = await getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      return null;
    }
    try {
      const me = await api.me();
      setUser(me);
      await cacheUser(me);
      return me;
    } catch (err) {
      // Invalid / expired token — clear it, and the cached profile with it.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        await deleteItem(TOKEN_KEY);
        await deleteItem(USER_KEY);
        setUser(null);
        return null;
      }
      // Couldn't reach the server: stay signed in on the last known profile so
      // an offline restart resumes the session instead of dumping the athlete
      // on the login screen mid-workout.
      const cached = await cachedUser();
      setUser(cached);
      return cached;
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const current = await loadMe();
        if (!current && DEMO_MODE) {
          setUser(await ensureDemoSession());
        }
      } catch {
        // Leave unauthenticated; screens surface their own errors.
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    await setItem(TOKEN_KEY, res.token);
    await cacheUser(res.user);
    setUser(res.user);
  }, []);

  const loginWithProvider = useCallback(async (provider: string, token: string) => {
    const res = await api.oauthLogin(provider, token);
    await setItem(TOKEN_KEY, res.token);
    await cacheUser(res.user);
    setUser(res.user);
  }, []);

  const loginWithToken = useCallback(async (token: string, me: User) => {
    await setItem(TOKEN_KEY, token);
    await cacheUser(me);
    setUser(me);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await api.register({ email, password, display_name: displayName });
      await setItem(TOKEN_KEY, res.token);
      // Explicitly false, not absent: that's what marks this account as new.
      // Accounts that predate onboarding have no flag at all and must not be
      // dragged through a welcome screen for an app they already use.
      try {
        await api.updateSettings({ feature_flags: { onboarded: false } });
      } catch {
        // Worst case the walkthrough doesn't show. Never block a signup on it.
      }
      await cacheUser(res.user);
      setUser(res.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    await deleteItem(TOKEN_KEY);
    await deleteItem(USER_KEY); // or the next launch would resume offline as them
    if (DEMO_MODE) {
      // Stay usable: drop back to the demo account rather than the login wall.
      try {
        setUser(await ensureDemoSession());
        return;
      } catch {
        // fall through to signed-out
      }
    }
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount();
    await logout();
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, loginWithProvider, loginWithToken, register, logout, loadMe, deleteAccount }),
    [user, loading, login, loginWithProvider, loginWithToken, register, logout, loadMe, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
