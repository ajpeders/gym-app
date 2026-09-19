import { useCallback, useState } from 'react';
import type { ComponentProps } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { cachePlans } from '@/lib/offline';
import type { OverloadSuggestion, Split, StatsSummary, TodayWorkout, Workout } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useActiveWorkout } from '@/state/active-workout';
import { useStartSession } from '@/hooks/use-start-session';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, FormError } from '@/components/ui/Feedback';
import { StatsStrip } from '@/components/StatsStrip';
import { NextTargets } from '@/components/workout/NextTargets';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function PrimaryWorkoutCard({
  workout,
  label,
  icon,
  starting,
  onOpen,
  onStart,
}: {
  workout: Workout | null;
  label: string;
  icon: IoniconName;
  starting: boolean;
  onOpen: () => void;
  onStart?: () => void;
}) {
  if (!workout) {
    return (
      <Card elevated className="p-4">
        <View className="flex-row items-center">
          <View className="mr-3 h-14 w-14 items-center justify-center rounded-3xl border border-iron-700 bg-iron-850">
            <Ionicons name="calendar-clear-outline" size={25} color="#b0b6a8" />
          </View>
          <View className="min-w-0 flex-1">
            <Text variant="eyebrow">Your day</Text>
            <Text variant="title" className="mt-2">
              Room to train.
            </Text>
            <Text variant="muted" className="mt-1 text-iron-300">
              Choose a workout, or start an empty session below.
            </Text>
          </View>
        </View>
        <Button title="Choose workout" icon="calendar-outline" className="mt-4" onPress={onOpen} />
      </Card>
    );
  }

  return (
    <Card elevated className="border-brand/20 bg-iron-900 p-5">
      <Pressable onPress={onOpen} accessibilityRole="button" className="active:opacity-80">
        <View className="flex-row items-center">
          <View className="mr-3 h-16 w-16 items-center justify-center rounded-3xl bg-brand">
            <Ionicons name={icon} size={29} color="#121510" />
          </View>
          <View className="min-w-0 flex-1">
            <Text variant="eyebrow">{label}</Text>
            <Text variant="title" className="mt-2">
              {workout.name}
            </Text>
            <Text variant="muted" className="mt-1 text-iron-200">
              {workout.exercises.length} exercises
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#b0b6a8" />
        </View>
      </Pressable>
      {onStart ? (
        <Button
          title="Start now"
          icon="play"
          size="lg"
          className="mt-4"
          loading={starting}
          onPress={onStart}
        />
      ) : null}
    </Card>
  );
}

