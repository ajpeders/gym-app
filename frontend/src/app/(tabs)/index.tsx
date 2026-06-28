import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Routine, RoutineExercise, StatsSummary, Workout } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
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

// A workout counts as completed once it has a finish time (the backend exposes
// `finished_at`; older clients also looked at a `status` field).
function isCompleted(w: Workout): boolean {
  return w.finished_at != null || w.status === 'completed';
}

// Routine ids come back numeric from the API but are typed as strings; compare
// loosely against a workout's source_routine_id (numeric).
function sameRoutine(routineId: string, sourceId?: number | null): boolean {
  return sourceId != null && String(sourceId) === String(routineId);
}

function ExercisePanel({ ex, units }: { ex: RoutineExercise; units: string }) {
  const name = ex.exercise?.name ?? 'Exercise';
  const sets = ex.target_sets ?? '—';
  const reps = ex.target_reps ?? '—';
  const note = ex.notes?.trim();
  const detail =
    ex.target_weight != null
      ? `${ex.target_weight}${units}`
      : note && note.length > 0
        ? note
        : '—';
  return (
    <View className="flex-row items-center rounded-lg border border-iron-700 bg-iron-900 px-3 py-2.5">
      <View className="flex-1 pr-3">
        <Text variant="subheading" numberOfLines={1}>
          {name}
        </Text>
        {ex.rest_seconds != null ? (
          <Text variant="caption" className="mt-0.5">
            rest {ex.rest_seconds}s
          </Text>
        ) : null}
      </View>
      <View className="items-end">
        <Text variant="label" className="text-brand">
          {sets} × {reps}
        </Text>
        <Text variant="caption" className="mt-0.5" numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </View>
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
  const { settings } = useSettings();

  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [todays, setTodays] = useState<Workout | null>(null);
  const [workoutDays, setWorkoutDays] = useState<Set<string>>(new Set());
  const [routines, setRoutines] = useState<Routine[]>([]);
  // The routine most recently started from (derived from recent workouts).
  const [lastUsedId, setLastUsedId] = useState<string | null>(null);
  // The user's manual pick for this session (overrides last-used until refresh).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [s, w, r] = await Promise.all([
        api.statsSummary().catch(() => null),
        api.workouts({ limit: 12 }).catch(() => ({ items: [] as Workout[], total: 0 })),
        api.routines().catch(() => [] as Routine[]),
      ]);
      if (s) setStats(s);
      setRoutines(r);

      const completed = w.items.filter(isCompleted);
      setTodays(completed.find((it) => isToday(it.started_at)) ?? null);
      setWorkoutDays(new Set(completed.map((it) => dateKey(new Date(it.started_at)))));

      // Last-used routine: most recent workout (any status) started from a
      // routine that still exists.
      const recent = [...w.items].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
      const lastWorkout = recent.find(
        (it) => it.source_routine_id != null && r.some((rt) => sameRoutine(rt.id, it.source_routine_id)),
      );
      const derived =
        (lastWorkout
          ? r.find((rt) => sameRoutine(rt.id, lastWorkout.source_routine_id))?.id
          : undefined) ?? r[0]?.id ?? null;
      setLastUsedId(derived);
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

  async function onStartRoutine(routine: Routine) {
    setStarting(true);
    try {
      const w = await start({ routine_id: String(routine.id) });
      router.push(`/workout/active/${w.id}`);
    } finally {
      setStarting(false);
    }
  }

  // Resolve the currently selected routine: manual pick → last used → first.
  const selectedId = pickedId ?? lastUsedId;
  const selectedRoutine =
    routines.find((r) => String(r.id) === String(selectedId)) ?? routines[0] ?? null;
  const selectedExercises = selectedRoutine
    ? [...selectedRoutine.exercises].sort((a, b) => a.order - b.order)
    : [];

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
        <View className="mb-2 mt-6 flex-row items-center">
          <Text variant="label">TODAY</Text>
          {todays ? (
            <View className="ml-2 flex-row items-center rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5">
              <Ionicons name="checkmark-circle" size={12} color="#f97316" />
              <Text variant="caption" className="ml-1 text-brand">
                Logged today
              </Text>
            </View>
          ) : null}
        </View>

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
        ) : routines.length === 0 ? (
          <Card>
            <Text variant="subheading">No routine yet</Text>
            <Text variant="muted" className="mt-1">
              Import one from your notes or browse the starter routines.
            </Text>
            <View className="mt-3 flex-row gap-3">
              <Button
                title="Import from notes"
                className="flex-1"
                onPress={() => router.push('/routine-import')}
              />
              <Button
                title="Browse routines"
                variant="secondary"
                className="flex-1"
                onPress={() => router.push('/routines')}
              />
            </View>
          </Card>
        ) : selectedRoutine ? (
          <Card>
            {/* Routine selector */}
            {routines.length > 1 ? (
              <Pressable
                onPress={() => setPickerOpen((v) => !v)}
                accessibilityRole="button"
                className="flex-row items-center active:opacity-70">
                <View className="flex-1">
                  <Text variant="heading" numberOfLines={1}>
                    {selectedRoutine.name}
                  </Text>
                  <Text variant="caption" className="mt-0.5">
                    {selectedExercises.length} exercises
                  </Text>
                </View>
                <Ionicons
                  name={pickerOpen ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color="#f97316"
                />
              </Pressable>
            ) : (
              <View>
                <Text variant="heading" numberOfLines={1}>
                  {selectedRoutine.name}
                </Text>
                <Text variant="caption" className="mt-0.5">
                  {selectedExercises.length} exercises
                </Text>
              </View>
            )}

            {/* Inline routine picker */}
            {pickerOpen && routines.length > 1 ? (
              <View className="mt-3 overflow-hidden rounded-lg border border-iron-700">
                {routines.map((r) => {
                  const isSel = String(r.id) === String(selectedRoutine.id);
                  const isLast = String(r.id) === String(lastUsedId);
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => {
                        setPickedId(String(r.id));
                        setPickerOpen(false);
                      }}
                      accessibilityRole="button"
                      className={`flex-row items-center border-b border-iron-800 px-3 py-3 active:opacity-70 ${
                        isSel ? 'bg-iron-800' : 'bg-iron-900'
                      }`}>
                      <Text
                        variant="subheading"
                        className={`flex-1 ${isSel ? 'text-brand' : ''}`}
                        numberOfLines={1}>
                        {r.name}
                      </Text>
                      {isLast ? (
                        <View className="mr-2 rounded-full bg-iron-700 px-2 py-0.5">
                          <Text variant="caption">last used</Text>
                        </View>
                      ) : null}
                      {isSel ? (
                        <Ionicons name="checkmark" size={18} color="#f97316" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* Exercise panels */}
            <View className="mt-3 gap-2">
              {selectedExercises.length > 0 ? (
                selectedExercises.map((ex, i) => (
                  <ExercisePanel key={ex.id ?? i} ex={ex} units={settings.units} />
                ))
              ) : (
                <Text variant="muted">This routine has no exercises yet.</Text>
              )}
            </View>

            {/* Start */}
            <Button
              title={`Start ${selectedRoutine.name}`}
              size="lg"
              className="mt-4"
              loading={starting}
              onPress={() => onStartRoutine(selectedRoutine)}
            />
            <Pressable
              onPress={onStart}
              disabled={starting}
              accessibilityRole="button"
              className="mt-2 items-center active:opacity-70">
              <Text variant="caption" className="text-iron-400">
                or start a blank workout
              </Text>
            </Pressable>
          </Card>
        ) : null}

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
