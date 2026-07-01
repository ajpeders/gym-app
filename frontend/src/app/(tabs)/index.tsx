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
import type { Routine, RoutineExercise, RoutineInput, Workout, WorkoutExercise } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

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

function ExerciseLine({ ex, units }: { ex: RoutineExercise; units: string }) {
  const name = ex.exercise?.name ?? 'Exercise';
  const sets =
    ex.target_sets != null
      ? `${ex.target_sets} set${ex.target_sets === 1 ? '' : 's'}`
      : 'Sets not set';
  const reps =
    ex.target_reps != null
      ? `${ex.target_reps} rep${ex.target_reps === 1 ? '' : 's'}`
      : 'Reps not set';
  const weight = ex.target_weight != null ? `${ex.target_weight}${units}` : null;
  const rest = ex.rest_seconds != null ? `${ex.rest_seconds}s rest` : null;
  const detail = [sets, reps, weight, rest].filter(Boolean).join(' · ');

  return (
    <View className="border-b border-iron-800 py-3">
      <Text variant="subheading" numberOfLines={1}>
        {name}
      </Text>
      <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

function WorkoutExerciseLine({ ex, units }: { ex: WorkoutExercise; units: string }) {
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
    <View className="border-b border-brand/20 py-3">
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
  );
}

function QuickLink({
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
      className="flex-row items-center rounded-lg border border-iron-800 bg-iron-900/80 px-3 py-3 active:opacity-75">
      <View className="mr-3 h-9 w-9 items-center justify-center rounded-lg bg-iron-800">
        <Ionicons name={icon} size={18} color="#f97316" />
      </View>
      <Text variant="body" className="ml-3 flex-1" numberOfLines={1}>
        {title}
      </Text>
      <Ionicons name="chevron-forward" size={18} color="#57534e" />
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View className="mb-2 mt-6">
      <Text variant="label" className="uppercase text-iron-300">
        {title}
      </Text>
    </View>
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

function routinePrompt(routine: Routine, units: string, request: string) {
  const exercises = [...routine.exercises]
    .sort((a, b) => a.order - b.order)
    .map((ex, i) => {
      const name = ex.exercise?.name ?? 'Exercise';
      const parts = [
        ex.target_sets != null ? `${ex.target_sets} sets` : null,
        ex.target_reps != null ? `${ex.target_reps} reps` : null,
        ex.target_weight != null ? `${ex.target_weight}${units}` : null,
        ex.rest_seconds != null ? `${ex.rest_seconds}s rest` : null,
      ].filter(Boolean);
      return `${i + 1}. ${name}${parts.length > 0 ? ` - ${parts.join(', ')}` : ''}`;
    })
    .join('\n');

  return [
    `Current routine: ${routine.name}`,
    routine.notes ? `Notes: ${routine.notes}` : null,
    'Exercises:',
    exercises,
    '',
    `Requested edit: ${request}`,
    '',
    'Return the complete updated routine, including every exercise that should remain.',
  ]
    .filter(Boolean)
    .join('\n');
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

  const fetchData = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([
        api.workouts({ limit: 12 }).catch(() => ({ items: [] as Workout[], total: 0 })),
        api.routines().catch(() => [] as Routine[]),
      ]);
      setRoutines(r);

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
    try {
      const parsed = await api.parseRoutine(routinePrompt(routine, settings.units, request));
      const next = parsed.routines.find((r) => !r.rest_day && r.exercises.length > 0);
      if (!next) {
        throw new Error('AI did not return an updated routine.');
      }

      const exercises = [];
      for (const ex of next.exercises) {
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
          target_weight: ex.target_weight,
          rest_seconds: previous?.rest_seconds ?? null,
        });
      }

      if (exercises.length === 0) {
        throw new Error('AI could not match any exercises in the updated routine.');
      }

      const input: RoutineInput = {
        name: next.name?.trim() || routine.name,
        notes: next.notes ?? routine.notes,
        exercises,
      };
      const updated = await api.updateRoutine(routine.id, input);
      setRoutines((prev) => prev.map((r) => (String(r.id) === String(updated.id) ? updated : r)));
      setPickedId(String(updated.id));
      setAiPrompt('');
      setAiOpen(false);
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
  const dayRoutine =
    routines.find((r) => r.name.toLowerCase().includes(dayName.toLowerCase())) ?? null;

  // Resolve today's routine: manual pick → weekday-named routine → last used → first.
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
        <View className="mt-3 px-0.5">
          <Text variant="eyebrow">{dateLabel}</Text>
          <View className="mt-1 flex-row items-end justify-between">
            <Text variant="title" className="flex-1">
              Today's routine
            </Text>
            {todays ? (
              <View className="ml-3 flex-row items-center rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1">
                <Ionicons name="checkmark-circle" size={14} color="#34d399" />
                <Text variant="caption" className="ml-1 font-bold text-mint">
                  Logged
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {active ? (
          <Card elevated className="mt-5 border-brand bg-brand/10">
            <View className="flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-lg bg-brand">
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
                  <WorkoutExerciseLine key={ex.id} ex={ex} units={settings.units} />
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
          <Card elevated className="mt-5">
            <View className="mb-4 h-12 w-12 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
              <Ionicons name="clipboard-outline" size={24} color="#f97316" />
            </View>
            <Text variant="heading">No routine yet</Text>
            <Text variant="muted" className="mt-1">
              Build your first plan or import one from notes.
            </Text>
            <View className="mt-4 gap-3">
              <Button
                title="Import routine"
                icon="document-text-outline"
                onPress={() => router.push('/routine-import')}
              />
              <Button
                title="Create routine"
                variant="secondary"
                icon="add"
                onPress={() => router.push('/routine/new')}
              />
            </View>
          </Card>
        ) : selectedRoutine ? (
          <Card elevated className="mt-5">
            {routines.length > 1 ? (
              <Pressable
                onPress={() => setPickerOpen((v) => !v)}
                accessibilityRole="button"
                className="flex-row items-center active:opacity-70">
                <View className="mr-3 h-12 w-12 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
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
                <View className="mr-3 h-12 w-12 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
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
                  <ExerciseLine key={ex.id ?? i} ex={ex} units={settings.units} />
                ))
              ) : (
                <Text variant="muted">This routine has no exercises yet.</Text>
              )}
              {hiddenExercises > 0 ? (
                <Text variant="caption" className="pt-2 text-center">
                  +{hiddenExercises} more
                </Text>
              ) : null}
            </View>

            <Button
              title="Start routine"
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
                  setAiOpen(true);
                }}
              />
            </View>
          </Card>
        ) : null}

        <SectionHeader title="More" />
        <View className="gap-2">
          <QuickLink
            icon="barbell-outline"
            title="Workout history"
            onPress={() => router.push('/workouts')}
          />
          <QuickLink
            icon="clipboard-outline"
            title="Routines"
            onPress={() => router.push('/routines')}
          />
          <QuickLink
            icon="document-text-outline"
            title="Import routine"
            onPress={() => router.push('/routine-import')}
          />
          <QuickLink
            icon="fitness-outline"
            title="Exercises"
            onPress={() => router.push('/exercises')}
          />
          <QuickLink
            icon="chatbubbles-outline"
            title="Coach"
            onPress={() => router.push('/coach')}
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

              <Button
                title="Apply AI edit"
                icon="sparkles"
                size="lg"
                className="mt-4"
                loading={aiSaving}
                disabled={aiPrompt.trim() === '' || !selectedRoutine}
                onPress={() => {
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