function workoutById(workouts: Workout[], id: string | number | undefined | null): Workout | null {
  if (id == null) return null;
  return workouts.find((workout) => String(workout.id) === String(id)) ?? null;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { workout: active, start } = useActiveWorkout();
  const { startSession, starting } = useStartSession();

  const [splits, setSplits] = useState<Split[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [today, setToday] = useState<TodayWorkout[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  // What the plan's rule says to aim for on the day that is due. This is the
  // one number from Insights that changes what you do at the gym, so it lives
  // here, next to Start, rather than eight sections deep on another screen.
  const [nextTargets, setNextTargets] = useState<OverloadSuggestion[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [blankStarting, setBlankStarting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [splitList, workoutList, todayList, summary] = await Promise.all([
        api.splits(),
        api.workouts(),
        api.splitToday(),
        api.statsSummary().catch(() => null),
      ]);
      setSplits(splitList);
      setWorkouts(workoutList);
      setToday(todayList);
      setStats(summary);
      setLoaded(true);
      const due = todayList.find((w) => w.up_next || w.scheduled_today);
      setNextTargets(due ? await api.workoutSuggestions(String(due.id)).catch(() => []) : []);
      // Keep the plan on the device: starting a workout offline builds the
      // session from this cache, and Home is the screen you check before you
      // leave for the gym.
      void cachePlans([...workoutList, ...splitList.flatMap((s) => s.workouts)]);
    } catch {
      setError('Couldn’t refresh your plan. Check your connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData]),
  );

  async function onStartWorkout(workout: Workout) {
    // Guarded: resumes instead of stacking a second session. See use-start-session.
    setStartError(null);
    try {
      await startSession({ workout_id: String(workout.id) });
    } catch {
      setStartError('Couldn’t start your workout. Please try again.');
    }
  }

  async function startBlankSession() {
    if (active && active.finished_at == null) {
      router.push('/session/add-exercise');
      return;
    }

    if (blankStarting || starting) return;
    setStartError(null);
    setBlankStarting(true);
    try {
      const session = await start({ name: 'Quick session' });
      router.push(`/session/active/${session.id}`);
      setTimeout(() => router.push('/session/add-exercise'), 0);
    } catch {
      setStartError('Couldn’t start your session. Please try again.');
    } finally {
      setBlankStarting(false);
    }
  }

  const now = new Date();
  const dateLabel = `${DOW[now.getDay()]}, ${MON[now.getMonth()]} ${now.getDate()}`;
  // A session the background sync re-read after it was finished can still be
  // sitting in state; "ongoing" means in progress, not merely present.
  const ongoing = active && active.finished_at == null ? active : null;
  const activeSplit = splits.find((split) => split.is_active) ?? splits[0] ?? null;
  const rolling = activeSplit?.mode === 'rolling';
  const scheduledToday = today.filter((entry) => entry.scheduled_today);
  const makeups = today.filter((entry) => entry.missed);
  // A rolling split has no weekday to match and nothing it can be late for —
  // what's due is wherever the rotation has got to.
  const dueToday = rolling
    ? today.filter((entry) => entry.up_next)
    : scheduledToday.length > 0
      ? scheduledToday
      : makeups;
  const dueLabel = rolling
    ? 'next in rotation'
    : scheduledToday.length > 0
      ? 'scheduled today'
      : 'makeup day';
  const primaryToday = workoutById([...workouts, ...splits.flatMap((split) => split.workouts)], dueToday[0]?.id);
  const firstName = user?.display_name.trim().split(/\s+/)[0] || 'there';
  // A new account has no plan yet — zero splits covers both "brand new"
  // (onboarded false) and "onboarded but never imported a plan". For them the
  // first thing to do is log a set, so the logging actions get primary tier.
  const isNewAccount = loaded && splits.length === 0;

  const logActions = !ongoing ? (
    <View className="mt-3 flex-row gap-2">
      <Button
        title="Empty session"
        icon="add"
        variant={isNewAccount ? 'primary' : 'ghost'}
        className="flex-1"
        loading={blankStarting}
        disabled={starting}
        onPress={() => void startBlankSession()}
      />
      <Button
        title="Log by text"
        icon="chatbubble-outline"
        variant={isNewAccount ? 'secondary' : 'ghost'}
        className="flex-1"
        onPress={() => router.push('/log-chat')}
      />
    </View>
  ) : null;

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-5 pb-10"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchData();
            }}
          />
        }>
        <ScreenHeader
          eyebrow={dateLabel}
          title={`Hi, ${firstName}`}
          action={
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-full border border-iron-700 bg-iron-900 active:bg-iron-800">
              <Ionicons name="settings-outline" size={19} color="#b0b6a8" />
            </Pressable>
          }
        />

        {error ? (
          <View className="mb-4">
            <FormError message={error} />
            <Button title="Retry" variant="ghost" loading={refreshing} onPress={() => { setRefreshing(true); void fetchData(); }} />
          </View>
        ) : null}
        {!loaded && !error && !ongoing ? <Loading label="Getting your day ready…" /> : null}

        {ongoing ? (
          <Card elevated className="mb-4 border-brand/35 bg-iron-900 p-4">
            <View className="flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand">
                <Ionicons name="barbell" size={23} color="#121510" />
              </View>
              <View className="flex-1">
                <View className="mb-1 self-start rounded-full bg-brand px-2 py-0.5">
                  <Text variant="caption" className="font-black text-iron-950">
                    ONGOING
                  </Text>
                </View>
                <Text variant="heading" className="mt-0.5" numberOfLines={1}>
                  {ongoing.name ?? 'Session'}
                </Text>
                <Text variant="caption" className="mt-0.5 text-iron-300">
                  {ongoing.exercises.length} exercises in progress
                </Text>
              </View>
            </View>
            <Button
              title="Continue session"
              size="lg"
              icon="play"
              className="mt-4"
              onPress={() => router.push(`/session/active/${ongoing.id}`)}
            />
          </Card>
        ) : null}

        {/* New account: logging is the first thing to do, so it leads the page. */}
        {isNewAccount ? logActions : null}

        {!ongoing && loaded ? (
          <PrimaryWorkoutCard
            workout={primaryToday}
            label={dueLabel}
            icon={
              rolling
                ? 'repeat-outline'
                : scheduledToday.length > 0
                  ? 'today-outline'
                  : 'refresh-outline'
            }
            starting={starting || blankStarting}
            onOpen={() =>
              primaryToday
                ? router.push(`/workout/${primaryToday.id}`)
                : router.push('/workouts')
            }
            onStart={primaryToday ? () => void onStartWorkout(primaryToday) : undefined}
          />
        ) : null}
        {!ongoing && primaryToday && nextTargets.some((s) => s.action !== 'start') ? (
          <NextTargets workoutName={primaryToday.name} suggestions={nextTargets} className="mt-3" />
        ) : null}

        {!ongoing && !isNewAccount ? logActions : null}
        {startError ? <FormError message={startError} /> : null}

        {stats ? (
          <View className="mt-7">
            <StatsStrip stats={stats} />
          </View>
        ) : null}

        {loaded ? (
          <>
            <SectionHeader
              title="Your plan"
              action={
                <Pressable accessibilityRole="button" onPress={() => router.push('/workouts')} hitSlop={8}>
                  <Text variant="label" className="text-brand">
                    View plan
                  </Text>
                </Pressable>
              }
            />
            <Card
              onPress={() =>
                activeSplit ? router.push(`/split/${activeSplit.id}`) : router.push('/workout-import')
              }
              className="p-4">
              <View className="flex-row items-center">
                <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-brand/10">
                  <Ionicons
                    name={activeSplit ? 'calendar-outline' : 'document-text-outline'}
                    size={20}
                    color="#b6d69a"
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <Text variant="subheading" numberOfLines={1}>
                    {activeSplit?.name ?? 'Import your first split'}
                  </Text>
                  <Text variant="caption" className="mt-0.5 text-iron-400">
                    {activeSplit
                      ? `${activeSplit.workouts.length} workout days · ${rolling ? 'rotation' : 'weekly schedule'}`
                      : 'Paste a plan and review it before saving.'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#929b89" />
              </View>
            </Card>

          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
