import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { CatchupDay } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { titleCase } from '@/lib/format';

const WINDOW_DAYS = 14;

/** Parse YYYY-MM-DD as a *local* date. `new Date('2026-08-01')` would parse it
 * as UTC midnight and render as the previous day west of UTC. */
function localDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function dayLabel(dateStr: string, index: number): string {
  if (index === 0) return 'Today';
  if (index === 1) return 'Yesterday';
  return localDate(dateStr).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** A day that had something scheduled but nothing logged is the backlog. */
function isOutstanding(day: CatchupDay): boolean {
  return day.scheduled.length > 0 && !day.logged;
}

function DayRow({
  day,
  index,
  onLog,
  onOpen,
}: {
  day: CatchupDay;
  index: number;
  onLog: (day: CatchupDay) => void;
  onOpen: (sessionId: string) => void;
}) {
  const outstanding = isOutstanding(day);

  return (
    <View
      className={`mb-2 rounded-xl border px-3.5 py-3 ${
        outstanding ? 'border-amber-500/40 bg-amber-500/5' : 'border-iron-800 bg-iron-900/50'
      }`}>
      <View className="flex-row items-center">
        <View className="flex-1">
          <Text variant="label" className={outstanding ? 'text-amber-300' : 'text-iron-200'}>
            {dayLabel(day.date, index)}
          </Text>
          <Text variant="caption" className="mt-0.5 text-iron-400">
            {day.scheduled.length > 0
              ? day.scheduled.map((w) => titleCase(w.name)).join(' · ')
              : 'Rest day'}
          </Text>
        </View>

        {day.logged ? (
          <View className="flex-row items-center">
            <Ionicons name="checkmark-circle" size={18} color="#2dd4bf" />
            <Text variant="caption" className="ml-1.5 text-mint">
              {day.sessions.length === 1 ? 'Logged' : `${day.sessions.length} logged`}
            </Text>
          </View>
        ) : outstanding ? (
          <Pressable
            onPress={() => onLog(day)}
            className="rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 active:opacity-70">
            <Text variant="caption" className="font-bold text-amber-300">
              Log it
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => onLog(day)} hitSlop={8} className="px-2 py-1">
            <Text variant="caption" className="text-iron-500">
              Add
            </Text>
          </Pressable>
        )}
      </View>

      {/* Logged bouts are tappable so a day can be checked or corrected. */}
      {day.sessions.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => onOpen(String(s.id))}
          className="mt-2 flex-row items-center rounded-lg bg-iron-950/60 px-3 py-2 active:opacity-70">
          <Text variant="caption" numberOfLines={1} className="flex-1 text-iron-200">
            {titleCase(s.name ?? 'Session')}
          </Text>
          <Text variant="caption" className="text-iron-500">
            {s.exercise_count} {s.exercise_count === 1 ? 'exercise' : 'exercises'}
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#475569" />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The backlog view: the last two weeks, day by day, with what the split
 * scheduled against what was actually logged.
 *
 * `/splits/today` answers "what now" and only reaches back to the start of the
 * week; catching up needs to see further and to distinguish a rest day from a
 * day that was simply never logged.
 */
export default function CatchUpScreen() {
  const router = useRouter();
  const [days, setDays] = useState<CatchupDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDays(await api.splitCatchup(WINDOW_DAYS));
      setError(null);
    } catch {
      setError("Couldn't load your recent days.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function logDay(day: CatchupDay) {
    // Hand the log screen the date and, when the plan named one day, which
    // plan day it makes up — that link is what retires the "missed" flag.
    const workout = day.scheduled.length === 1 ? day.scheduled[0] : null;
    const params = new URLSearchParams({ date: day.date });
    if (workout) {
      params.set('workoutId', String(workout.id));
      params.set('workoutName', workout.name);
    }
    router.push(`/session/log?${params.toString()}`);
  }

  const outstanding = days.filter(isOutstanding).length;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen options={{ headerShown: true, title: 'Catch up' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-10">
        <Text variant="muted" className="mb-3">
          The last {WINDOW_DAYS} days against your split. Fill in anything you trained but
          never logged.
        </Text>

        <Button
          title="Paste several days"
          variant="secondary"
          icon="sparkles"
          onPress={() => router.push('/catch-up-paste')}
          className="mb-4"
        />

        {loading ? (
          <Card>
            <Text variant="muted">Loading…</Text>
          </Card>
        ) : error ? (
          <Card>
            <Text className="text-red-400">{error}</Text>
          </Card>
        ) : (
          <>
            <View className="mb-3 flex-row items-center">
              <Ionicons
                name={outstanding ? 'alert-circle' : 'checkmark-circle'}
                size={16}
                color={outstanding ? '#fbbf24' : '#2dd4bf'}
              />
              <Text
                variant="caption"
                className={`ml-1.5 ${outstanding ? 'text-amber-300' : 'text-mint'}`}>
                {outstanding
                  ? `${outstanding} scheduled ${outstanding === 1 ? 'day' : 'days'} not logged`
                  : 'Nothing outstanding'}
              </Text>
            </View>
            {days.map((d, i) => (
              <DayRow
                key={d.date}
                day={d}
                index={i}
                onLog={logDay}
                onOpen={(id) => router.push(`/session/${id}`)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
