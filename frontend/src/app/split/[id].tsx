import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Split, TodayWorkout, Workout } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Loading, ErrorState } from '@/components/ui/Feedback';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function SplitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { start } = useActiveWorkout();
  const [split, setSplit] = useState<Split | null>(null);
  const [today, setToday] = useState<TodayWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [s, t] = await Promise.all([
        api.split(id),
        api.splitToday().catch(() => [] as TodayWorkout[]),
      ]);
      setSplit(s);
      setToday(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load split');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  const todayDow = new Date().getDay();
  // Ids of today's workouts already logged this week (from GET /splits/today).
  const doneToday = new Set(today.filter((w) => w.done_this_week).map((w) => w.id));

  if (loading || error || !split) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Split' }} />
        {loading ? <Loading /> : <ErrorState message={error ?? 'Not found'} onRetry={fetch} />}
      </Screen>
    );
  }

  const ordered = [...split.workouts].sort((a, b) => a.order - b.order);
  const floating = ordered.filter((w) => w.floating);
  // Workouts scheduled on a given weekday (0=Sun..6=Sat).
  const workoutsForDay = (day: number): Workout[] =>
    ordered.filter((w) => !w.floating && w.weekdays.includes(day));

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: split.name }} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        <Text variant="title">{split.name}</Text>
        <Text variant="muted" className="mt-0.5">
          {ordered.length} {ordered.length === 1 ? 'workout' : 'workouts'} · weekly plan
        </Text>

        {/* Weekly schedule */}
        <Text variant="heading" className="mb-2 mt-5">
          Weekly schedule
        </Text>
        <Card className="mb-1 rounded-[20px] p-2">
          {DOW.map((dayName, day) => {
            const dayWorkouts = workoutsForDay(day);
            const isToday = day === todayDow;
            const isRest = dayWorkouts.length === 0;
            const primary = dayWorkouts[0];
            const isDone = isToday && dayWorkouts.some((w) => doneToday.has(w.id));
            return (
              <Pressable
                key={dayName}
                disabled={!primary}
                onPress={() => primary && router.push(`/workout/${primary.id}`)}
                className={`flex-row items-center rounded-2xl px-3 py-3 ${
                  isToday ? 'bg-brand/10' : ''
                } ${primary ? 'active:opacity-70' : ''}`}>
                <View className="w-32">
                  <Text
                    variant="subheading"
                    numberOfLines={1}
                    className={isToday ? 'text-brand' : undefined}>
                    {dayName}
                  </Text>
                  {isToday ? (
                    <Text variant="caption" className="text-brand">
                      Today
                    </Text>
                  ) : null}
                </View>
                <Text
                  variant="body"
                  numberOfLines={1}
                  className={`flex-1 ${isRest ? 'text-iron-500' : 'text-iron-100'}`}>
                  {isRest
                    ? 'Rest'
                    : dayWorkouts.map((w) => w.name).join(', ')}
                </Text>
                {isDone ? (
                  <View className="mr-2 flex-row items-center rounded-full bg-brand/15 px-2 py-1">
                    <Ionicons name="checkmark-circle" size={13} color="#f97316" />
                    <Text variant="caption" className="ml-1 font-bold text-brand">
                      Done
                    </Text>
                  </View>
                ) : null}
                {primary ? (
                  <Ionicons name="chevron-forward" size={16} color="#57534e" />
                ) : (
                  <Ionicons name="bed-outline" size={15} color="#57534e" />
                )}
              </Pressable>
            );
          })}
        </Card>

        {/* Floating workouts (not pinned to a weekday) */}
        {floating.length > 0 ? (
          <>
            <Text variant="heading" className="mb-2 mt-6">
              Anytime
            </Text>
            <Card className="mb-1 rounded-[20px] p-2">
              {floating.map((w) => (
                <Pressable
                  key={w.id}
                  onPress={() => router.push(`/workout/${w.id}`)}
                  className="flex-row items-center rounded-2xl px-3 py-3 active:opacity-70">
                  <Text variant="body" numberOfLines={1} className="flex-1 text-iron-100">
                    {w.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#57534e" />
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

        {/* Progression rules */}
        {split.rules.length > 0 ? (
          <>
            <Text variant="heading" className="mb-2 mt-6">
              Progression rules
            </Text>
            <Card className="mb-1 rounded-[20px] p-4">
              {split.rules.map((rule, i) => (
                <View key={i} className="mb-2.5 flex-row last:mb-0">
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color="#f97316"
                    style={{ marginTop: 2 }}
                  />
                  <Text variant="body" className="ml-2 flex-1 text-iron-200">
                    {rule}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {/* Workout cards */}
        <Text variant="heading" className="mb-2 mt-6">
          Workouts
        </Text>
        {ordered.map((w) => (
          <Card key={w.id} className="mb-3 rounded-[20px] p-4" onPress={() => router.push(`/workout/${w.id}`)}>
            <View className="flex-row items-center">
              <View className="flex-1">
                <Text variant="subheading" numberOfLines={1}>
                  {w.name}
                </Text>
                <Text variant="caption" className="mt-0.5 text-iron-400">
                  {w.exercises.length} exercises
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  const s = await start({ workout_id: w.id, name: w.name });
                  router.push(`/session/active/${s.id}`);
                }}
                className="mr-2 flex-row items-center rounded-lg bg-brand px-3 py-2 active:bg-brand-600">
                <Ionicons name="play" size={13} color="#080706" />
                <Text variant="caption" className="ml-1 font-bold text-iron-950">
                  Start
                </Text>
              </Pressable>
              <Ionicons name="chevron-forward" size={18} color="#57534e" />
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
