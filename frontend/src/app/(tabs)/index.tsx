import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { StatsSummary, Workout } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Feedback';
import { CoachCheckin } from '@/components/coach/CoachCheckin';
import { formatWeight, relativeTime } from '@/lib/format';

function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <Card className="flex-1 items-center py-3">
      <Text variant="title" className="text-brand">
        {value}
      </Text>
      <Text variant="caption" className="mt-0.5 uppercase tracking-wide">
        {label}
      </Text>
    </Card>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { settings } = useSettings();
  const { workout: active, start } = useActiveWorkout();

  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [recent, setRecent] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api.statsSummary().catch(() => null),
        api.workouts({ limit: 5 }).catch(() => ({ items: [], total: 0 })),
      ]);
      if (s) setStats(s);
      setRecent(w.items.filter((it) => it.status === 'completed').slice(0, 5));
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

  async function onStartBlank() {
    setStarting(true);
    try {
      const w = await start({ name: 'Quick workout' });
      router.push(`/workout/active/${w.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Screen
      scroll={false}
      padded={false}>
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
        <View className="mt-2 rounded-lg border border-iron-700 bg-iron-900 p-4">
          <Text variant="label" className="text-brand">
            TRAINING DECK
          </Text>
          <Text variant="title" className="mt-1">
            {user?.display_name ?? 'Athlete'}
          </Text>
          <Text variant="muted" className="mt-1">
            Log the work. Beat the last session.
          </Text>
        </View>

        {active ? (
          <Card
            className="mt-4 border-brand bg-iron-900"
            onPress={() => router.push(`/workout/active/${active.id}`)}>
            <Text variant="label" className="text-brand">
              Workout in progress
            </Text>
            <Text variant="subheading" className="mt-0.5">
              {active.name ?? 'Active workout'} · {active.exercises.length} exercises
            </Text>
            <Text variant="muted" className="mt-1">
              Tap to resume
            </Text>
          </Card>
        ) : (
          <Button
            title="Start workout"
            size="lg"
            className="mt-4"
            loading={starting}
            onPress={onStartBlank}
          />
        )}

        <Pressable
          onPress={() => router.push('/coach')}
          accessibilityRole="button"
          className="mt-4 flex-row items-center rounded-lg border border-brand bg-brand px-4 py-3.5 active:bg-brand-600">
          <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-iron-950/20">
            <Ionicons name="chatbubbles" size={22} color="#080706" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-black text-iron-950">Chat with your coach</Text>
            <Text className="text-sm font-medium text-iron-950/80">
              Ask what to train, work around injuries, plan your week
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#080706" />
        </Pressable>

        <View className="mt-4">
          <CoachCheckin />
        </View>

        {loading ? (
          <Loading />
        ) : (
          <>
            <View className="mt-6 flex-row gap-3">
              <StatTile value={stats?.total_workouts ?? 0} label="Total" />
              <StatTile value={stats?.this_week ?? 0} label="This week" />
              <StatTile value={stats?.recent_prs?.length ?? 0} label="Recent PRs" />
            </View>

            {stats?.recent_prs && stats.recent_prs.length > 0 ? (
              <View className="mt-6">
                <Text variant="heading" className="mb-2">
                  Recent PRs
                </Text>
                <Card className="gap-2">
                  {stats.recent_prs.slice(0, 4).map((pr, i) => (
                    <View
                      key={`${pr.exercise_id}-${i}`}
                      className="flex-row items-center justify-between">
                      <Text variant="body" numberOfLines={1} className="flex-1">
                        {pr.exercise_name ?? 'Exercise'}
                      </Text>
                      <Text variant="label">
                        {formatWeight(pr.weight, settings.units)} × {pr.reps}
                      </Text>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}

            <View className="mt-6">
              <View className="flex-row items-center justify-between mb-2">
                <Text variant="heading">Recent workouts</Text>
                <Text
                  variant="label"
                  className="text-brand"
                  onPress={() => router.push('/(tabs)/workouts')}>
                  See all
                </Text>
              </View>
              {recent.length === 0 ? (
                <Card>
                  <Text variant="muted">No workouts yet. Start your first session above.</Text>
                </Card>
              ) : (
                <View className="gap-2">
                  {recent.map((w) => (
                    <Card key={w.id} onPress={() => router.push(`/workout/${w.id}`)}>
                      <View className="flex-row items-center justify-between">
                        <Text variant="subheading" numberOfLines={1} className="flex-1">
                          {w.name ?? 'Workout'}
                        </Text>
                        <Text variant="muted">{relativeTime(w.finished_at ?? w.started_at)}</Text>
                      </View>
                      <Text variant="muted" className="mt-0.5">
                        {w.exercises.length} exercises ·{' '}
                        {w.exercises.reduce((acc, e) => acc + e.sets.length, 0)} sets
                      </Text>
                    </Card>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
