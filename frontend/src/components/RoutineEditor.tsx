import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Exercise, RoutineEditProposal, RoutineInput } from '@/api/types';
import { useSettings } from '@/state/settings';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { RoutineAiEdit, type RoutineAiWorking } from '@/components/RoutineAiEdit';
import { formatRepRange, parseRepRange, titleCase } from '@/lib/format';

export interface DraftExercise {
  exercise_id: string;
  name: string;
  image?: string | null;
  target_sets: string;
  target_reps: string;
  target_weight: string;
  rest_seconds: string;
}

interface RoutineEditorProps {
  title: string;
  initialName?: string;
  initialNotes?: string;
  initialExercises?: DraftExercise[];
  saving?: boolean;
  onSave: (input: RoutineInput) => Promise<void> | void;
  onDelete?: () => void;
}

const smallInput =
  'rounded-md border border-iron-700 bg-iron-950 px-2 py-2 text-center text-base text-iron-50';

export function RoutineEditor({
  title,
  initialName = '',
  initialNotes = '',
  initialExercises = [],
  saving = false,
  onSave,
  onDelete,
}: RoutineEditorProps) {
  const { settings } = useSettings();
  const { configured: aiConfigured } = useAiStatus();
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [exercises, setExercises] = useState<DraftExercise[]>(initialExercises);
  const [picking, setPicking] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The current draft, shaped for the AI editor (exercises by name, numeric
  // targets). Rebuilt on open so the AI always starts from what's on screen.
  function aiWorking(): RoutineAiWorking {
    return {
      name: name.trim(),
      notes: notes.trim() || null,
      exercises: exercises.map((e) => {
        const reps = parseRepRange(e.target_reps);
        return {
          exercise: e.name,
          target_sets: e.target_sets ? parseInt(e.target_sets, 10) : null,
          target_reps: reps.min,
          target_reps_max: reps.max,
          target_weight: e.target_weight ? parseFloat(e.target_weight) : null,
          notes: null,
        };
      }),
    };
  }

  // Load an AI proposal into the draft form for review — the form is the final
  // review surface, so nothing persists until the user taps Save. Exercises the
  // matcher couldn't resolve (no exercise_id) are dropped. Rest timers are kept
  // from the matching existing exercise, else the user's default.
  function applyProposal(p: RoutineEditProposal) {
    const prevRest = new Map(exercises.map((e) => [e.exercise_id, e.rest_seconds]));
    const drafts: DraftExercise[] = p.exercises
      .filter((e) => e.exercise_id != null)
      .map((e) => {
        const id = String(e.exercise_id);
        return {
          exercise_id: id,
          name: e.exercise_name,
          target_sets: e.target_sets != null ? String(e.target_sets) : '',
          target_reps: formatRepRange(e.target_reps, e.target_reps_max) ?? '',
          target_weight: e.target_weight != null ? String(e.target_weight) : '',
          rest_seconds: prevRest.get(id) ?? String(settings.rest_timer_default),
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
        rest_seconds: String(settings.rest_timer_default),
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
      setError('Give your routine a name.');
      return;
    }
    if (exercises.length === 0) {
      setError('Add at least one exercise.');
      return;
    }
    const input: RoutineInput = {
      name: name.trim(),
      notes: notes.trim() || null,
      exercises: exercises.map((e, i) => {
        const reps = parseRepRange(e.target_reps);
        return {
          exercise_id: e.exercise_id,
          order: i,
          target_sets: e.target_sets ? parseInt(e.target_sets, 10) : null,
          target_reps: reps.min,
          target_reps_max: reps.max,
          target_weight: e.target_weight ? parseFloat(e.target_weight) : null,
          rest_seconds: e.rest_seconds ? parseInt(e.rest_seconds, 10) : null,
        };
      }),
    };
    await onSave(input);
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen options={{ headerShown: true, title }} />
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
            <Ionicons name="sparkles" size={16} color="#f97316" />
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
                <Text variant="subheading" numberOfLines={1} className="ml-2 flex-1">
                  {idx + 1}. {titleCase(e.name)}
                </Text>
                <View className="flex-row items-center gap-3">
                  <Pressable onPress={() => move(idx, -1)} hitSlop={6}>
                    <Text className="text-lg text-iron-400">UP</Text>
                  </Pressable>
                  <Pressable onPress={() => move(idx, 1)} hitSlop={6}>
                    <Text className="text-lg text-iron-400">DN</Text>
                  </Pressable>
                  <Pressable onPress={() => remove(idx)} hitSlop={6}>
                    <Text className="text-sm font-bold text-red-500">Remove</Text>
                  </Pressable>
                </View>
              </View>

              <View className="mt-3 flex-row gap-2">
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
                  decimal
                />
                <Field
                  label="Rest (s)"
                  value={e.rest_seconds}
                  onChangeText={(v) => update(idx, { rest_seconds: v })}
                />
              </View>
            </Card>
          ))
        )}

        <Button
          title="Add exercise"
          variant="secondary"
          onPress={() => setPicking(true)}
          className="mt-1"
        />

        {error ? <Text className="text-red-500 text-sm mt-3">{error}</Text> : null}

        <Button title="Save routine" size="lg" className="mt-4" loading={saving} onPress={save} />

        {onDelete ? (
          <Button title="Delete routine" variant="danger" className="mt-3" onPress={onDelete} />
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

      <RoutineAiEdit
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
    <View className="flex-1">
      <Text variant="caption" className="mb-1">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={range ? '8-12' : '-'}
        placeholderTextColor="#78716c"
        className={smallInput}
      />
    </View>
  );
}
