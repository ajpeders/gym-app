import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '@/api/client';
import type { Routine, RoutineInput } from '@/api/types';
import { RoutineEditor, type DraftExercise } from '@/components/RoutineEditor';
import { Loading, ErrorState } from '@/components/ui/Feedback';

function toDraft(routine: Routine): DraftExercise[] {
  return routine.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => ({
      exercise_id: e.exercise_id,
      name: e.exercise?.name ?? 'Exercise',
      target_sets: e.target_sets != null ? String(e.target_sets) : '',
      target_reps: e.target_reps != null ? String(e.target_reps) : '',
      target_weight: e.target_weight != null ? String(e.target_weight) : '',
      rest_seconds: e.rest_seconds != null ? String(e.rest_seconds) : '',
    }));
}

export default function EditRoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setRoutine(await api.routine(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load routine');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  async function onSave(input: RoutineInput) {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateRoutine(id, input);
      router.replace('/(tabs)/routines');
    } finally {
      setSaving(false);
    }
  }

  function onDelete() {
    if (!id) return;
    const doDelete = async () => {
      await api.deleteRoutine(id);
      router.replace('/(tabs)/routines');
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Delete this routine?')) void doDelete();
      return;
    }
    Alert.alert('Delete routine?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
    ]);
  }

  if (loading || error || !routine) {
    return (
      <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-neutral-950">
        <Stack.Screen options={{ headerShown: true, title: 'Routine' }} />
        {loading ? <Loading /> : <ErrorState message={error ?? 'Not found'} onRetry={fetch} />}
      </SafeAreaView>
    );
  }

  return (
    <RoutineEditor
      title="Edit routine"
      initialName={routine.name}
      initialNotes={routine.notes ?? ''}
      initialExercises={toDraft(routine)}
      saving={saving}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
}
