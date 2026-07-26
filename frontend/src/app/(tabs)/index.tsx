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
import type {
  SessionExercise,
  TodayWorkout,
  Workout,
  WorkoutExercise,
  WorkoutInput,
} from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { formatRepRange } from '@/lib/format';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function PlanExerciseLine({
  ex,
  units,
  onPress,
}: {
  ex: WorkoutExercise;
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
  const detail = [sets, reps, weight].filter(Boolean).join(' · ');

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

function SessionExerciseLine({
  ex,
  units,
  onPress,
}: {
  ex: SessionExercise;
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

function findPreviousExercise(workout: Workout, exerciseId: string, fallbackName: string) {
  return workout.exercises.find((ex) => {
    if (String(ex.exercise_id) === String(exerciseId)) return true;
    return ex.exercise?.name?.toLowerCase() === fallbackName.toLowerCase();
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const { workout: active, start } = useActiveWorkout();
  const { settings } = useSettings();

  // All plan workouts (the pool for the picker + preview + AI edit).
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  // Today's scheduled plan workout(s) + whether they're already done this week.
  const [today, setToday] = useState<TodayWorkout[]>([]);
  // The user's manual pick for this session (overrides today's default).
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
      const [w, t] = await Promise.all([
        api.workouts().catch(() => [] as Workout[]),
        api.splitToday().catch(() => [] as TodayWorkout[]),
      ]);
      setWorkouts(w);
      setToday(t);
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
    setStarting(true);
    try {
      const s = await start({ workout_id: String(workout.id) });
      router.push(`/session/active/${s.id}`);
    } finally {
      setStarting(false);
    }
  }

  async function onAiEdit(workout: Workout) {
    const request = aiPrompt.trim();
    if (!request || aiSaving) return;

    setAiSaving(true);
    setAiError(null);
    setAiReply(null);
    try {
      // Scoped single-workout edit: streams a proposal + a one-line summary of
      // what changed, and resolves each exercise via matcher v2.
      const proposal = await api.editWorkoutStream({
        instruction: request,
        name: workout.name,
        notes: workout.notes,
        exercises: workout.exercises
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
        const previous = findPreviousExercise(workout, exerciseId, ex.exercise_name);
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
        throw new Error('AI could not match any exercises in the updated workout.');
      }

      const input: WorkoutInput = {
        name: proposal.name?.trim() || workout.name,
        notes: proposal.notes ?? workout.notes,
        exercises,
      };
      const updated = await api.updateWorkout(workout.id, input);
      setWorkouts((prev) => prev.map((w) => (String(w.id) === String(updated.id) ? updated : w)));
      setPickedId(String(updated.id));
      setAiPrompt('');
      // Keep the sheet open and show what the coach did, rather than silently
      // closing — the user asked for a response after every AI edit.
      setAiReply(proposal.reply?.trim() || 'Updated your workout.');
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

  // Resolve the workout to feature: manual pick → today's scheduled → first.
  const defaultId = today[0]?.id ?? workouts[0]?.id ?? null;
  const selectedId = pickedId ?? defaultId;
  const selectedWorkout =
    workouts.find((w) => String(w.id) === String(selectedId)) ?? workouts[0] ?? null;
  const todayEntry = today.find((t) => String(t.id) === String(selectedWorkout?.id));
  const doneThisWeek = todayEntry?.done_this_week ?? false;

  const selectedExercises = selectedWorkout
    ? [...selectedWorkout.exercises].sort((a, b) => a.order - b.order)
    : [];
  const previewExercises = selectedExercises.slice(0, 4);
  const hiddenExercises = Math.max(0, selectedExercises.length - previewExercises.length);
  const activeExercises = active ? [...active.exercises].sort((a, b) => a.order - b.order) : [];
  const activePreviewExercises = activeExercises.slice(0, 4);
  const hiddenActiveExercises = Math.max(0, activeExercises.length - activePreviewExercises.length);
  const loggedSetCount = activeExercises.reduce(
    (total, ex) => total + ex.sets.filter((set) => set.completed !== false).length,
    0,
  );
  const summaryLabel = active
    ? 'Session in progress'
    : selectedWorkout
      ? 'Plan ready to start'
      : 'Set up your first plan';

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
          title="Today"
          subtitle={summaryLabel}
          action={
            <View className="flex-row items-center gap-2">
              {doneThisWeek ? (
                <View className="flex-row items-center rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1">
                  <Ionicons name="checkmark-circle" size={14} color="#34d399" />
                  <Text variant="caption" className="ml-1 font-bold text-mint">
                    Done
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => router.push('/settings')}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                hitSlop={8}
                className="h-10 w-10 items-center justify-center rounded-full border border-iron-700 bg-iron-900 active:bg-iron-800">
                <Ionicons name="settings-outline" size={19} color="#a8a29e" />
              </Pressable>
            </View>
          }
        />

        {active ? (
          <Card elevated className="border-brand bg-brand/10 p-5">
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
                  {active.name ?? 'Session'}
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
                  <SessionExerciseLine
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
              title="Continue session"
              size="lg"
              icon="play"
              className="mt-4"
              onPress={() => router.push(`/session/active/${active.id}`)}
            />
          </Card>
        ) : workouts.length === 0 ? (
          <Card elevated className="p-5">
            <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
              <Ionicons name="clipboard-outline" size={24} color="#f97316" />
            </View>
            <Text variant="heading">No training plan yet</Text>
            <Text variant="muted" className="mt-1">
              Import your program from notes or create a workout day manually.
            </Text>
            <View className="mt-4 gap-3">
              <Button
                title="Import a plan"
                icon="document-text-outline"
                onPress={() => router.push('/workout-import')}
              />
              <Button
                title="Create a workout"
                variant="secondary"
                icon="add"
                onPress={() => router.push('/workout/new')}
              />
            </View>
          </Card>
        ) : selectedWorkout ? (
          <Card elevated className="p-5">
            {workouts.length > 1 ? (
              <Pressable
                onPress={() => setPickerOpen((v) => !v)}
                accessibilityRole="button"
                className="flex-row items-center active:opacity-70">
                <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
                  <Ionicons name="calendar-outline" size={23} color="#f97316" />
                </View>
                <View className="flex-1">
                  <Text variant="heading" numberOfLines={1}>
                    {selectedWorkout.name}
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
                    {selectedWorkout.name}
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
            </View>

            {pickerOpen && workouts.length > 1 ? (
              <View className="mt-3 overflow-hidden rounded-lg border border-iron-700">
                {workouts.map((w) => {
                  const isSel = String(w.id) === String(selectedWorkout.id);
                  const isToday = today.some((t) => String(t.id) === String(w.id));
                  return (
                    <Pressable
                      key={w.id}
                      onPress={() => {
                        setPickedId(String(w.id));
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
                        {w.name}
                      </Text>
                      {isToday ? (
                        <View className="mr-2 rounded-full bg-iron-700 px-2 py-0.5">
                          <Text variant="caption">today</Text>
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
                  <PlanExerciseLine
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
                <Text variant="muted">This workout has no exercises yet.</Text>
              )}
              {hiddenExercises > 0 ? (
                <Text variant="caption" className="pt-2 text-center">
                  +{hiddenExercises} more
                </Text>
              ) : null}
            </View>

            <Button
              title="Start session"
              size="lg"
              icon="play"
              className="mt-4"
              loading={starting}
              onPress={() => onStartWorkout(selectedWorkout)}
            />
            <View className="mt-3 flex-row gap-2">
              <Button
                title="Edit workout"
                variant="secondary"
                size="sm"
                icon="create-outline"
                className="flex-1"
                disabled={starting}
                onPress={() => router.push(`/workout/${selectedWorkout.id}`)}
              />
              <Button
                title="Adjust with AI"
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

        <SectionHeader
          title="Tools"
          subtitle="Reference movements or check your visual progress."
        />
        <View className="flex-row gap-3">
          <QuickLink
            icon="fitness-outline"
            title="Exercise library"
            subtitle="Form notes, muscles, and equipment."
            onPress={() => router.push('/exercises')}
          />
          <QuickLink
            icon="camera-outline"
            title="Progress photos"
            subtitle="Compare photos over time."
            onPress={() => router.push('/progress')}
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
                Tell AI how to change this workout. It will save the updated workout.
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
                disabled={!aiReply && (aiPrompt.trim() === '' || !selectedWorkout)}
                onPress={() => {
                  if (aiReply) {
                    setAiReply(null);
                    setAiOpen(false);
                    return;
                  }
                  if (selectedWorkout) void onAiEdit(selectedWorkout);
                }}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
