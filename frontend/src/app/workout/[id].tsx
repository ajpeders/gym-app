import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { api } from '@/api/client';
import type { Workout } from '@/api/types';
import { useSettings } from '@/state/settings';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { formatDateTime, formatDuration, titleCase } from '@/lib/format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text variant="subheading">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const totalSets = workout?.exercises.reduce((acc, e) => acc + e.sets.length, 0) ?? 0;
  const totalVolume =
    workout?.exercises.reduce(
      (acc, e) => acc + e.sets.reduce((a, s) => a + s.reps * s.weight, 0),
      0,
    ) ?? 0;

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: workout?.name ?? 'Workout' }} />
      {loading ? (
        <Loading />
      ) : error || !workout ? (
        <ErrorState message={error ?? 'Not found'} onRetry={fetch} />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
          <Text variant="title">{workout.name ?? 'Workout'}</Text>
          <Text variant="muted" className="mt-0.5">
            {formatDateTime(workout.started_at)}
          </Text>

          <View className="flex-row justify-between my-4">
            <Stat label="Duration" value={formatDuration(workout.started_at, workout.finished_at)} />
            <Stat label="Exercises" value={String(workout.exercises.length)} />
            <Stat label="Sets" value={String(totalSets)} />
            <Stat label="Volume" value={`${Math.round(totalVolume)} ${settings.units}`} />
          </View>

          {workout.notes ? (
            <Card className="mb-3">
              <Text variant="label" className="mb-1">
                Notes
              </Text>
              <Text variant="body">{workout.notes}</Text>
            </Card>
          ) : null}

          {workout.exercises
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((we) => (
              <Card key={we.id} className="mb-3">
                <Text variant="subheading">{we.exercise?.name ?? 'Exercise'}</Text>
                {we.exercise?.primary_muscles?.length ? (
                  <Text variant="muted" numberOfLines={1}>
                    {we.exercise.primary_muscles.map(titleCase).join(', ')}
                  </Text>
                ) : null}
                <View className="mt-2 gap-1">
                  {we.sets.length === 0 ? (
                    <Text variant="muted">No sets logged.</Text>
                  ) : (
                    we.sets.map((s, i) => (
                      <View
                        key={s.id}
                        className="flex-row items-center rounded-md bg-iron-800 px-3 py-2">
                        <Text variant="label" className="w-10">
                          {i + 1}
                        </Text>
                        <Text variant="body" className="flex-1">
                          {s.weight} {settings.units} × {s.reps}
                        </Text>
                        {s.rpe ? <Text variant="muted">RPE {s.rpe}</Text> : null}
                      </View>
                    ))
                  )}
                </View>
              </Card>
            ))}
        </ScrollView>
      )}
    </Screen>
  );
}
