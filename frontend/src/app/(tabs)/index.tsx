import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, ApiError } from '@/api/client';
import type { Routine, RoutineExercise, RoutineInput, Split, Workout, WorkoutExercise } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { HomeProfileCard } from '@/components/HomeProfileCard';
import { formatRepRange } from '@/lib/format';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function ExerciseLine({
  ex,
  units,
  onPress,
}: {
  ex: RoutineExercise;
  units: string;
  onPress?: () => void;
}) {
  const name = ex.exercise?.name ?? 'Exercise';
  const sets =
    ex.target_sets != null
      ? `${ex.target_sets} set${ex.target_sets === 1 ? '' : 's'}`
      : 'Sets not set';
  const repRange = formatRepRange(ex.target_reps, ex.target_reps_max);
  const reps = repRange
    ? `${repRange} rep${repRange === '1' ? '' : 's'}`
    : 'Reps not set';
  const weight = ex.target_weight != null ? `${ex.target_weight}${units}` : null;
  const rest = ex.rest_seconds != null ? `${ex.rest_seconds}s rest` : null;
  const detail = [sets, reps, weight, rest].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      className="flex-row items-center border-b border-iron-800 py-3 active:opacity-70">
      <ExerciseThumb images={ex.exercise?.images} size={40} radius={6} />
      <View className="ml-3 flex-1">
        <Text variant="subheading" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color="#57534e" /> : null}
    </Pressable>
  );
}

function WorkoutExerciseLine({
  ex,
  units,
  onPress,
}: {
  ex: WorkoutExercise;
  units: string;
  onPress?: () => void;
}) {
  const name = ex.exercise?.name ?? 'Exercise';
  const completedSets = ex.sets.filter((set) => set.completed !== false);
  const detail =
    completedSets.length > 0
      ? completedSets
          .map((set, index) => {
            const weight = set.weight != null ? ` @ ${set.weight}${units}` : '';
            return `Set ${index + 1}: ${set.reps} rep${set.reps === 1 ? '' : 's'}${weight}`;
          })
          .join(' · ')
      : 'No sets logged yet';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      className="flex-row items-center border-b border-brand/20 py-3 active:opacity-70">
      <ExerciseThumb images={ex.exercise?.images} size={40} radius={6} />
      <View className="ml-3 flex-1">
        <Text variant="subheading" numberOfLines={1}>
          {name}
        </Text>
        <Text
          variant="caption"
          className={`mt-0.5 ${completedSets.length > 0 ? 'text-iron-300' : 'text-iron-500'}`}
          numberOfLines={2}>
          {detail}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color="#57534e" /> : null}
    </Pressable>
  );
}

