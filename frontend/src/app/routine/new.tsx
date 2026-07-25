import { useState } from 'react';
import { useRouter } from 'expo-router';

import { api, ApiError } from '@/api/client';
import type { RoutineInput } from '@/api/types';
import { RoutineEditor } from '@/components/RoutineEditor';

export default function NewRoutineScreen() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onSave(input: RoutineInput) {
    setSaving(true);
    try {
      await api.createRoutine(input);
      router.replace('/(tabs)/routines');
    } catch (err) {
      throw err instanceof ApiError ? err : new Error('Failed to save split');
    } finally {
      setSaving(false);
    }
  }

  return <RoutineEditor title="New split" saving={saving} onSave={onSave} />;
}
