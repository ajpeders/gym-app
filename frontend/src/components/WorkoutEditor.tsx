import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Exercise, SplitMode, WorkoutEditProposal, WorkoutInput } from '@/api/types';
import { useSettings } from '@/state/settings';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BottomAction } from '@/components/ui/BottomAction';
import { FormField } from '@/components/ui/FormField';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { WeekdayPicker } from '@/components/WeekdayPicker';
import { WorkoutAiEdit, type WorkoutAiWorking } from '@/components/WorkoutAiEdit';
import { formatRepRange, parseRepRange, titleCase } from '@/lib/format';
import { normalise, togglePairAt } from '@/lib/supersets';
import { formatExerciseStats, statsFor, useExerciseStats } from '@/hooks/use-exercise-stats';

export interface DraftExercise {
  exercise_id: string;
  name: string;
  image?: string | null;
  target_sets: string;
  target_reps: string;
  target_weight: string;
  target_duration: string;
  rest_seconds: string;
  notes: string;
  /** Shared label = superset. Editing offers "pair with the next exercise",
   * which is how people actually think about it; the labels are derived from
   * that so the user never types an "A". */
  superset_group?: string | null;
}

interface WorkoutEditorProps {
  title: string;
  initialName?: string;
  initialNotes?: string;
  initialExercises?: DraftExercise[];
  initialWeekdays?: number[];
  initialFloating?: boolean;
  /** Scheduling mode of the split this day belongs to. A rolling split runs
   * its days in rotation order, so there is no weekday to pick here. */
  splitMode?: SplitMode;
  saving?: boolean;
  onSave: (input: WorkoutInput) => Promise<void> | void;
  onDelete?: () => void;
  /** When set, a share button appears in the header (export the saved workout). */
  onExport?: () => void;
}

function formatNumberRange(low: number | null | undefined, high: number | null | undefined) {
  if (low == null) return '';
  return high != null && high !== low ? `${low}-${high}` : String(low);
}

function parseNumberRange(value: string, integer = false): [number | null, number | null] {
  const parts = value.trim().replace(/[–—]/g, '-').split(/\s*(?:-|to)\s*/i).filter(Boolean);
  if (!parts.length) return [null, null];
  const parse = integer ? (part: string) => parseInt(part, 10) : (part: string) => parseFloat(part);
  const low = parse(parts[0]);
  const high = parts.length > 1 ? parse(parts[1]) : NaN;
  if (!Number.isFinite(low)) return [null, null];
  if (!Number.isFinite(high) || high === low) return [low, null];
  return low < high ? [low, high] : [high, low];
}

