import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { ProgressPhoto, Split, Workout } from '@/api/types';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, EmptyState } from '@/components/ui/Feedback';
import { WeekCalendar, type WeekCalendarItem } from '@/components/ui/WeekCalendar';
import { useStartSession } from '@/hooks/use-start-session';

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekDates() {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());
  sunday.setHours(12, 0, 0, 0);
  return WEEK_DAYS.map((day, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return { day, date, weekday: index };
  });
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function WorkoutDayCard({
  workout,
  meta,
  onOpen,
  onStart,
  starting,
}: {
  workout: Workout;
  meta?: string;
  onOpen: () => void;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <View className="mb-2 rounded-2xl border border-iron-800 bg-iron-900/80 p-3.5">
      <Pressable onPress={onOpen} accessibilityRole="button" className="active:opacity-80">
        <View className="flex-row items-center">
          <View className="mr-3 h-11 w-11 items-center justify-center rounded-2xl border border-brand/25 bg-brand/10">
            <Ionicons name="barbell-outline" size={19} color="#5eead4" />
          </View>
          <View className="min-w-0 flex-1">
            <Text variant="subheading" numberOfLines={1}>
              {workout.name}
            </Text>
            <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
              {workout.exercises.length} exercises{meta ? ` · ${meta}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color="#64748b" />
        </View>
      </Pressable>
      <View className="mt-3 flex-row gap-2">
        <Button
          title="Start"
          size="sm"
          icon="play"
          className="flex-1"
          loading={starting}
          onPress={onStart}
        />
        <Button
          title="Edit"
          size="sm"
          variant="secondary"
          icon="create-outline"
          className="flex-1"
          onPress={onOpen}
        />
      </View>
    </View>
  );
}

export default function WorkoutsScreen() {
  const router = useRouter();
  const { startSession, starting } = useStartSession();
  const [splits, setSplits] = useState<Split[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [progressPhotos, setProgressPhotos] = useState<ProgressPhoto[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [s, r, photos] = await Promise.all([
        api.splits().catch(() => [] as Split[]),
        api.workouts().catch(() => [] as Workout[]),
        api.progressPhotos().catch(() => [] as ProgressPhoto[]),
      ]);
      setSplits(s);
      setWorkouts(r);
      setProgressPhotos(photos);
      setSelectedPlanId((current) => current ?? s.find((split) => split.is_active)?.id ?? s[0]?.id ?? null);
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

  // Workouts not part of any split — standalone days.
  const standalone = workouts.filter((r) => r.split_id == null);
  const activePlan =
    splits.find((split) => split.id === selectedPlanId) ??
    splits.find((split) => split.is_active) ??
    splits[0];
  const dates = weekDates();
  const today = new Date();

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-4 pb-28"
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
          eyebrow="Plan builder"
          title="Splits"
          subtitle="Pick a program, start a day, or edit your weekly calendar."
        />

        <View className="mb-5 flex-row gap-2">
          <Button
            title="Import"
            variant="secondary"
            icon="document-text-outline"
            className="flex-1"
            onPress={() => router.push('/workout-import')}
          />
          <Button
            title="New day"
            icon="add"
            className="flex-1"
            onPress={() => router.push('/workout/new')}
          />
        </View>

        {loading ? (
          <Loading />
        ) : splits.length === 0 && standalone.length === 0 ? (
          <EmptyState
            icon="PLAN"
            title="No splits yet"
            subtitle="Import a program or create your first workout day above."
          />
        ) : (
          <>
            {activePlan ? (
              <View className="mb-6">
                <SectionHeader
                  title="This week"
                  subtitle="Choose a split, then tap a day for workouts or progress photos."
                />
                <Card className="rounded-lg p-3">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Choose training split"
                    onPress={() => setShowPlanPicker((open) => !open)}
                    className="mb-3 flex-row items-center rounded-lg border border-iron-800 bg-iron-900 px-3 py-3 active:bg-iron-850">
                    <View className="flex-1">
                      <Text variant="caption" className="font-bold uppercase tracking-wider text-iron-400">
                        Viewing split
                      </Text>
                      <Text variant="subheading" className="mt-0.5" numberOfLines={1}>
                        {activePlan.name}
                      </Text>
                    </View>
                    <Text variant="caption" className="mr-1 font-bold text-brand">
                      Change
                    </Text>
                    <Ionicons
                      name={showPlanPicker ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color="#5eead4"
                    />
                  </Pressable>

                  {showPlanPicker ? (
                    <View className="mb-3 gap-2 rounded-lg bg-iron-950 p-2">
                      {splits.map((split) => {
                        const selected = split.id === activePlan.id;
                        return (
                          <Pressable
                            key={split.id}
                            onPress={() => {
                              setSelectedPlanId(split.id);
                              setShowPlanPicker(false);
                            }}
                            className={`flex-row items-center rounded-lg px-3 py-3 ${
                              selected ? 'bg-brand/15' : 'active:bg-iron-850'
                            }`}>
                            <View className="flex-1">
                              <Text
                                variant="body"
                                className={selected ? 'font-bold text-brand' : 'font-bold text-iron-100'}>
                                {split.name}
                              </Text>
                              <Text variant="caption" className="mt-0.5 text-iron-400">
                                {split.workouts.length} workouts
                              </Text>
                            </View>
                            {selected ? (
                              <Ionicons name="checkmark-circle" size={19} color="#5eead4" />
                            ) : (
                              <Ionicons name="chevron-forward" size={16} color="#475569" />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  <WeekCalendar
                    monthLabel={dates[0].date.toLocaleDateString(undefined, {
                      month: 'long',
                      year: 'numeric',
                    })}
                    items={dates.map(({ day, date, weekday }) => {
                      const dayWorkouts = activePlan.workouts.filter(
                        (workout) => !workout.floating && workout.weekdays.includes(weekday),
                      );
                      const primary = dayWorkouts[0];
                      const isRest = dayWorkouts.length === 0;
                      const isToday =
                        date.getDate() === today.getDate() &&
                        date.getMonth() === today.getMonth() &&
                        date.getFullYear() === today.getFullYear();
                      const isPastOrToday = date.getTime() <= today.getTime();
                      const key = dateKey(date);
                      const hasPhoto = progressPhotos.some((photo) => photo.taken_at.slice(0, 10) === key);

                      return {
                        key: day,
                        label: day.slice(0, 1),
                        value: String(date.getDate()),
                        isToday,
                        isRest,
                        hasPhoto,
                        disabled: !isPastOrToday && !primary,
                        accessibilityLabel: `${day}, ${isRest ? 'Rest' : dayWorkouts.map((w) => w.name).join(', ')}${
                          hasPhoto ? ', has progress photos' : ''
                        }`,
                        onPress:
                          isPastOrToday || primary
                            ? () => {
                            if (isPastOrToday) {
                              router.push({ pathname: '/progress', params: { date: key } });
                            } else if (primary) {
                              router.push(`/workout/${primary.id}`);
                            }
                          }
                            : undefined,
                      } satisfies WeekCalendarItem;
                    })}
                  />

                  <View className="mt-3 border-t border-iron-800 pt-3">
                    {activePlan.workouts
                      .filter((workout) => !workout.floating)
                      .sort((a, b) => a.order - b.order)
                      .map((workout) => (
                        <WorkoutDayCard
                          key={workout.id}
                          meta={workout.weekdays.map((day) => WEEK_DAYS[day]?.slice(0, 3)).join('/')}
                          workout={workout}
                          starting={starting}
                          onOpen={() => router.push(`/workout/${workout.id}`)}
                          onStart={() => void startSession({ workout_id: String(workout.id) })}
                        />
                      ))}
                  </View>
                </Card>
              </View>
            ) : null}

            <SectionHeader title="All splits" subtitle="Open a split to edit its weekly schedule." />
            {splits.map((s) => {
              const trainingDays = s.workouts.length;
              return (
                <Card
                  key={s.id}
                  onPress={() => router.push(`/split/${s.id}`)}
                  className="mb-3 rounded-lg p-5">
                  <View className="flex-row items-center">
                    <View className="mr-3 h-12 w-12 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
                      <Ionicons name="calendar" size={22} color="#5eead4" />
                    </View>
                    <View className="flex-1">
                      <Text variant="subheading" numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text variant="caption" className="mt-0.5 text-iron-400">
                        {trainingDays} training days · weekly split
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#475569" />
                  </View>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {s.is_active ? (
                      <View className="rounded-full border border-brand/40 bg-brand/15 px-2.5 py-1">
                        <Text variant="caption" className="font-bold text-brand">
                          Active
                        </Text>
                      </View>
                    ) : null}
                    {s.rules.length > 0 ? (
                      <View className="rounded-full border border-iron-700 bg-iron-850 px-2.5 py-1">
                        <Text variant="caption" className="font-bold text-iron-300">
                          {s.rules.length} rules
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Card>
              );
            })}

            {standalone.length > 0 ? (
              <>
                <SectionHeader
                  title="Other workout days"
                  subtitle="Workouts that are not assigned to a split."
                />
                <View className="gap-2">
                  {standalone.map((r) => (
                    <Card
                      key={r.id}
                      onPress={() => router.push(`/workout/${r.id}`)}
                      className="rounded-lg p-4">
                      <View className="flex-row items-center">
                        <View className="flex-1">
                          <Text variant="subheading" numberOfLines={1}>
                            {r.name}
                          </Text>
                          <Text variant="caption" className="mt-0.5 text-iron-400">
                            {r.exercises.length} exercises
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#475569" />
                      </View>
                    </Card>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
