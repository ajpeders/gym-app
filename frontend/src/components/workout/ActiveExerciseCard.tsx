import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import type { SetInput, Units, WorkoutExercise } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { titleCase } from '@/lib/format';

interface Props {
  workoutExercise: WorkoutExercise;
  units: Units;
  quickButtons: boolean;
  onAddSet: (input: SetInput) => Promise<void>;
  onRemoveSet: (setId: string) => Promise<void>;
  onRemoveExercise: () => void;
}

const numInput =
  'w-16 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-2 text-center text-base text-neutral-900 dark:text-white';

export function ActiveExerciseCard({
  workoutExercise,
  units,
  quickButtons,
  onAddSet,
  onRemoveSet,
  onRemoveExercise,
}: Props) {
  const sets = workoutExercise.sets ?? [];
  const last = sets[sets.length - 1];
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState('');
  const [saving, setSaving] = useState(false);

  const name = workoutExercise.exercise?.name ?? 'Exercise';

  async function submit(input: SetInput) {
    setSaving(true);
    try {
      await onAddSet(input);
      setReps('');
      setWeight('');
      setRpe('');
    } finally {
      setSaving(false);
    }
  }

  async function addFromInputs() {
    const r = parseInt(reps, 10);
    const w = parseFloat(weight);
    if (Number.isNaN(r) || Number.isNaN(w)) return;
    await submit({
      reps: r,
      weight: w,
      rpe: rpe ? parseFloat(rpe) : null,
      set_type: 'normal',
    });
  }

  async function repeatLast() {
    if (!last) return;
    await submit({
      reps: last.reps,
      weight: last.weight,
      rpe: last.rpe ?? null,
      set_type: last.set_type ?? 'normal',
    });
  }

  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between">
        <Text variant="subheading" numberOfLines={1} className="flex-1">
          {name}
        </Text>
        <Pressable onPress={onRemoveExercise} hitSlop={8} className="active:opacity-60">
          <Text className="text-sm text-red-500 font-semibold">Remove</Text>
        </Pressable>
      </View>
      {workoutExercise.exercise?.primary_muscles?.length ? (
        <Text variant="muted" numberOfLines={1}>
          {workoutExercise.exercise.primary_muscles.map(titleCase).join(', ')}
        </Text>
      ) : null}

      {/* logged sets */}
      {sets.length > 0 ? (
        <View className="mt-3 gap-1.5">
          <View className="flex-row px-1">
            <Text variant="caption" className="w-10">
              SET
            </Text>
            <Text variant="caption" className="flex-1">
              WEIGHT
            </Text>
            <Text variant="caption" className="flex-1">
              REPS
            </Text>
            <Text variant="caption" className="w-12">
              RPE
            </Text>
            <View className="w-8" />
          </View>
          {sets.map((s, i) => (
            <View
              key={s.id}
              className="flex-row items-center rounded-lg bg-neutral-100 dark:bg-neutral-800 px-1 py-2">
              <Text variant="label" className="w-10 text-center">
                {i + 1}
              </Text>
              <Text variant="body" className="flex-1">
                {s.weight} {units}
              </Text>
              <Text variant="body" className="flex-1">
                {s.reps}
              </Text>
              <Text variant="body" className="w-12">
                {s.rpe ?? '—'}
              </Text>
              <Pressable
                onPress={() => onRemoveSet(s.id)}
                hitSlop={8}
                className="w-8 items-center active:opacity-60">
                <Text className="text-red-500 text-base">✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text variant="muted" className="mt-2">
          No sets logged yet.
        </Text>
      )}

      {/* input row */}
      <View className="mt-3 flex-row items-end gap-2">
        <View>
          <Text variant="caption" className="mb-1">
            Weight ({units})
          </Text>
          <TextInput
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            placeholder={last ? String(last.weight) : '0'}
            placeholderTextColor="#9ca3af"
            className={numInput}
          />
        </View>
        <View>
          <Text variant="caption" className="mb-1">
            Reps
          </Text>
          <TextInput
            value={reps}
            onChangeText={setReps}
            keyboardType="number-pad"
            placeholder={last ? String(last.reps) : '0'}
            placeholderTextColor="#9ca3af"
            className={numInput}
          />
        </View>
        <View>
          <Text variant="caption" className="mb-1">
            RPE
          </Text>
          <TextInput
            value={rpe}
            onChangeText={setRpe}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor="#9ca3af"
            className={numInput}
          />
        </View>
        <Pressable
          disabled={saving}
          onPress={addFromInputs}
          className="flex-1 items-center justify-center rounded-lg bg-brand py-3 active:bg-brand-600">
          <Text className="font-semibold text-white">Log set</Text>
        </Pressable>
      </View>

      {/* quick-add buttons */}
      {quickButtons && last ? (
        <View className="mt-2 flex-row gap-2">
          <Pressable
            disabled={saving}
            onPress={repeatLast}
            className="flex-1 items-center rounded-lg border border-brand py-2 active:opacity-70">
            <Text className="text-sm font-semibold text-brand">
              ↻ Repeat last ({last.weight}
              {units} × {last.reps})
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}