function draftSummary(exercise: DraftExercise, units: string): string {
  const parts = [
    exercise.target_sets ? `${exercise.target_sets} sets` : null,
    exercise.target_reps ? `${exercise.target_reps} reps` : null,
    exercise.target_weight ? `${exercise.target_weight} ${units}` : null,
    exercise.target_duration ? `${exercise.target_duration} sec` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'Tap to add targets';
}

export function WorkoutEditor({
  title,
  initialName = '',
  initialNotes = '',
  initialExercises = [],
  initialWeekdays = [],
  initialFloating = false,
  splitMode = 'rigid',
  saving = false,
  onSave,
  onDelete,
  onExport,
}: WorkoutEditorProps) {
  const { settings } = useSettings();
  const { configured: aiConfigured } = useAiStatus();
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [exercises, setExercises] = useState<DraftExercise[]>(initialExercises);
  const [openExercise, setOpenExercise] = useState<number | null>(initialExercises.length ? 0 : null);
  const exerciseStats = useExerciseStats(exercises.map((e) => e.exercise_id));
  const [weekdays, setWeekdays] = useState<number[]>(initialWeekdays);
  const [floating, setFloating] = useState(initialFloating);
  const [picking, setPicking] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The current draft, shaped for the AI editor (exercises by name, numeric
  // targets). Rebuilt on open so the AI always starts from what's on screen.
  function aiWorking(): WorkoutAiWorking {
    return {
      name: name.trim(),
      notes: notes.trim() || null,
      exercises: exercises.map((e) => {
        const reps = parseRepRange(e.target_reps);
        const [weight, weightMax] = parseNumberRange(e.target_weight);
        const [duration, durationMax] = parseNumberRange(e.target_duration, true);
        return {
          exercise: e.name,
          target_sets: e.target_sets ? parseInt(e.target_sets, 10) : null,
          target_reps: reps.min,
          target_reps_max: reps.max,
          target_weight: weight,
          target_weight_max: weightMax,
          target_duration_seconds: duration,
          target_duration_seconds_max: durationMax,
          notes: e.notes.trim() || null,
        };
      }),
    };
  }

  // Load an AI proposal into the draft form for review — the form is the final
  // review surface, so nothing persists until the user taps Save. Exercises the
  // matcher couldn't resolve (no exercise_id) are dropped. Planned rest is kept
  // from the matching existing exercise, else left blank.
  function applyProposal(p: WorkoutEditProposal) {
    const previous = new Map(exercises.map((e) => [e.exercise_id, e]));
    const drafts: DraftExercise[] = p.exercises
      .filter((e) => e.exercise_id != null)
      .map((e) => {
        const id = String(e.exercise_id);
        return {
          exercise_id: id,
          name: e.matched_name ?? e.exercise_name,
          target_sets: e.target_sets != null ? String(e.target_sets) : '',
          target_reps: formatRepRange(e.target_reps, e.target_reps_max) ?? '',
          target_weight: formatNumberRange(e.target_weight, e.target_weight_max),
          target_duration: formatNumberRange(
            e.target_duration_seconds,
            e.target_duration_seconds_max,
          ),
          rest_seconds: previous.get(id)?.rest_seconds ?? '',
          notes: e.notes ?? previous.get(id)?.notes ?? '',
        };
      });
    if (p.name.trim()) setName(p.name.trim());
    if (p.notes != null) setNotes(p.notes);
    setExercises(drafts);
    setAiOpen(false);
  }

  function addExercise(ex: Exercise) {
    setOpenExercise(exercises.length);
    setExercises((prev) => [
      ...prev,
      {
        exercise_id: ex.id,
        name: ex.name,
        image: ex.images?.[0] ?? null,
        target_sets: '3',
        target_reps: '8',
        target_weight: '',
        target_duration: '',
        rest_seconds: '',
        notes: '',
      },
    ]);
    setPicking(false);
  }

  function update(idx: number, patch: Partial<DraftExercise>) {
    setExercises((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }

  function remove(idx: number) {
    // Normalising after the removal drops a superset left with one member.
    setExercises((prev) => normalise(prev.filter((_, i) => i !== idx)));
    setOpenExercise((current) => {
      if (current == null) return null;
      if (current === idx) return null;
      return current > idx ? current - 1 : current;
    });
  }

  /** Pair an exercise with the one below it, or split them apart. Labels are
   * derived from adjacency — see lib/supersets.ts. */
  function togglePair(idx: number) {
    setExercises((prev) => togglePairAt(prev, idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= exercises.length) return;
    setExercises((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      // Moving one out of a superset ends it; the labels follow adjacency.
      return normalise(next);
    });
    setOpenExercise(target);
  }

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError('Give your workout a name.');
      return;
    }
    if (exercises.length === 0) {
      setError('Add at least one exercise.');
      return;
    }
    const input: WorkoutInput = {
      name: name.trim(),
      notes: notes.trim() || null,
      weekdays: floating ? [] : weekdays,
      floating,
      exercises: exercises.map((e, i) => {
        const reps = parseRepRange(e.target_reps);
        const [weight, weightMax] = parseNumberRange(e.target_weight);
        const [duration, durationMax] = parseNumberRange(e.target_duration, true);
        return {
          exercise_id: e.exercise_id,
          order: i,
          target_sets: e.target_sets ? parseInt(e.target_sets, 10) : null,
          target_reps: reps.min,
          target_reps_max: reps.max,
          target_weight: weight,
          target_weight_max: weightMax,
          target_duration_seconds: duration,
          target_duration_seconds_max: durationMax,
          rest_seconds: e.rest_seconds ? parseInt(e.rest_seconds, 10) : null,
          notes: e.notes.trim() || null,
          superset_group: e.superset_group ?? null,
        };
      }),
    };
    await onSave(input);
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerRight: onExport
            ? () => (
                <Pressable
                  onPress={onExport}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Export workout"
                  className="pl-3 active:opacity-60">
                  <Ionicons name="share-outline" size={22} color="#5eead4" />
                </Pressable>
              )
            : undefined,
        }}
      />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-40" keyboardShouldPersistTaps="handled">
        <FormField label="Name" value={name} onChangeText={setName} placeholder="e.g. Push Day" />
        <FormField
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional"
          multiline
          containerClassName="mt-3"
        />

        {aiConfigured ? (
          <Pressable
            onPress={() => setAiOpen(true)}
            className="mt-4 flex-row items-center justify-center rounded-lg border border-brand/40 bg-brand/10 py-2.5 active:opacity-80">
            <Ionicons name="sparkles" size={16} color="#5eead4" />
            <Text className="ml-2 font-semibold text-brand">Edit with AI</Text>
          </Pressable>
        ) : null}

        <Text variant="heading" className="mt-5 mb-2">
          Exercises
        </Text>

        {exercises.length === 0 ? (
          <Card className="mb-3">
            <Text variant="muted">No exercises yet. Add some below.</Text>
          </Card>
        ) : (
          exercises.map((e, idx) => {
            const isOpen = openExercise === idx;
            return (
              <Card key={`${e.exercise_id}-${idx}`} className="mb-3 p-3.5">
                <View className="flex-row items-center justify-between">
                  <ExerciseThumb images={e.image ? [e.image] : null} size={36} radius={6} />
                  <Pressable
                    onPress={() => setOpenExercise(isOpen ? null : idx)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    className="ml-2 min-w-0 flex-1 active:opacity-70">
                    <View className="flex-row items-center">
                      <Text variant="subheading" numberOfLines={1} className="min-w-0 flex-1">
                        {idx + 1}. {titleCase(e.name)}
                      </Text>
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="#64748b"
                      />
                    </View>
                    <Text variant="caption" numberOfLines={1} className="mt-0.5 text-iron-400">
                      {draftSummary(e, settings.units)}
                    </Text>
                    {(() => {
                      const pr = formatExerciseStats(
                        statsFor(exerciseStats, e.exercise_id),
                        settings.units,
                      );
                      return pr ? (
                        <Text variant="caption" numberOfLines={1} className="mt-0.5 text-brand">
                          {pr}
                        </Text>
                      ) : null;
                    })()}
                  </Pressable>
                  <View className="flex-row items-center gap-1">
                    <Pressable
                      onPress={() => move(idx, -1)}
                      disabled={idx === 0}
                      accessibilityLabel={`Move ${e.name} earlier`}
                      hitSlop={6}
                      className="h-9 w-9 items-center justify-center rounded-lg border border-iron-700 bg-iron-900 disabled:opacity-25">
                      <Ionicons name="arrow-up" size={17} color="#94a3b8" />
                    </Pressable>
                    <Pressable
                      onPress={() => move(idx, 1)}
                      disabled={idx === exercises.length - 1}
                      accessibilityLabel={`Move ${e.name} later`}
                      hitSlop={6}
                      className="h-9 w-9 items-center justify-center rounded-lg border border-iron-700 bg-iron-900 disabled:opacity-25">
                      <Ionicons name="arrow-down" size={17} color="#94a3b8" />
                    </Pressable>
                    <Pressable
                      onPress={() => remove(idx)}
                      accessibilityLabel={`Remove ${e.name}`}
                      hitSlop={6}
                      className="h-9 w-9 items-center justify-center rounded-lg">
                      <Ionicons name="trash-outline" size={17} color="#f87171" />
                    </Pressable>
                  </View>
                </View>

                {isOpen ? (
                  <View className="mt-3 border-t border-iron-800 pt-3">
                    <View className="flex-row flex-wrap gap-2">
                      <Field
                        label="Sets"
                        value={e.target_sets}
                        onChangeText={(v) => update(idx, { target_sets: v })}
                      />
                      <Field
                        label="Reps"
                        value={e.target_reps}
                        onChangeText={(v) => update(idx, { target_reps: v })}
                        range
                      />
                      <Field
                        label={`Wt (${settings.units})`}
                        value={e.target_weight}
                        onChangeText={(v) => update(idx, { target_weight: v })}
                        range
                      />
                      <Field
                        label="Time (sec)"
                        value={e.target_duration}
                        onChangeText={(v) => update(idx, { target_duration: v })}
                        range
                      />
                      <Field
                        label="Rest (sec)"
                        value={e.rest_seconds}
                        onChangeText={(v) => update(idx, { rest_seconds: v })}
                      />
                    </View>

                    {idx < exercises.length - 1 ? (
                      <Pressable
                        onPress={() => togglePair(idx)}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: !!e.superset_group }}
                        accessibilityLabel={`Superset with ${exercises[idx + 1].name}`}
                        className="mt-3 flex-row items-center justify-between rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 active:opacity-80">
                        <Text variant="caption" className="flex-1 pr-3">
                          Superset with {exercises[idx + 1].name}
                        </Text>
                        <View
                          className={`h-6 w-6 items-center justify-center rounded-md border ${
                            e.superset_group ? 'border-brand bg-brand' : 'border-iron-600 bg-iron-950'
                          }`}>
                          {e.superset_group ? (
                            <Ionicons name="checkmark" size={16} color="#030712" />
                          ) : null}
                        </View>
                      </Pressable>
                    ) : null}

                    <FormField
                      label="Exercise notes"
                      value={e.notes}
                      onChangeText={(value) => update(idx, { notes: value })}
                      placeholder="Cues, setup, tempo, substitutions..."
                      multiline
                      containerClassName="mt-3"
                      inputClassName="bg-iron-950"
                    />
                  </View>
                ) : null}
              </Card>
            );
          })
        )}

        <Button
          title="Add exercise"
          variant="secondary"
          onPress={() => setPicking(true)}
          className="mt-1"
        />

        <Text variant="heading" className="mt-6 mb-2">
          Schedule
        </Text>
        {splitMode === 'rolling' ? (
          <Text variant="caption">
            This split runs as a rotation, so this day has no weekday. Its place in the cycle
            comes from the order on the split screen.
          </Text>
        ) : (
        <>
        <Pressable
          onPress={() => setFloating((f) => !f)}
          accessibilityRole="switch"
          accessibilityState={{ checked: floating }}
          className="flex-row items-center justify-between rounded-lg border border-iron-700 bg-iron-900/90 px-3.5 py-3 active:opacity-80">
          <Text variant="label" className="flex-1 pr-3">
            Do once — floating (e.g. Fri or Sat)
          </Text>
          <View
            className={`h-6 w-6 items-center justify-center rounded-md border ${
              floating ? 'border-brand bg-brand' : 'border-iron-600 bg-iron-950'
            }`}>
            {floating ? <Ionicons name="checkmark" size={16} color="#030712" /> : null}
          </View>
        </Pressable>

        {floating ? (
          <Text variant="caption" className="mt-2">
            Floating workouts aren&apos;t pinned to a weekday — do them whenever they fit.
          </Text>
        ) : (
          <View className="mt-3">
            <Text variant="caption" className="mb-2">
              Repeat on these days
            </Text>
            <WeekdayPicker value={weekdays} onChange={setWeekdays} />
          </View>
        )}
        </>
        )}

        {error ? <Text className="mt-3 text-sm text-red-500">{error}</Text> : null}

        {onDelete ? (
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            className="mt-8 flex-row items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 active:bg-red-500/10">
            <Ionicons name="trash-outline" size={17} color="#f87171" />
            <Text className="ml-2 text-sm font-bold text-red-400">Delete workout</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <BottomAction>
        <Button title="Save workout" size="lg" loading={saving} onPress={save} />
      </BottomAction>

      <ModalSheet
        visible={picking}
        title="Add exercise"
        onClose={() => setPicking(false)}
        scroll={false}
        contentClassName="px-0">
        <ExerciseBrowser
          onSelect={addExercise}
          renderTrailing={() => (
            <View className="rounded-full bg-brand px-3 py-1">
              <Text variant="caption" className="font-black text-iron-950">
                Add
              </Text>
            </View>
          )}
        />
      </ModalSheet>

      <WorkoutAiEdit
        visible={aiOpen}
        units={settings.units}
        initialWorking={aiWorking()}
        onApply={applyProposal}
        onClose={() => setAiOpen(false)}
      />
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  decimal,
  range,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  decimal?: boolean;
  // range fields accept "8-12"; use a keyboard that exposes the hyphen.
  range?: boolean;
}) {
  const keyboardType = range ? 'default' : decimal ? 'decimal-pad' : 'number-pad';
  return (
    <FormField
      label={label}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      placeholder={range ? '8-12' : '-'}
      containerClassName="min-w-[46%] flex-1"
      inputClassName="bg-iron-950 px-2 py-2 text-center"
    />
  );
}
