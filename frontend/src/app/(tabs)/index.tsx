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
const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  return dateKey(new Date(iso)) === dateKey(new Date());
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
  const [workoutDays, setWorkoutDays] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api.statsSummary().catch(() => null),
        api.workouts({ limit: 12 }).catch(() => ({ items: [] as Workout[], total: 0 })),
      ]);
      if (s) setStats(s);
      const completed = w.items.filter((it) => it.status === 'completed');
      setTodays(completed.find((it) => isToday(it.started_at)) ?? null);
      setWorkoutDays(new Set(completed.map((it) => dateKey(new Date(it.started_at)))));
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

  // 7-day window centered on today: 3 days back … today … 3 days ahead
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + (i - 3));
    return d;
  });

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
        <View className="mt-3 flex-row items-start justify-between">
          <View className="flex-1">
            <Text variant="caption" className="uppercase tracking-wide text-brand">
              {dateLabel}
            </Text>
            <Text variant="title" className="mt-0.5">
              Hey{user?.display_name ? `, ${user.display_name}` : ''}
            </Text>
          </View>
          <View className="ml-3 flex-row items-center rounded-full border border-iron-700 bg-iron-900 px-3 py-1.5">
            <Ionicons name="flame" size={16} color="#f97316" />
            <Text variant="label" className="ml-1 text-brand">
              {streak}
            </Text>
          </View>
        </View>

        {/* Week strip — highlights today, marks trained days */}
        <View className="mt-4 flex-row justify-between">
          {weekDays.map((d, i) => {
            const today = dateKey(d) === dateKey(now);
            const worked = workoutDays.has(dateKey(d));
            return (
              <View key={i} className="items-center">
                <Text variant="caption" className={today ? 'text-brand' : 'text-iron-500'}>
                  {DOW1[d.getDay()]}
                </Text>
                <View
                  className={`mt-1 h-9 w-9 items-center justify-center rounded-full ${
                    today
                      ? 'bg-brand'
                      : worked
                        ? 'border border-brand/50 bg-iron-800'
                        : 'border border-iron-700 bg-iron-900'
                  }`}>
                  <Text
                    variant="body"
                    className={
                      today
                        ? 'font-extrabold text-iron-950'
                        : worked
                          ? 'text-brand'
                          : 'text-iron-400'
                    }>
                    {d.getDate()}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {!aiLoading && !aiConfigured ? (
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            className="mt-5 flex-row items-center rounded-lg border border-brand bg-brand/10 p-4 active:opacity-80">
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

        {/* TODAY — the centerpiece */}
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
