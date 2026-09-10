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
import { HomeNutritionCard } from '@/components/HomeNutritionCard';
import { HomeProfileCard } from '@/components/HomeProfileCard';
import { StatsStrip } from '@/components/StatsStrip';
import { NextTargets } from '@/components/workout/NextTargets';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function QuickLink({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`min-h-[92px] flex-1 rounded-2xl border border-iron-800 bg-iron-900/75 p-3.5 active:bg-iron-850 ${
        disabled ? 'opacity-50' : ''
      }`}>
      <View className="flex-row items-start">
        <View className="h-9 w-9 items-center justify-center rounded-xl border border-brand/25 bg-brand/10">
          <Ionicons name={icon} size={18} color="#5eead4" />
        </View>
        <Ionicons
          name="arrow-up-outline"
          size={15}
          color="#94a3b8"
          style={{ marginLeft: 'auto', transform: [{ rotate: '45deg' }] }}
        />
      </View>
      <Text variant="subheading" className="mt-2.5" numberOfLines={1}>
        {title}
      </Text>
      <Text variant="caption" className="mt-1 text-iron-300" numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

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
            <Ionicons name="calendar-clear-outline" size={25} color="#94a3b8" />
          </View>
          <View className="min-w-0 flex-1">
            <Text variant="eyebrow">Choose your session</Text>
            <Text variant="heading" className="mt-1" numberOfLines={1}>
              What are you training?
            </Text>
            <Text variant="muted" className="mt-1 text-iron-300">
              Pick a saved day or build one exercise at a time.
            </Text>
          </View>
        </View>
        <Button title="Choose workout" icon="calendar-outline" className="mt-4" onPress={onOpen} />
      </Card>
    );
  }

  return (
    <Card elevated className="border-brand/30 bg-brand/10 p-4">
      <Pressable onPress={onOpen} accessibilityRole="button" className="active:opacity-80">
        <View className="flex-row items-center">
          <View className="mr-3 h-16 w-16 items-center justify-center rounded-3xl bg-brand">
            <Ionicons name={icon} size={29} color="#030712" />
          </View>
          <View className="min-w-0 flex-1">
            <Text variant="eyebrow">{label}</Text>
            <Text variant="heading" className="mt-1" numberOfLines={1}>
              {workout.name}
            </Text>
            <Text variant="muted" className="mt-1 text-iron-200">
              {workout.exercises.length} exercises · tap for details
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
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

function WorkoutOption({
  workout,
  meta,
  onPress,
}: {
  workout: Workout;
  meta?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-w-[210px] rounded-2xl border border-iron-800 bg-iron-900/85 p-3.5 active:bg-iron-850">
      <View className="mb-3 flex-row items-center justify-between">
        <View className="h-9 w-9 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10">
          <Ionicons name="barbell-outline" size={17} color="#5eead4" />
        </View>
        {meta ? (
          <Text variant="caption" className="ml-2 max-w-[120px] text-right text-iron-400" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Text variant="subheading" numberOfLines={1}>
        {workout.name}
      </Text>
      <Text variant="caption" className="mt-1 text-iron-400">
        {workout.exercises.length} exercises
      </Text>
    </Pressable>
  );
}

function workoutById(workouts: Workout[], id: string | number | undefined | null): Workout | null {
  if (id == null) return null;
  return workouts.find((workout) => String(workout.id) === String(id)) ?? null;
}

function splitNameForWorkout(splits: Split[], workout: Workout): string | null {
  if (workout.split_id == null) return null;
  return splits.find((split) => Number(split.id) === Number(workout.split_id))?.name ?? null;
}

function scheduleText(workout: Workout): string {
  if (workout.floating) return 'Any day';
  if (workout.weekdays.length === 0) return 'Unscheduled';
  return workout.weekdays.map((day) => DOW[day]?.slice(0, 3) ?? '?').join(' / ');
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

  const fetchData = useCallback(async () => {
    try {
      const [splitList, workoutList, todayList, summary] = await Promise.all([
        api.splits().catch(() => [] as Split[]),
        api.workouts().catch(() => [] as Workout[]),
        api.splitToday().catch(() => [] as TodayWorkout[]),
        api.statsSummary().catch(() => null),
      ]);
      setSplits(splitList);
      setWorkouts(workoutList);
      setToday(todayList);
      setStats(summary);
      const due = todayList.find((w) => w.up_next || w.scheduled_today);
      setNextTargets(due ? await api.workoutSuggestions(String(due.id)).catch(() => []) : []);
      // Keep the plan on the device: starting a workout offline builds the
      // session from this cache, and Home is the screen you check before you
      // leave for the gym.
      void cachePlans([...workoutList, ...splitList.flatMap((s) => s.workouts)]);
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
    await startSession({ workout_id: String(workout.id) });
  }

  async function startBlankSession() {
    if (active && active.finished_at == null) {
      router.push('/session/add-exercise');
      return;
    }

    setBlankStarting(true);
    try {
      const session = await start({ name: 'Quick session' });
      router.push(`/session/active/${session.id}`);
      setTimeout(() => router.push('/session/add-exercise'), 0);
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
  const primaryToday = workoutById(workouts, dueToday[0]?.id);
  const shownWorkouts = workouts
    .filter((workout) => String(workout.id) !== String(primaryToday?.id))
    .slice(0, 5);
  const firstName = user?.display_name.trim().split(/\s+/)[0] || 'there';

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
        <ScreenHeader
          eyebrow={dateLabel}
          title={`Hi, ${firstName}`}
          subtitle="Choose what you want to train and get moving."
          action={
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-full border border-iron-700 bg-iron-900 active:bg-iron-800">
              <Ionicons name="settings-outline" size={19} color="#94a3b8" />
            </Pressable>
          }
        />

        {stats ? <StatsStrip stats={stats} className="mb-4" /> : null}

        <SectionHeader
          title={ongoing ? 'Keep going' : primaryToday ? 'Up next' : 'Start'}
          subtitle={ongoing ? 'Your current session is ready.' : undefined}
          className="mt-0"
        />

        {ongoing ? (
          <Card elevated className="mb-4 border-brand/35 bg-iron-900 p-4">
            <View className="flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand">
                <Ionicons name="barbell" size={23} color="#030712" />
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

        {!ongoing ? (
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
            starting={starting}
            onOpen={() =>
              primaryToday
                ? router.push(`/workout/${primaryToday.id}`)
                : activeSplit
                  ? router.push(`/split/${activeSplit.id}`)
                  : router.push('/workout-import')
            }
            onStart={primaryToday ? () => void onStartWorkout(primaryToday) : undefined}
          />
        ) : null}
        {!ongoing && primaryToday && nextTargets.some((s) => s.action !== 'start') ? (
          <NextTargets workoutName={primaryToday.name} suggestions={nextTargets} className="mt-3" />
        ) : null}

        <SectionHeader title="Quick start" subtitle="No setup. Pick a path." />
        <View className="flex-row gap-3">
          <QuickLink
            icon="add-circle-outline"
            title="Empty session"
            subtitle="Add exercises as you go."
            disabled={blankStarting}
            onPress={() => void startBlankSession()}
          />
          <QuickLink
            icon="chatbubble-ellipses-outline"
            title="Log by text"
            subtitle="Describe the workout."
            onPress={() => router.push('/log-chat')}
          />
        </View>

        <View className="mt-3 flex-row gap-3">
          <QuickLink
            icon="fitness-outline"
            title="Exercise library"
            subtitle="Browse and start one."
            onPress={() => router.push('/exercises')}
          />
          <QuickLink
            icon="calendar-outline"
            title="Catch up"
            subtitle="Fill in a missed day."
            onPress={() => router.push('/catch-up')}
          />
        </View>

        <SectionHeader
          title="Your plan"
          action={
            <Pressable onPress={() => router.push('/workouts')} hitSlop={8}>
              <Text variant="label" className="text-brand">
                All splits
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
                color="#5eead4"
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
            <Ionicons name="chevron-forward" size={18} color="#64748b" />
          </View>
        </Card>

        {shownWorkouts.length > 0 ? (
          <>
            <SectionHeader title="Quick pick" subtitle="Saved workout days without opening the planner." />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="-mx-4"
              contentContainerClassName="gap-3 px-4">
              {shownWorkouts.map((workout) => {
                const splitName = splitNameForWorkout(splits, workout);
                return (
                  <WorkoutOption
                    key={workout.id}
                    workout={workout}
                    meta={splitName ?? scheduleText(workout)}
                    onPress={() => router.push(`/workout/${workout.id}`)}
                  />
                );
              })}
              <Pressable
                onPress={() => router.push('/workouts')}
                accessibilityRole="button"
                className="min-w-[150px] items-center justify-center rounded-2xl border border-iron-800 bg-iron-900/70 p-3.5 active:bg-iron-850">
                <Ionicons name="grid-outline" size={22} color="#5eead4" />
                <Text variant="label" className="mt-2 text-brand">
                  View all
                </Text>
              </Pressable>
            </ScrollView>
          </>
        ) : null}

        <SectionHeader title="Track" subtitle="Your nutrition and athlete profile." />
        <HomeProfileCard />
        <HomeNutritionCard />
      </ScrollView>
    </Screen>
  );
}
