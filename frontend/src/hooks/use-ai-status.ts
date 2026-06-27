import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { api } from '@/api/client';
import type { AiProviders } from '@/api/types';

export interface AiStatus {
  /** Whether the user's active AI provider is usable right now. */
  configured: boolean;
  /** Full provider payload, or null while loading / on error. */
  providerInfo: AiProviders | null;
  /** True until the first fetch resolves. */
  loading: boolean;
  /** Re-fetch on demand (also runs automatically on focus). */
  refresh: () => Promise<void>;
}

/**
 * Fetches per-user AI provider status and refreshes whenever the screen
 * regains focus, so setup-gating UI updates right after the user configures
 * their provider in Settings.
 */
export function useAiStatus(): AiStatus {
  const [providerInfo, setProviderInfo] = useState<AiProviders | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const p = await api.aiProviders();
      setProviderInfo(p);
    } catch {
      // Leave previous value; treat unknown as not-configured downstream.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return {
    configured: providerInfo?.configured ?? false,
    providerInfo,
    loading,
    refresh,
  };
}
