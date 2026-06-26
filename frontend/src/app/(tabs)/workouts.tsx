import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { api } from '@/api/client';
import type { Routine, Workout } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, EmptyState } from '@/components/ui/Feedback';
import { formatDuration, relativeTime } from '@/lib/format';

export default function WorkoutsScreen() {
  const router = useRouter();
  const { start, activeId } = useActiveWorkout();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([
        api.workouts({ limit: 50 }),
        api.routines().catch(() => [] as Routine[]),
      ]);
      setWorkouts(w.items);
      setRoutines(r);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData]),
  );

  async function startBlank() {
    setBusy(true);
    try {
      const w = await start({ name: 'Quick workout' });
      router.push(`/workout/active/${w.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function startFromRoutine(routine: Routine) {
    setBusy(true);
    try {
      const w = await start({ routine_id: routine.id, name: routine.name });
      router.push(`/workout/active/${w.id}`);
    } finally {
      setBusy(false);
    }
  }

  const completed = workouts.filter((w) => w.status === 'completed');

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-2 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchData();
            }}
          />
        }>
        <Text variant="title" className="mt-2 mb-3">
          Workouts
        </Text>

        {activeId ? (
          <Button
            title="Resume active workout"
            size="lg"
            className="mb-3"
            onPress={() => router.push(`/workout/active/${activeId}`)}
          />
        ) : (
          <Button
            title="＋  Start blank workout"
            size="lg"
            loading={busy}
            className="mb-3"
            onPress={startBlank}
          />
        )}

        {routines.length > 0 ? (
          <View className="mb-5">
            <Text variant="label" className="mb-2">
              Start from a routine
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {routines.map((r) => (
                  <Card
                    key={r.id}
                    onPress={() => startFromRoutine(r)}
                    className="w-44">
                    <Text variant="subheading" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text variant="muted" className="mt-0.5">
                      {r.exercises.length} exercises
                    </Text>
                  </Card>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        <Text variant="heading" className="mb-2">
          History
        </Text>

        {loading ? (
          <Loading />
        ) : completed.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No completed workouts"
            subtitle="Finish a session and it will show up here."
          />
        ) : (
          <View className="gap-2">
            {completed.map((w) => (
              <Card key={w.id} onPress={() => router.push(`/workout/${w.id}`)}>
                <View className="flex-row items-center justify-between">
                  <Text variant="subheading" numberOfLines={1} className="flex-1">
                    {w.name ?? 'Workout'}
                  </Text>
                  <Text variant="muted">{relativeTime(w.finished_at ?? w.started_at)}</Text>
                </View>
                <Text variant="muted" className="mt-0.5">
                  {w.exercises.length} exercises ·{' '}
                  {w.exercises.reduce((acc, e) => acc + e.sets.length, 0)} sets ·{' '}
                  {formatDuration(w.started_at, w.finished_at)}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
