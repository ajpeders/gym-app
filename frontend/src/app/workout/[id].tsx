import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Workout, WorkoutInput } from '@/api/types';
import { useSettings } from '@/state/settings';
import { WorkoutEditor, type DraftExercise } from '@/components/WorkoutEditor';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { promptExport, workoutToJson, workoutToText } from '@/lib/export';

function toDraft(workout: Workout): DraftExercise[] {
  return workout.exercises
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
      notes: e.notes ?? '',
    }));
}

export default function EditWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { settings } = useSettings();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setWorkout(await api.workout(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workout');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  async function onSave(input: WorkoutInput) {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateWorkout(id, input);
      router.replace('/(tabs)/workouts');
    } finally {
      setSaving(false);
    }
  }

  function onDelete() {
    if (!id) return;
    const doDelete = async () => {
      await api.deleteWorkout(id);
      router.replace('/(tabs)/workouts');
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Delete this workout?')) void doDelete();
      return;
    }
    Alert.alert('Delete workout?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
    ]);
  }

  if (loading || error || !workout) {
    return (
      <SafeAreaView className="flex-1 bg-iron-950">
        <Stack.Screen options={{ headerShown: true, title: 'Workout' }} />
        {loading ? <Loading /> : <ErrorState message={error ?? 'Not found'} onRetry={fetch} />}
      </SafeAreaView>
    );
  }

  return (
    <WorkoutEditor
      title="Edit workout"
      initialName={workout.name}
      initialNotes={workout.notes ?? ''}
      initialExercises={toDraft(workout)}
      initialWeekdays={workout.weekdays}
      initialFloating={workout.floating}
      saving={saving}
      onSave={onSave}
      onDelete={onDelete}
      onExport={() =>
        promptExport(
          workout.name,
          workoutToText(workout, settings.units),
          workoutToJson(workout, settings.units),
        )
      }
    />
  );
}
