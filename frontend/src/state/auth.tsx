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
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadMe: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
      return me;
    } catch (err) {
      // Invalid / expired token — clear it.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        await deleteItem(TOKEN_KEY);
      }
      setUser(null);
      return null;
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
    setUser(res.user);
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
      setUser(res.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    await deleteItem(TOKEN_KEY);
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

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout, loadMe }),
    [user, loading, login, register, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
