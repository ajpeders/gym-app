import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Routine, Workout } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, EmptyState } from '@/components/ui/Feedback';
import { formatDuration, relativeTime } from '@/lib/format';

function StatBadge({
  icon,
  label,
  tone = 'brand',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone?: 'brand' | 'mint' | 'steel';
}) {
  const colors = {
    brand: { box: 'border-brand/30 bg-brand/10', text: 'text-brand', icon: '#f97316' },
    mint: { box: 'border-mint/30 bg-mint/10', text: 'text-mint', icon: '#34d399' },
    steel: { box: 'border-steel/30 bg-steel/10', text: 'text-steel', icon: '#38bdf8' },
  }[tone];

  return (
    <View className={`flex-row items-center rounded-full border px-2.5 py-1 ${colors.box}`}>
      <Ionicons name={icon} size={13} color={colors.icon} />
      <Text variant="caption" className={`ml-1 font-bold ${colors.text}`} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

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

  const completed = workouts.filter((w) => w.status === 'completed' || w.finished_at != null);

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
        <View className="mt-2 mb-4 px-0.5">
          <Text variant="eyebrow">Training log</Text>
          <Text variant="title" className="mt-1">
            Workouts
          </Text>
        </View>

        {activeId ? (
          <Card elevated className="mb-4 border-brand bg-brand/10">
            <View className="mb-4 flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-lg bg-brand">
                <Ionicons name="radio-button-on" size={14} color="#080706" />
              </View>
              <View className="flex-1">
                <Text variant="heading">Active workout</Text>
                <Text variant="caption" className="mt-0.5 text-iron-300">
                  Keep logging where you left off.
                </Text>
              </View>
            </View>
            <Button
              title="Resume"
              size="lg"
              icon="play"
              onPress={() => router.push(`/workout/active/${activeId}`)}
            />
          </Card>
        ) : (
          <Button
            title="Start blank workout"
            size="lg"
            icon="add"
            loading={busy}
            className="mb-4"
            onPress={startBlank}
          />
        )}

        {routines.length > 0 ? (
          <View className="mb-5">
            <Text variant="label" className="mb-2 text-iron-300">
              Start from a routine
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {routines.map((r) => (
                  <Card
                    key={r.id}
                    onPress={() => startFromRoutine(r)}
                    className="w-44 border-iron-700 bg-iron-900">
                    <View className="mb-3 h-10 w-10 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
                      <Ionicons name="clipboard-outline" size={20} color="#f97316" />
                    </View>
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

        <View className="mb-2 flex-row items-end justify-between">
          <Text variant="heading">History</Text>
          {completed.length > 0 ? (
            <Text variant="caption">{completed.length} completed</Text>
          ) : null}
        </View>

        {loading ? (
          <Loading />
        ) : completed.length === 0 ? (
          <EmptyState
            icon="LOG"
            title="No completed workouts"
            subtitle="Finish a session and it will show up here."
          />
        ) : (
          <View className="gap-2">
            {completed.map((w) => (
              <Card key={w.id} onPress={() => router.push(`/workout/${w.id}`)}>
                <View className="flex-row items-center justify-between">
                  <View className="mr-3 h-11 w-11 items-center justify-center rounded-lg border border-iron-700 bg-iron-850">
                    <Ionicons name="checkmark" size={20} color="#34d399" />
                  </View>
                  <View className="flex-1">
                    <Text variant="subheading" numberOfLines={1}>
                      {w.name ?? 'Workout'}
                    </Text>
                    <Text variant="caption" className="mt-0.5">
                      {relativeTime(w.finished_at ?? w.started_at)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#57534e" />
                </View>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <StatBadge icon="fitness-outline" label={`${w.exercises.length} exercises`} />
                  <StatBadge
                    icon="checkmark-done-outline"
                    label={`${w.exercises.reduce((acc, e) => acc + e.sets.length, 0)} sets`}
                    tone="mint"
                  />
                  <StatBadge
                    icon="time-outline"
                    label={formatDuration(w.started_at, w.finished_at)}
                    tone="steel"
                  />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
