import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/api/client';
import type { Settings, SettingsUpdate } from '@/api/types';
import { useAuth } from './auth';

const DEFAULT_SETTINGS: Settings = {
  units: 'kg',
  feature_flags: { quick_buttons: true, in_set_prompts: false },
  ai_provider: 'ollama',
  ai_model: null,
  rest_timer_default: 90,
};

interface SettingsContextValue {
  settings: Settings;
  loading: boolean;
  refresh: () => Promise<void>;
  update: (patch: SettingsUpdate) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.settings();
      setSettings({ ...DEFAULT_SETTINGS, ...s, feature_flags: { ...DEFAULT_SETTINGS.feature_flags, ...s.feature_flags } });
    } catch {
      // keep defaults if settings fetch fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void refresh();
    } else {
      setSettings(DEFAULT_SETTINGS);
    }
  }, [user, refresh]);

  const update = useCallback(
    async (patch: SettingsUpdate) => {
      // optimistic
      setSettings((prev) => ({
        ...prev,
        ...patch,
        feature_flags: { ...prev.feature_flags, ...patch.feature_flags },
      }));
      const updated = await api.updateSettings(patch);
      setSettings({ ...DEFAULT_SETTINGS, ...updated, feature_flags: { ...DEFAULT_SETTINGS.feature_flags, ...updated.feature_flags } });
    },
    [],
  );

  const value = useMemo(
    () => ({ settings, loading, refresh, update }),
    [settings, loading, refresh, update],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
