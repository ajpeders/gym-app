import { useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { SetInput, Units, WorkoutExercise } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { formatLoad, formatRepRange, titleCase } from '@/lib/format';

interface Props {
  workoutExercise: WorkoutExercise;
  units: Units;
  quickButtons: boolean;
  onAddSet: (input: SetInput) => Promise<void>;
  onRemoveSet: (setId: string) => Promise<void>;
  onRemoveExercise: () => void;
}

const numInput =
  'min-h-[44px] w-16 rounded-lg border border-iron-700 bg-iron-950 px-2 py-2 text-center text-base text-iron-50';

export function ActiveExerciseCard({
  workoutExercise,
  units,
  quickButtons,
  onAddSet,
  onRemoveSet,
  onRemoveExercise,
}: Props) {
  const router = useRouter();
  const sets = workoutExercise.sets ?? [];
  const last = sets[sets.length - 1];
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const name = workoutExercise.exercise?.name ?? 'Exercise';

  // Target snapshot from the routine this workout started from, e.g. "3 x 8-12 @ 25kg".
  const targetReps = formatRepRange(
    workoutExercise.target_reps ?? null,
    workoutExercise.target_reps_max ?? null,
  );
  const targetLabel = [
    workoutExercise.target_sets != null && targetReps
      ? `${workoutExercise.target_sets} x ${targetReps}`
      : workoutExercise.target_sets != null
        ? `${workoutExercise.target_sets} sets`
        : targetReps
          ? `${targetReps} reps`
          : null,
    workoutExercise.target_weight != null ? `@ ${workoutExercise.target_weight}${units}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  async function submit(input: SetInput) {
    Keyboard.dismiss();
    setSaving(true);
    try {
      await onAddSet(input);
      setReps('');
      setWeight('');
      setRpe('');
      setNote('');
    } finally {
      setSaving(false);
    }
  }

  async function addFromInputs() {
    const r = parseInt(reps, 10);
    if (Number.isNaN(r)) return;
    // Weight is optional — blank means bodyweight (chin-ups, planks, …).
    const w = weight.trim() === '' ? null : parseFloat(weight);
    await submit({
      reps: r,
      weight: w != null && Number.isNaN(w) ? null : w,
      rpe: rpe ? parseFloat(rpe) : null,
      set_type: 'working',
      notes: note.trim() || null,
    });
  }

  async function repeatLast() {
    if (!last) return;
    await submit({
      reps: last.reps,
      weight: last.weight,
      rpe: last.rpe ?? null,
      set_type: last.set_type ?? 'working',
    });
  }

  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => router.push(`/exercise/${workoutExercise.exercise_id}`)}
          accessibilityRole="button"
          accessibilityLabel={`How to do ${name}`}
          className="mr-3 flex-1 flex-row items-center active:opacity-70">
          <ExerciseThumb images={workoutExercise.exercise?.images} size={40} radius={8} />
          <View className="ml-3 flex-1">
            <View className="flex-row items-center">
              <Text variant="subheading" numberOfLines={1} className="flex-shrink">
                {name}
              </Text>
              <Ionicons
                name="information-circle-outline"
                size={15}
                color="#f97316"
                style={{ marginLeft: 5 }}
              />
            </View>
          {targetLabel ? (
            <Text variant="caption" numberOfLines={1} className="mt-0.5 font-semibold text-brand">
              Target: {targetLabel}
            </Text>
          ) : workoutExercise.exercise?.primary_muscles?.length ? (
            <Text variant="caption" numberOfLines={1} className="mt-0.5">
              {workoutExercise.exercise.primary_muscles.map(titleCase).join(', ')}
            </Text>
          ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={onRemoveExercise}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Remove exercise"
          className="ml-2 h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 active:opacity-60">
          <Ionicons name="trash-outline" size={17} color="#ef4444" />
        </Pressable>
      </View>

      {/* logged sets */}
      {sets.length > 0 ? (
        <View className="mt-3 gap-1.5">
          <View className="flex-row px-1">
            <Text variant="caption" className="w-10">
              SET
            </Text>
            <Text variant="caption" className="flex-1">
              Weight
            </Text>
            <Text variant="caption" className="flex-1">
              Reps
            </Text>
            <Text variant="caption" className="w-12">
              RPE
            </Text>
            <View className="w-8" />
          </View>
          {sets.map((s, i) => (
            <View key={s.id} className="rounded-lg bg-iron-850 px-1 py-2">
              <View className="flex-row items-center">
                <Text variant="label" className="w-10 text-center">
                  {i + 1}
                </Text>
                <Text variant="body" className="flex-1">
                  {formatLoad(s.weight, units)}
                </Text>
                <Text variant="body" className="flex-1">
                  {s.reps}
                </Text>
                <Text variant="body" className="w-12">
                  {s.rpe ?? '-'}
                </Text>
                {s.pending ? (
                  <Ionicons
                    name="cloud-upload-outline"
                    size={14}
                    color="#a8a29e"
                    style={{ marginRight: 4 }}
                  />
                ) : null}
                <Pressable
                  onPress={() => onRemoveSet(s.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove set ${i + 1}`}
                  className="w-8 items-center active:opacity-60">
                  <Ionicons name="close" size={17} color="#ef4444" />
                </Pressable>
              </View>
              {s.notes ? (
                <Text variant="caption" className="mt-1 pl-10 text-iron-400" numberOfLines={2}>
                  {s.notes}
                </Text>
              ) : null}
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
            placeholder={last?.weight != null ? String(last.weight) : 'BW'}
            placeholderTextColor="#78716c"
            selectionColor="#f97316"
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
            placeholderTextColor="#78716c"
            selectionColor="#f97316"
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
            placeholder="-"
            placeholderTextColor="#78716c"
            selectionColor="#f97316"
            className={numInput}
          />
        </View>
        <Pressable
          disabled={saving}
          onPress={addFromInputs}
          className="min-h-[44px] flex-1 items-center justify-center rounded-lg bg-brand px-3 py-3 active:bg-brand-600">
          <Text className="font-bold text-iron-950">Log set</Text>
        </Pressable>
      </View>

      {/* optional per-set note */}
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note for this set (optional)"
        placeholderTextColor="#78716c"
        selectionColor="#f97316"
        className="mt-2 min-h-[40px] rounded-lg border border-iron-700 bg-iron-950 px-3 py-2 text-sm text-iron-50"
      />

      {/* quick-add buttons */}
      {quickButtons && last ? (
        <View className="mt-2 flex-row gap-2">
          <Pressable
            disabled={saving}
            onPress={repeatLast}
            className="flex-1 flex-row items-center justify-center rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 active:opacity-70">
            <Ionicons name="repeat" size={16} color="#f97316" />
            <Text className="ml-1.5 text-sm font-bold text-brand">
              {formatLoad(last.weight, units)} x {last.reps}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}
