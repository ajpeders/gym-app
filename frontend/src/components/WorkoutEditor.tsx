import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Exercise, WorkoutEditProposal, WorkoutInput } from '@/api/types';
import { useSettings } from '@/state/settings';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { WeekdayPicker } from '@/components/WeekdayPicker';
import { WorkoutAiEdit, type WorkoutAiWorking } from '@/components/WorkoutAiEdit';
import { formatRepRange, parseRepRange, titleCase } from '@/lib/format';
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
}

interface WorkoutEditorProps {
  title: string;
  initialName?: string;
  initialNotes?: string;
  initialExercises?: DraftExercise[];
  initialWeekdays?: number[];
  initialFloating?: boolean;
  saving?: boolean;
  onSave: (input: WorkoutInput) => Promise<void> | void;
  onDelete?: () => void;
  /** When set, a share button appears in the header (export the saved workout). */
  onExport?: () => void;
}

const smallInput =
  'rounded-md border border-iron-700 bg-iron-950 px-2 py-2 text-center text-base text-iron-50';

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

export function WorkoutEditor({
  title,
  initialName = '',
  initialNotes = '',
  initialExercises = [],
  initialWeekdays = [],
  initialFloating = false,
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
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    setExercises((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
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
                  <Ionicons name="share-outline" size={22} color="#818cf8" />
                </Pressable>
              )
            : undefined,
        }}
      />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28" keyboardShouldPersistTaps="handled">
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Push Day" />
        <Input
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional"
          multiline
          containerClassName="mt-3"
          className="h-20"
        />

        {aiConfigured ? (
          <Pressable
            onPress={() => setAiOpen(true)}
            className="mt-4 flex-row items-center justify-center rounded-lg border border-brand/40 bg-brand/10 py-2.5 active:opacity-80">
            <Ionicons name="sparkles" size={16} color="#818cf8" />
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
          exercises.map((e, idx) => (
            <Card key={`${e.exercise_id}-${idx}`} className="mb-3">
              <View className="flex-row items-center justify-between">
                <ExerciseThumb images={e.image ? [e.image] : null} size={36} radius={6} />
                <View className="ml-2 flex-1">
                  <Text variant="subheading" numberOfLines={1}>
                    {idx + 1}. {titleCase(e.name)}
                  </Text>
                  {(() => {
                    const pr = formatExerciseStats(
                      statsFor(exerciseStats, e.exercise_id),
                      settings.units,
                    );
                    return pr ? (
                      <Text variant="caption" numberOfLines={1} className="mt-0.5 text-iron-400">
                        {pr}
                      </Text>
                    ) : null;
                  })()}
                </View>
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

              <View className="mt-3 flex-row flex-wrap gap-2">
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

              <Text variant="caption" className="mb-1 mt-3 text-iron-400">
                Exercise notes
              </Text>
              <TextInput
                value={e.notes}
                onChangeText={(value) => update(idx, { notes: value })}
                placeholder="Cues, setup, tempo, substitutions..."
                placeholderTextColor="#64748b"
                multiline
                className="min-h-[64px] rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-base text-iron-50"
              />
            </Card>
          ))
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
            {floating ? <Ionicons name="checkmark" size={16} color="#070b12" /> : null}
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

        {error ? <Text className="text-red-500 text-sm mt-3">{error}</Text> : null}

        <Button title="Save workout" size="lg" className="mt-4" loading={saving} onPress={save} />

        {onDelete ? (
          <Button title="Delete workout" variant="danger" className="mt-3" onPress={onDelete} />
        ) : null}
      </ScrollView>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text variant="heading">Add exercise</Text>
            <Pressable onPress={() => setPicking(false)} hitSlop={8}>
              <Text className="text-brand font-bold">Close</Text>
            </Pressable>
          </View>
          <ExerciseBrowser
            onSelect={addExercise}
            renderTrailing={() => <Text className="text-xl font-black text-brand">ADD</Text>}
          />
        </SafeAreaView>
      </Modal>

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
    <View className="min-w-[46%] flex-1">
      <Text variant="caption" className="mb-1">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={range ? '8-12' : '-'}
        placeholderTextColor="#64748b"
        className={smallInput}
      />
    </View>
  );
}
