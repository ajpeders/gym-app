import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { StatsSummary, Workout } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useActiveWorkout } from '@/state/active-workout';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

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

function FeatureCard({
  icon,
  title,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-1 flex-row items-center rounded-lg border border-iron-700 bg-iron-900 p-3 active:opacity-70">
      <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-brand/15">
        <Ionicons name={icon} size={18} color="#f97316" />
      </View>
      <Text variant="subheading">{title}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { workout: active, start } = useActiveWorkout();
  const { configured: aiConfigured, loading: aiLoading } = useAiStatus();

  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [todays, setTodays] = useState<Workout | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api.statsSummary().catch(() => null),
        api.workouts({ limit: 8 }).catch(() => ({ items: [] as Workout[], total: 0 })),
      ]);
      if (s) setStats(s);
      setTodays(
        w.items.find((it) => it.status === 'completed' && isToday(it.started_at)) ?? null,
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData]),
  );

  async function onStart() {
    setStarting(true);
    try {
      const w = await start({ name: 'Workout' });
      router.push(`/workout/active/${w.id}`);
    } finally {
      setStarting(false);
    }
  }

  const now = new Date();
  const dateLabel = `${DOW[now.getDay()]}, ${MON[now.getMonth()]} ${now.getDate()}`;
  const streak = stats?.streak ?? 0;

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
        <View className="mt-3">
          <Text variant="caption" className="uppercase tracking-wide text-brand">
            {dateLabel}
          </Text>
          <Text variant="title" className="mt-0.5">
            Hey{user?.display_name ? `, ${user.display_name}` : ''}
          </Text>
        </View>

        {!aiLoading && !aiConfigured ? (
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            className="mt-4 flex-row items-center rounded-lg border border-brand bg-brand/10 p-4 active:opacity-80">
            <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-brand/20">
              <Ionicons name="sparkles" size={22} color="#f97316" />
            </View>
            <View className="flex-1">
              <Text variant="subheading" className="text-brand">
                Set up your AI coach
              </Text>
              <Text variant="caption" className="mt-0.5">
                Connect your local AI to unlock the coach, logging, and import.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#f97316" />
          </Pressable>
        ) : null}

        {/* TODAY — the centerpiece: current workout / today's session / start */}
        <Text variant="label" className="mb-2 mt-6">
          TODAY
        </Text>
        {active ? (
          <Card
            className="border-brand bg-iron-900"
            onPress={() => router.push(`/workout/active/${active.id}`)}>
            <View className="flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-full bg-brand/20">
                <Ionicons name="barbell" size={26} color="#f97316" />
              </View>
              <View className="flex-1">
                <Text variant="label" className="text-brand">
                  In progress
                </Text>
                <Text variant="subheading" className="mt-0.5">
                  {active.name ?? 'Workout'} · {active.exercises.length} exercises
                </Text>
              </View>
            </View>
            <Button
              title="Continue workout"
              size="lg"
              className="mt-3"
              onPress={() => router.push(`/workout/active/${active.id}`)}
            />
          </Card>
        ) : todays ? (
          <Card onPress={() => router.push(`/workout/${todays.id}`)}>
            <View className="flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-full bg-brand/15">
                <Ionicons name="checkmark-circle" size={26} color="#f97316" />
              </View>
              <View className="flex-1">
                <Text variant="label" className="text-brand">
                  Done today
                </Text>
                <Text variant="subheading" className="mt-0.5">
                  {todays.name ?? 'Workout'} · {todays.exercises.length} exercises
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color="#78716c" />
            </View>
            <Button
              title="Start another"
              size="lg"
              className="mt-3"
              loading={starting}
              onPress={onStart}
            />
          </Card>
        ) : (
          <Card>
            <Text variant="subheading">Ready to train?</Text>
            <Text variant="muted" className="mt-1">
              No workout logged yet today.
            </Text>
            <Button
              title="Start workout"
              size="lg"
              className="mt-3"
              loading={starting}
              onPress={onStart}
            />
          </Card>
        )}

        {/* Status: streak + glance */}
        <View className="mt-5 flex-row items-center rounded-lg border border-iron-700 bg-iron-900 p-3">
          <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-brand/15">
            <Ionicons name="flame" size={22} color="#f97316" />
          </View>
          <View className="flex-1">
            <Text variant="subheading">{streak > 0 ? `${streak}-day streak` : 'Start a streak'}</Text>
            <Text variant="caption" className="mt-0.5">
              {streak > 0 ? 'Keep it going — train today.' : 'Log a workout today to begin.'}
            </Text>
          </View>
        </View>

        <View className="mt-3 flex-row gap-3">
          <StatTile value={stats?.this_week ?? 0} label="This week" />
          <StatTile value={stats?.total_workouts ?? 0} label="Total" />
          <StatTile value={stats?.recent_prs?.length ?? 0} label="PRs" />
        </View>

        {/* Everything not in the bottom tabs */}
        <View className="mt-6 gap-3">
          <View className="flex-row gap-3">
            <FeatureCard icon="barbell-outline" title="Workouts" onPress={() => router.push('/workouts')} />
            <FeatureCard icon="fitness-outline" title="Exercises" onPress={() => router.push('/exercises')} />
          </View>
          <View className="flex-row gap-3">
            <FeatureCard icon="clipboard-outline" title="Routines" onPress={() => router.push('/routines')} />
            <FeatureCard icon="document-text-outline" title="Import" onPress={() => router.push('/routine-import')} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
