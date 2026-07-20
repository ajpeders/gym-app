import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Routine, RoutineInput } from '@/api/types';
import { useSettings } from '@/state/settings';
import { RoutineEditor, type DraftExercise } from '@/components/RoutineEditor';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { promptExport, routineToJson, routineToText } from '@/lib/export';

function toDraft(routine: Routine): DraftExercise[] {
  return routine.exercises
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => ({
      exercise_id: e.exercise_id,
      name: e.exercise?.name ?? 'Exercise',
      image: e.exercise?.images?.[0] ?? null,
      target_sets: e.target_sets != null ? String(e.target_sets) : '',
      target_reps:
        e.target_reps != null
          ? e.target_reps_max != null && e.target_reps_max !== e.target_reps
            ? `${e.target_reps}-${e.target_reps_max}`
            : String(e.target_reps)
          : '',
      target_weight: e.target_weight != null ? String(e.target_weight) : '',
      rest_seconds: e.rest_seconds != null ? String(e.rest_seconds) : '',
    }));
}

export default function EditRoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { settings } = useSettings();
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
      <SafeAreaView className="flex-1 bg-iron-950">
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
      onExport={() =>
        promptExport(
          routine.name,
          routineToText(routine, settings.units),
          routineToJson(routine, settings.units),
        )
      }
    />
  );
}
