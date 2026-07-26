import { useState } from 'react';
import { useRouter } from 'expo-router';

import { api, ApiError } from '@/api/client';
import type { WorkoutInput } from '@/api/types';
import { WorkoutEditor } from '@/components/WorkoutEditor';

export default function NewWorkoutScreen() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function onSave(input: WorkoutInput) {
    setSaving(true);
    try {
      await api.createWorkout(input);
      router.replace('/(tabs)/workouts');
    } catch (err) {
      throw err instanceof ApiError ? err : new Error('Failed to save workout');
    } finally {
      setSaving(false);
    }
  }

  return <WorkoutEditor title="New workout" saving={saving} onSave={onSave} />;
}
