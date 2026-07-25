import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Routine, Split } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Loading, ErrorState } from '@/components/ui/Feedback';

const REST_RE = /rest|walk|off/i;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Find the day-routine that fulfils a schedule entry (by day label match). */
function routineForDay(split: Split, day: string, label?: string | null): Routine | undefined {
  return split.routines.find(
    (r) =>
      (r.day_label && r.day_label.toLowerCase() === day.toLowerCase()) ||
      (label && r.name.toLowerCase().includes(label.toLowerCase())),
  );
}

export default function SplitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { start } = useActiveWorkout();
  const [split, setSplit] = useState<Split | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setSplit(await api.split(id));
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

  const todayName = DOW[new Date().getDay()];

  if (loading || error || !split) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Split' }} />
        {loading ? <Loading /> : <ErrorState message={error ?? 'Not found'} onRetry={fetch} />}
      </Screen>
    );
  }

  const orderedDays = [...split.routines].sort((a, b) => (a.day_order ?? 0) - (b.day_order ?? 0));

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: split.name }} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        <Text variant="title">{split.name}</Text>
        <Text variant="muted" className="mt-0.5">
          {orderedDays.length} training days · weekly plan
        </Text>

        {/* Weekly schedule */}
        <Text variant="heading" className="mb-2 mt-5">
          Weekly schedule
        </Text>
        <Card className="mb-1 rounded-[20px] p-2">
          {split.schedule.map((entry, i) => {
            const isRest = REST_RE.test(entry.label ?? '') || !entry.label;
            const routine = isRest ? undefined : routineForDay(split, entry.day, entry.label);
            const isToday = entry.day.toLowerCase().includes(todayName.toLowerCase());
            return (
              <Pressable
                key={`${entry.day}-${i}`}
                disabled={!routine}
                onPress={() => routine && router.push(`/routine/${routine.id}`)}
                className={`flex-row items-center rounded-2xl px-3 py-3 ${
                  isToday ? 'bg-brand/10' : ''
                } ${routine ? 'active:opacity-70' : ''}`}>
                <View className="w-32">
                  <Text
                    variant="subheading"
                    numberOfLines={1}
                    className={isToday ? 'text-brand' : undefined}>
                    {entry.day}
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
                  {entry.label ?? 'Rest'}
                </Text>
                {routine ? (
                  <Ionicons name="chevron-forward" size={16} color="#57534e" />
                ) : (
                  <Ionicons name="bed-outline" size={15} color="#57534e" />
                )}
              </Pressable>
            );
          })}
        </Card>

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

        {/* Day cards */}
        <Text variant="heading" className="mb-2 mt-6">
          Days
        </Text>
        {orderedDays.map((r) => (
          <Card key={r.id} className="mb-3 rounded-[20px] p-4" onPress={() => router.push(`/routine/${r.id}`)}>
            <View className="flex-row items-center">
              <View className="flex-1">
                <Text variant="subheading" numberOfLines={1}>
                  {r.name}
                </Text>
                <Text variant="caption" className="mt-0.5 text-iron-400">
                  {r.exercises.length} exercises
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  const w = await start({ routine_id: r.id, name: r.name });
                  router.push(`/workout/active/${w.id}`);
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