function QuickLink({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-[104px] flex-1 rounded-[18px] border border-iron-800 bg-iron-900/85 p-4 active:opacity-75">
      <View className="flex-row items-start">
        <View className="h-10 w-10 items-center justify-center rounded-xl border border-brand/25 bg-brand/10">
          <Ionicons name={icon} size={18} color="#f97316" />
        </View>
        <Ionicons
          name="arrow-up-outline"
          size={15}
          color="#78716c"
          style={{ marginLeft: 'auto', transform: [{ rotate: '45deg' }] }}
        />
      </View>
      <Text variant="subheading" className="mt-3" numberOfLines={1}>
        {title}
      </Text>
      <Text variant="caption" className="mt-1 text-iron-300" numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

type MetricTone = 'brand' | 'mint' | 'steel';

const metricTone: Record<MetricTone, { box: string; text: string; icon: string }> = {
  brand: { box: 'border-brand/30 bg-brand/10', text: 'text-brand', icon: '#f97316' },
  mint: { box: 'border-mint/30 bg-mint/10', text: 'text-mint', icon: '#34d399' },
  steel: { box: 'border-steel/30 bg-steel/10', text: 'text-steel', icon: '#38bdf8' },
};

function MetricPill({
  icon,
  value,
  label,
  tone = 'brand',
}: {
  icon: IoniconName;
  value: string;
  label: string;
  tone?: MetricTone;
}) {
  const style = metricTone[tone];

  return (
    <View className={`flex-1 rounded-lg border px-3 py-2 ${style.box}`}>
      <View className="flex-row items-center">
        <Ionicons name={icon} size={15} color={style.icon} />
        <Text variant="label" className={`ml-1.5 ${style.text}`} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function findPreviousExercise(routine: Routine, exerciseId: string, fallbackName: string) {
  return routine.exercises.find((ex) => {
    if (String(ex.exercise_id) === String(exerciseId)) return true;
    return ex.exercise?.name?.toLowerCase() === fallbackName.toLowerCase();
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const { workout: active, start } = useActiveWorkout();
  const { settings } = useSettings();

  const [todays, setTodays] = useState<Workout | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  // The user's active weekly split, if any — drives today's day + the day picker.
  const [split, setSplit] = useState<Split | null>(null);
  // The routine most recently started from (derived from recent workouts).
  const [lastUsedId, setLastUsedId] = useState<string | null>(null);
  // The user's manual pick for this session (overrides last-used until refresh).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The coach's one-line summary of what the last AI edit changed.
  const [aiReply, setAiReply] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [w, r, splits] = await Promise.all([
        api.workouts({ limit: 12 }).catch(() => ({ items: [] as Workout[], total: 0 })),
        api.routines().catch(() => [] as Routine[]),
        api.splits().catch(() => [] as Split[]),
      ]);
      const activeSplit = splits.find((s) => s.is_active) ?? splits[0] ?? null;
      setSplit(activeSplit);
      // When a split is active its own day-routines are the plan pool; otherwise
      // fall back to all routines.
      setRoutines(activeSplit ? activeSplit.routines : r);

      const completed = w.items.filter(isCompleted);
      setTodays(completed.find((it) => isToday(it.started_at)) ?? null);

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

  async function onAiEdit(routine: Routine) {
    const request = aiPrompt.trim();
    if (!request || aiSaving) return;

    setAiSaving(true);
    setAiError(null);
    setAiReply(null);
    try {
      // Scoped single-routine edit: streams a proposal + a one-line summary of
      // what changed, and resolves each exercise via matcher v2.
      const proposal = await api.editRoutineStream({
        instruction: request,
        name: routine.name,
        notes: routine.notes,
        exercises: routine.exercises
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((e) => ({
            exercise: e.exercise?.name ?? 'Exercise',
            target_sets: e.target_sets,
            target_reps: e.target_reps,
            target_reps_max: e.target_reps_max ?? null,
            target_weight: e.target_weight,
            notes: e.notes ?? null,
          })),
      });

      const exercises = [];
      for (const ex of proposal.exercises) {
        const exerciseId =
          ex.exercise_id != null
            ? String(ex.exercise_id)
            : (await api.createExercise({ name: ex.exercise_name })).id;
        const previous = findPreviousExercise(routine, exerciseId, ex.exercise_name);
        exercises.push({
          exercise_id: exerciseId,
          order: exercises.length,
          target_sets: ex.target_sets,
          target_reps: ex.target_reps,
          target_reps_max: ex.target_reps_max,
          target_weight: ex.target_weight,
          rest_seconds: previous?.rest_seconds ?? null,
        });
      }

      if (exercises.length === 0) {
        throw new Error('AI could not match any exercises in the updated split.');
      }

      const input: RoutineInput = {
        name: proposal.name?.trim() || routine.name,
        notes: proposal.notes ?? routine.notes,
        exercises,
      };
      const updated = await api.updateRoutine(routine.id, input);
      setRoutines((prev) => prev.map((r) => (String(r.id) === String(updated.id) ? updated : r)));
      setPickedId(String(updated.id));
      setAiPrompt('');
      // Keep the sheet open and show what the coach did, rather than silently
      // closing — the user asked for a response after every AI edit.
      setAiReply(proposal.reply?.trim() || 'Updated your split.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 502) {
        setAiError('AI provider unavailable - check Settings.');
      } else {
        setAiError(err instanceof Error ? err.message : 'AI edit failed.');
      }
    } finally {
      setAiSaving(false);
    }
  }

  const now = new Date();
  const dayName = DOW[now.getDay()];
  const dateLabel = `${dayName}, ${MON[now.getMonth()]} ${now.getDate()}`;

  // Today's day-routine: prefer the active split's schedule (the entry whose
  // `day` names today → the routine with that day_label), then fall back to a
  // weekday-named routine.
  const todaysSchedule = split?.schedule.find((e) =>
    e.day.toLowerCase().includes(dayName.toLowerCase()),
  );
  const scheduledRestToday =
    !!todaysSchedule && /rest|walk|off/i.test(todaysSchedule.label ?? '');
  const dayRoutine =
    (todaysSchedule && !scheduledRestToday
      ? routines.find(
          (r) =>
            (r.day_label && r.day_label.toLowerCase() === todaysSchedule.day.toLowerCase()) ||
            (todaysSchedule.label &&
              r.name.toLowerCase().includes(todaysSchedule.label.toLowerCase())),
        )
      : null) ??
    routines.find((r) => r.name.toLowerCase().includes(dayName.toLowerCase())) ??
    null;

  // Resolve today's routine: manual pick → today's scheduled day → last used → first.
  const selectedId = pickedId ?? dayRoutine?.id ?? lastUsedId;
  const selectedRoutine =
    routines.find((r) => String(r.id) === String(selectedId)) ?? routines[0] ?? null;
  const selectedExercises = selectedRoutine
    ? [...selectedRoutine.exercises].sort((a, b) => a.order - b.order)
    : [];
  const restValues = selectedExercises
    .map((ex) => ex.rest_seconds)
    .filter((rest): rest is number => rest != null);
  const avgRest =
    restValues.length > 0
      ? `${Math.round(restValues.reduce((total, rest) => total + rest, 0) / restValues.length)}s`
      : 'Open';
  const previewExercises = selectedExercises.slice(0, 8);
  const hiddenExercises = Math.max(0, selectedExercises.length - previewExercises.length);
  const activeExercises = active ? [...active.exercises].sort((a, b) => a.order - b.order) : [];
  const activePreviewExercises = activeExercises.slice(0, 8);
  const hiddenActiveExercises = Math.max(0, activeExercises.length - activePreviewExercises.length);
  const loggedSetCount = activeExercises.reduce(
    (total, ex) => total + ex.sets.filter((set) => set.completed !== false).length,
    0,
  );
  const completedCount = todays ? 1 : 0;
  const summaryLabel = active
    ? 'Workout in progress'
    : selectedRoutine
      ? 'Plan ready to start'
      : 'Set up your first split';

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
          title="Today's training"
          subtitle={summaryLabel}
          action={
            todays ? (
              <View className="flex-row items-center rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1">
                <Ionicons name="checkmark-circle" size={14} color="#34d399" />
                <Text variant="caption" className="ml-1 font-bold text-mint">
                  Logged
                </Text>
              </View>
            ) : null
          }
        />

        <View className="mb-1 flex-row gap-2">
          <MetricPill
            icon="calendar-outline"
            value={selectedRoutine ? 'Ready' : 'None'}
            label="Split"
            tone="brand"
          />
          <MetricPill
            icon="checkmark-circle-outline"
            value={String(completedCount)}
            label="Done today"
            tone="mint"
          />
          <MetricPill
            icon="albums-outline"
            value={String(routines.length)}
            label="Saved plans"
            tone="steel"
          />
        </View>

        {active ? (
          <Card elevated className="mt-5 rounded-[24px] border-brand bg-brand/10 p-5">
            <View className="flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand">
                <Ionicons name="barbell" size={23} color="#080706" />
              </View>
              <View className="flex-1">
                <View className="mb-1 self-start rounded-full bg-brand px-2 py-0.5">
                  <Text variant="caption" className="font-black text-iron-950">
                    ONGOING
                  </Text>
                </View>
                <Text variant="heading" className="mt-0.5" numberOfLines={1}>
                  {active.name ?? 'Workout'}
                </Text>
                <Text variant="caption" className="mt-0.5 text-iron-300">
                  {active.exercises.length} exercises · {loggedSetCount} logged{' '}
                  {loggedSetCount === 1 ? 'set' : 'sets'}
                </Text>
              </View>
            </View>

            <View className="mt-4 flex-row gap-2">
              <MetricPill
                icon="fitness-outline"
                value={String(active.exercises.length)}
                label="Exercises"
                tone="brand"
              />
              <MetricPill
                icon="checkmark-done-outline"
                value={String(loggedSetCount)}
                label="Logged sets"
                tone="mint"
              />
            </View>

            <View className="mt-3">
              {activePreviewExercises.length > 0 ? (
                activePreviewExercises.map((ex) => (
                  <WorkoutExerciseLine
                    key={ex.id}
                    ex={ex}
                    units={settings.units}
                    onPress={
                      ex.exercise_id
                        ? () => router.push(`/exercise/${ex.exercise_id}`)
                        : undefined
                    }
                  />
                ))
              ) : (
                <Text variant="muted">No exercises added yet.</Text>
              )}
              {hiddenActiveExercises > 0 ? (
                <Text variant="caption" className="pt-2 text-center text-iron-300">
                  +{hiddenActiveExercises} more
                </Text>
              ) : null}
            </View>

            <Button
              title="Continue workout"
              size="lg"
              icon="play"
              className="mt-4"
              onPress={() => router.push(`/workout/active/${active.id}`)}
            />
          </Card>
        ) : routines.length === 0 ? (
          <Card elevated className="mt-5 rounded-[24px] p-5">
            <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
              <Ionicons name="clipboard-outline" size={24} color="#f97316" />
            </View>
            <Text variant="heading">No split yet</Text>
            <Text variant="muted" className="mt-1">
              Build your first plan or import one from notes.
            </Text>
            <View className="mt-4 gap-3">
              <Button
                title="Import split"
                icon="document-text-outline"
                onPress={() => router.push('/routine-import')}
              />
              <Button
                title="Create split"
                variant="secondary"
                icon="add"
                onPress={() => router.push('/routine/new')}
              />
            </View>
          </Card>
        ) : selectedRoutine ? (
          <Card elevated className="mt-5 rounded-[24px] p-5">
            {routines.length > 1 ? (
              <Pressable
                onPress={() => setPickerOpen((v) => !v)}
                accessibilityRole="button"
                className="flex-row items-center active:opacity-70">
                <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
                  <Ionicons name="calendar-outline" size={23} color="#f97316" />
                </View>
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
              <View className="flex-row items-center">
                <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
                  <Ionicons name="calendar-outline" size={23} color="#f97316" />
                </View>
                <View className="flex-1">
                  <Text variant="heading" numberOfLines={1}>
                    {selectedRoutine.name}
                  </Text>
                  <Text variant="caption" className="mt-0.5">
                    {selectedExercises.length} exercises
                  </Text>
                </View>
              </View>
            )}

            <View className="mt-4 flex-row gap-2">
              <MetricPill
                icon="fitness-outline"
                value={String(selectedExercises.length)}
                label="Exercises"
                tone="brand"
              />
              <MetricPill icon="timer-outline" value={avgRest} label="Avg rest" tone="steel" />
            </View>

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
                        isSel ? 'bg-brand/10' : 'bg-iron-900'
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
                      {isSel ? <Ionicons name="checkmark" size={18} color="#f97316" /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View className="mt-3">
              {selectedExercises.length > 0 ? (
                previewExercises.map((ex, i) => (
                  <ExerciseLine
                    key={ex.id ?? i}
                    ex={ex}
                    units={settings.units}
                    onPress={
                      ex.exercise_id
                        ? () => router.push(`/exercise/${ex.exercise_id}`)
                        : undefined
                    }
                  />
                ))
              ) : (
                <Text variant="muted">This split has no exercises yet.</Text>
              )}
              {hiddenExercises > 0 ? (
                <Text variant="caption" className="pt-2 text-center">
                  +{hiddenExercises} more
                </Text>
              ) : null}
            </View>

            <Button
              title="Start split"
              size="lg"
              icon="play"
              className="mt-4"
              loading={starting}
              onPress={() => onStartRoutine(selectedRoutine)}
            />
            <View className="mt-3 flex-row gap-2">
              <Button
                title="Blank"
                variant="secondary"
                size="sm"
                icon="add"
                className="flex-1"
                disabled={starting}
                onPress={onStart}
              />
              <Button
                title="Edit"
                variant="secondary"
                size="sm"
                icon="create-outline"
                className="flex-1"
                disabled={starting}
                onPress={() => router.push(`/routine/${selectedRoutine.id}`)}
              />
              <Button
                title="AI"
                variant="secondary"
                size="sm"
                icon="sparkles"
                className="flex-1"
                disabled={starting}
                onPress={() => {
                  setAiError(null);
                  setAiReply(null);
                  setAiPrompt('');
                  setAiOpen(true);
                }}
              />
            </View>
          </Card>
        ) : null}

        <HomeProfileCard />

        <SectionHeader
          title="More tools"
          subtitle="Useful extras that stay out of the way until you need them."
        />
        <View className="flex-row gap-3">
          <QuickLink
            icon="fitness-outline"
            title="Exercises"
            subtitle="Browse the movement library."
            onPress={() => router.push('/exercises')}
          />
          <QuickLink
            icon="document-text-outline"
            title="Import"
            subtitle="Turn notes into a structured plan."
            onPress={() => router.push('/routine-import')}
          />
        </View>
        <View className="mt-3 flex-row gap-3">
          <QuickLink
            icon="camera-outline"
            title="Progress"
            subtitle="Compare photos over time."
            onPress={() => router.push('/progress')}
          />
          <QuickLink
            icon="person-outline"
            title="Profile"
            subtitle="Update goals and limitations."
            onPress={() => router.push('/profile')}
          />
        </View>
      </ScrollView>

      <Modal visible={aiOpen} animationType="slide" transparent onRequestClose={() => setAiOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/60"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View className="max-h-[88%] rounded-t-lg border-t border-iron-700 bg-iron-950">
            <ScrollView
              className="px-4 pt-4"
              contentContainerClassName="pb-8"
              keyboardShouldPersistTaps="handled">
              <View className="mb-3 flex-row items-center justify-between">
                <Text variant="heading">Edit with AI</Text>
                <Pressable
                  onPress={() => setAiOpen(false)}
                  disabled={aiSaving}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close AI editor"
                  className="h-9 w-9 items-center justify-center rounded-lg bg-iron-900 active:opacity-70">
                  <Ionicons name="close" size={20} color="#a8a29e" />
                </Pressable>
              </View>

              <Text variant="muted" className="mb-3">
                Tell AI how to change this routine. It will save the updated routine.
              </Text>

              <TextInput
                value={aiPrompt}
                onChangeText={setAiPrompt}
                multiline
                editable={!aiSaving}
                placeholder="Example: make this lower volume and swap barbell bench for dumbbells"
                placeholderTextColor="#78716c"
                className="min-h-[120px] rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
                style={{ textAlignVertical: 'top' }}
              />

              {aiError ? (
                <Text className="mt-3 text-sm font-medium text-red-400">{aiError}</Text>
              ) : null}

              {aiReply ? (
                <View className="mt-4 flex-row rounded-lg border border-brand/40 bg-brand/10 p-3">
                  <Ionicons name="sparkles" size={16} color="#f97316" />
                  <View className="ml-2 flex-1">
                    <Text variant="caption" className="font-bold text-brand">
                      Coach
                    </Text>
                    <Text variant="body" className="mt-0.5 text-iron-100">
                      {aiReply}
                    </Text>
                  </View>
                </View>
              ) : null}

              <Button
                title={aiReply ? 'Done' : 'Apply AI edit'}
                icon={aiReply ? 'checkmark' : 'sparkles'}
                size="lg"
                className="mt-4"
                loading={aiSaving}
                disabled={!aiReply && (aiPrompt.trim() === '' || !selectedRoutine)}
                onPress={() => {
                  if (aiReply) {
                    setAiReply(null);
                    setAiOpen(false);
                    return;
                  }
                  if (selectedRoutine) void onAiEdit(selectedRoutine);
                }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
