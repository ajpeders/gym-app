import { useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { SessionExercise, SetInput, Units } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import {
  formatDurationSeconds,
  formatLoad,
  formatRepRange,
  formatTimeOfDay,
  titleCase,
} from '@/lib/format';

interface Props {
  sessionExercise: SessionExercise;
  units: Units;
  quickButtons: boolean;
  onAddSet: (input: SetInput) => Promise<void>;
  onRemoveSet: (setId: string) => Promise<void>;
  onRemoveExercise: () => void;
}

const numInput =
  'min-h-[44px] w-16 rounded-lg border border-iron-700 bg-iron-950 px-2 py-2 text-center text-base text-iron-50';

export function ActiveExerciseCard({
  sessionExercise,
  units,
  quickButtons,
  onAddSet,
  onRemoveSet,
  onRemoveExercise,
}: Props) {
  const router = useRouter();
  const sets = sessionExercise.sets ?? [];
  // How this movement is logged: load x reps, reps only, or a timed hold.
  const kind = sessionExercise.exercise?.tracking_type ?? 'weight_reps';
  const isTimed = kind === 'time';
  const isBodyweight = kind === 'bodyweight';
  const last = sets[sets.length - 1];
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState('');
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('');
  const [saving, setSaving] = useState(false);

  const name = sessionExercise.exercise?.name ?? 'Exercise';

  // Target snapshot from the plan workout this session started from, e.g. "3 x 8-12 @ 25kg".
  const targetReps = formatRepRange(
    sessionExercise.target_reps ?? null,
    sessionExercise.target_reps_max ?? null,
  );
  const targetLabel = [
    sessionExercise.target_sets != null && targetReps
      ? `${sessionExercise.target_sets} x ${targetReps}`
      : sessionExercise.target_sets != null
        ? `${sessionExercise.target_sets} sets`
        : targetReps
          ? `${targetReps} reps`
          : null,
    sessionExercise.target_weight != null ? `@ ${sessionExercise.target_weight}${units}` : null,
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
      setDuration('');
    } finally {
      setSaving(false);
    }
  }

  async function addFromInputs() {
    const rpeVal = rpe ? parseFloat(rpe) : null;

    // Timed holds (plank, dead hang) record seconds, not reps or load.
    if (isTimed) {
      const secs = parseInt(duration, 10);
      if (Number.isNaN(secs)) return;
      await submit({
        duration_seconds: secs,
        rpe: rpeVal,
        set_type: 'working',
        notes: note.trim() || null,
      });
      return;
    }

    const r = parseInt(reps, 10);
    if (Number.isNaN(r)) return;
    // Weight stays optional everywhere; bodyweight moves just don't ask for it
    // up front (added load can still be typed into the +Wt field).
    const w = weight.trim() === '' ? null : parseFloat(weight);
    await submit({
      reps: r,
      weight: w != null && Number.isNaN(w) ? null : w,
      rpe: rpeVal,
      set_type: 'working',
      notes: note.trim() || null,
    });
  }

  async function repeatLast() {
    if (!last) return;
    await submit({
      reps: last.reps,
      weight: last.weight,
      duration_seconds: last.duration_seconds ?? null,
      rpe: last.rpe ?? null,
      set_type: last.set_type ?? 'working',
    });
  }

  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => router.push(`/exercise/${sessionExercise.exercise_id}`)}
          accessibilityRole="button"
          accessibilityLabel={`How to do ${name}`}
          className="mr-3 flex-1 flex-row items-center active:opacity-70">
          <ExerciseThumb images={sessionExercise.exercise?.images} size={40} radius={8} />
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
          ) : sessionExercise.exercise?.primary_muscles?.length ? (
            <Text variant="caption" numberOfLines={1} className="mt-0.5">
              {sessionExercise.exercise.primary_muscles.map(titleCase).join(', ')}
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
            {isTimed ? (
              <Text variant="caption" className="flex-1">
                Time
              </Text>
            ) : (
              <>
                <Text variant="caption" className="flex-1">
                  {isBodyweight ? '+Wt' : 'Weight'}
                </Text>
                <Text variant="caption" className="flex-1">
                  Reps
                </Text>
              </>
            )}
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
                {isTimed ? (
                  <Text variant="body" className="flex-1">
                    {formatDurationSeconds(s.duration_seconds)}
                  </Text>
                ) : (
                  <>
                    <Text variant="body" className="flex-1">
                      {formatLoad(s.weight, units)}
                    </Text>
                    <Text variant="body" className="flex-1">
                      {s.reps ?? '-'}
                    </Text>
                  </>
                )}
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
                ) : s.completed_at ? (
                  <Text variant="caption" className="mr-1 text-iron-500">
                    {formatTimeOfDay(s.completed_at)}
                  </Text>
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
        {isTimed ? (
          <View>
            <Text variant="caption" className="mb-1">
              Time (sec)
            </Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              placeholder={last?.duration_seconds != null ? String(last.duration_seconds) : '30'}
              placeholderTextColor="#78716c"
              selectionColor="#f97316"
              className={numInput}
            />
          </View>
        ) : (
          <>
            <View>
              <Text variant="caption" className="mb-1">
                {isBodyweight ? `+Wt (${units})` : `Weight (${units})`}
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
                placeholder={last?.reps != null ? String(last.reps) : '0'}
                placeholderTextColor="#78716c"
                selectionColor="#f97316"
                className={numInput}
              />
            </View>
          </>
        )}
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
              {isTimed
                ? formatDurationSeconds(last.duration_seconds)
                : `${formatLoad(last.weight, units)} x ${last.reps ?? '-'}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}
