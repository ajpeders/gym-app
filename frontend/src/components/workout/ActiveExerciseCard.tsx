import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { SessionExercise, SetInput, Units } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { ProgressionNudge } from '@/components/workout/ProgressionNudge';
import { notifyNow } from '@/lib/notifications';
import { formatClock, formatDurationSeconds, formatLoad, formatRepRange, formatTimeOfDay, titleCase, muscleLabel } from '@/lib/format';
import { plateHint } from '@/lib/plates';

interface Props {
  sessionExercise: SessionExercise;
  units: Units;
  quickButtons: boolean;
  onAddSet: (input: SetInput) => Promise<void>;
  onRemoveSet: (setId: string) => Promise<void>;
  onRemoveExercise: () => void;
  /** Swap the movement, keeping the sets. Omitted where swapping makes no sense. */
  onSwapExercise?: () => void;
}

// Sized for a thumb between sets, not a fingertip at a desk.
const numInput =
  'min-h-[56px] w-full rounded-xl border border-iron-700 bg-iron-950 px-2 py-2 text-center text-xl font-bold text-iron-50';

export function ActiveExerciseCard({
  sessionExercise,
  units,
  quickButtons,
  onAddSet,
  onRemoveSet,
  onRemoveExercise,
  onSwapExercise,
}: Props) {
  const router = useRouter();
  const sets = sessionExercise.sets ?? [];
  // Rest is timed between sets and stored on the NEXT set (see SetInput.rest_seconds):
  // an offline-queued set has no server id to PATCH, so recording it forward
  // keeps it to a single write.
  const [restStartedAt, setRestStartedAt] = useState<number | null>(null);
  const [pendingRest, setPendingRest] = useState<number | null>(null);
  const [restElapsed, setRestElapsed] = useState(0);
  const restStartedRef = useRef<number | null>(null);
  restStartedRef.current = restStartedAt;

  // Tick only while resting, so an idle card isn't re-rendering every second.
  useEffect(() => {
    if (restStartedAt == null) return;
    setRestElapsed(Math.floor((Date.now() - restStartedAt) / 1000));
    const id = setInterval(() => {
      const start = restStartedRef.current;
      if (start != null) setRestElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [restStartedAt]);


  function toggleRest() {
    if (restStartedAt == null) {
      setPendingRest(null);
      setRestStartedAt(Date.now());
      return;
    }
    setPendingRest(Math.max(0, Math.floor((Date.now() - restStartedAt) / 1000)));
    setRestStartedAt(null);
  }
  // How this movement is logged: load x reps, reps only, or a timed hold.
  const kind = sessionExercise.exercise?.tracking_type ?? 'weight_reps';
  const isTimed = kind === 'time' || sessionExercise.target_duration_seconds != null;
  const isBodyweight = kind === 'bodyweight';
  const last = sets[sets.length - 1];
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState('');
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('');
  const [saving, setSaving] = useState(false);

  const name = sessionExercise.exercise?.name ?? 'Exercise';
  const typedWeight = weight.trim() === '' ? null : parseFloat(weight);
  const platesFor = plateHint(
    typedWeight != null && !Number.isNaN(typedWeight) ? typedWeight : (last?.weight ?? null),
    units,
  );
  // A plan target is a set worth offering before anything is logged: the
  // quick button used to appear only once a set existed, which read as a
  // toggle that did nothing on a first-ever exercise.
  const target =
    !isTimed && sessionExercise.target_reps != null
      ? { reps: sessionExercise.target_reps, weight: sessionExercise.target_weight ?? null }
      : null;
  // Tell them when the planned rest is up — the phone is in a pocket by then,
  // which is the entire reason a timer on screen isn't enough. Fires once per
  // rest, and only if the plan actually specified one.
  // A plan that says nothing about rest gets the usual 90 s rather than no
  // alert at all.
  const plannedRest = sessionExercise.rest_seconds ?? 90;
  const notifiedFor = useRef<number | null>(null);
  useEffect(() => {
    if (restStartedAt == null || plannedRest == null) return;
    if (restElapsed < plannedRest) return;
    if (notifiedFor.current === restStartedAt) return;
    notifiedFor.current = restStartedAt;
    void notifyNow('Rest is up', `${name} — next set.`);
  }, [restStartedAt, restElapsed, plannedRest, name]);

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
    sessionExercise.target_weight != null
      ? `@ ${sessionExercise.target_weight}${
          sessionExercise.target_weight_max != null
            ? `–${sessionExercise.target_weight_max}`
            : ''
        }${units}`
      : null,
    sessionExercise.target_duration_seconds != null
      ? `${sessionExercise.target_duration_seconds}${
          sessionExercise.target_duration_seconds_max != null
            ? `–${sessionExercise.target_duration_seconds_max}`
            : ''
        } sec`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  async function submit(input: SetInput) {
    Keyboard.dismiss();
    setSaving(true);
    try {
      // A rest still running when the set is logged counts up to this moment.
      const rest =
        restStartedAt != null
          ? Math.max(0, Math.floor((Date.now() - restStartedAt) / 1000))
          : pendingRest;
      await onAddSet(rest != null ? { ...input, rest_seconds: rest } : input);
      setRestStartedAt(null);
      setPendingRest(null);
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
              {/* Part of a superset: alternate with the other exercises
                * carrying the same letter, and take one rest for the group. */}
              {sessionExercise.superset_group ? (
                <View className="mr-1.5 rounded bg-brand/20 px-1.5 py-0.5">
                  <Text variant="caption" className="font-black text-brand">
                    {sessionExercise.superset_group}
                  </Text>
                </View>
              ) : null}
              <Text variant="subheading" numberOfLines={1} className="flex-shrink">
                {name}
              </Text>
              <Ionicons
                name="information-circle-outline"
                size={15}
                color="#b6d69a"
                style={{ marginLeft: 5 }}
              />
            </View>
          {targetLabel ? (
            <Text variant="caption" numberOfLines={1} className="mt-0.5 font-semibold text-brand">
              Target: {targetLabel}
            </Text>
          ) : sessionExercise.exercise?.primary_muscles?.length ? (
            <Text variant="caption" numberOfLines={1} className="mt-0.5">
              {sessionExercise.exercise.primary_muscles.map(muscleLabel).join(', ')}
            </Text>
          ) : null}
          </View>
        </Pressable>
        {onSwapExercise ? (
          <Pressable
            onPress={onSwapExercise}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Swap exercise"
            className="ml-2 h-9 w-9 items-center justify-center rounded-lg bg-brand/10 active:opacity-60">
            <Ionicons name="swap-horizontal" size={17} color="#b6d69a" />
          </Pressable>
        ) : null}
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
            <View className="w-10" />
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
                <Ionicons
                  name={s.pending ? 'cloud-upload-outline' : 'checkmark-circle'}
                  size={14}
                  color={s.pending ? '#fbbf24' : '#10b981'}
                  style={{ marginRight: 4 }}
                />
                <Pressable
                  onPress={() => onRemoveSet(s.id)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove set ${i + 1}`}
                  className="h-10 w-10 items-center justify-center rounded-lg active:bg-red-500/10">
                  <Ionicons name="close" size={18} color="#ef4444" />
                </Pressable>
              </View>
              {s.rest_seconds != null ? (
                <Text variant="caption" className="mt-1 pl-10 text-iron-500">
                  {formatClock(s.rest_seconds)} rest before
                </Text>
              ) : null}
              {s.completed_at ? (
                <Text variant="caption" className="mt-1 pl-10 text-iron-500">
                  Logged {formatTimeOfDay(s.completed_at)}
                </Text>
              ) : null}
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

      <ProgressionNudge show={sessionExercise.cleared_rep_range} />

      {/* input row */}
      <View className="mt-3 flex-row items-end gap-2">
        {isTimed ? (
          <View className="flex-1">
            <Text variant="caption" className="mb-1">
              Time (sec)
            </Text>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              accessibilityLabel="Seconds"
              placeholder={last?.duration_seconds != null ? String(last.duration_seconds) : '30'}
              placeholderTextColor="#929b89"
              selectionColor="#b6d69a"
              className={numInput}
            />
          </View>
        ) : (
          <>
            <View className="flex-1">
              <Text variant="caption" className="mb-1">
                {isBodyweight ? `+Wt (${units})` : `Weight (${units})`}
              </Text>
              <TextInput
                value={weight}
                onChangeText={setWeight}
                keyboardType="decimal-pad"
                // The visible label isn't tied to the field, so a screen
                // reader (and any test) would otherwise announce it as an
                // unnamed box whose placeholder changes to the last set's
                // weight after every log.
                accessibilityLabel={isBodyweight ? 'Added weight' : 'Weight'}
                placeholder={last?.weight != null ? String(last.weight) : 'BW'}
                placeholderTextColor="#929b89"
                selectionColor="#b6d69a"
                className={numInput}
              />
            </View>
            <View className="flex-1">
              <Text variant="caption" className="mb-1">
                Reps
              </Text>
              <TextInput
                value={reps}
                onChangeText={setReps}
                keyboardType="number-pad"
                accessibilityLabel="Reps"
                placeholder={last?.reps != null ? String(last.reps) : '0'}
                placeholderTextColor="#929b89"
                selectionColor="#b6d69a"
                className={numInput}
              />
            </View>
          </>
        )}
        <View className="w-20">
          <Text variant="caption" className="mb-1">
            RPE
          </Text>
          <TextInput
            value={rpe}
            onChangeText={setRpe}
            keyboardType="decimal-pad"
            accessibilityLabel="RPE"
            placeholder="-"
            placeholderTextColor="#929b89"
            selectionColor="#b6d69a"
            className={numInput}
          />
        </View>
      </View>
      {/* RPE appears for the first time here, where the user types it. */}
      <Text variant="caption" className="mt-1.5 text-iron-500">
        RPE — Rate of Perceived Exertion: 1 (easy) to 10 (max).
      </Text>
      {/* What to put on the bar for the number in the box (or the last set's).
        * Works offline; it is arithmetic, not a request. */}
      {!isTimed && !isBodyweight && platesFor != null ? (
        <Text variant="caption" className="mt-1.5 text-iron-400">
          {platesFor}
        </Text>
      ) : null}
      {/* The one button that matters mid-workout: full width, thumb height. */}
      <Pressable
        disabled={saving}
        onPress={addFromInputs}
        accessibilityRole="button"
        accessibilityLabel="Log set"
        className="mt-2 min-h-[56px] items-center justify-center rounded-xl bg-brand px-3 active:bg-brand-600">
        <Text numberOfLines={1} className="text-lg font-black text-iron-950">
          Log set
        </Text>
      </Pressable>

      {/* rest timer — counts up; tap to start, tap again to stop. The result
          is saved with the next set logged. */}
      <Pressable
        onPress={toggleRest}
        accessibilityLabel={restStartedAt != null ? 'Stop rest timer' : 'Start rest timer'}
        className={`mt-2 min-h-[44px] flex-row items-center justify-center rounded-lg border px-3 py-2 active:opacity-70 ${
          restStartedAt != null
            ? 'border-brand bg-brand/15'
            : 'border-iron-700 bg-iron-950'
        }`}>
        <Ionicons
          name={restStartedAt != null ? 'stop-circle-outline' : 'timer-outline'}
          size={16}
          color={restStartedAt != null ? '#b6d69a' : '#b0b6a8'}
        />
        <Text
          className={`ml-1.5 text-sm font-bold ${
            restStartedAt != null ? 'text-brand' : 'text-iron-300'
          }`}>
          {restStartedAt != null
            ? `Resting ${formatClock(restElapsed)} — tap to stop`
            : pendingRest != null
              ? `Rested ${formatClock(pendingRest)} — saves with next set`
              : 'Start rest'}
        </Text>
      </Pressable>

      {/* optional per-set note */}
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note for this set (optional)"
        placeholderTextColor="#929b89"
        selectionColor="#b6d69a"
        className="mt-2 min-h-[40px] rounded-lg border border-iron-700 bg-iron-950 px-3 py-2 text-sm text-iron-50"
      />

      {/* quick-add: repeat the last set, or log the plan's target before
        * there is one. One tap, no typing. */}
      {quickButtons && last ? (
        <View className="mt-2 flex-row gap-2">
          <Pressable
            disabled={saving}
            onPress={repeatLast}
            accessibilityRole="button"
            accessibilityLabel="Log the same set again"
            className="min-h-[48px] flex-1 flex-row items-center justify-center rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 active:opacity-70">
            <Ionicons name="repeat" size={18} color="#b6d69a" />
            <Text className="ml-2 text-base font-bold text-brand">
              {isTimed
                ? formatDurationSeconds(last.duration_seconds)
                : `${formatLoad(last.weight, units)} x ${last.reps ?? '-'}`}
            </Text>
          </Pressable>
        </View>
      ) : quickButtons && target ? (
        <View className="mt-2 flex-row gap-2">
          <Pressable
            disabled={saving}
            onPress={() =>
              void submit({ reps: target.reps, weight: target.weight, set_type: 'working' })
            }
            accessibilityRole="button"
            accessibilityLabel="Log the target set"
            className="min-h-[48px] flex-1 flex-row items-center justify-center rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 active:opacity-70">
            <Ionicons name="flash-outline" size={18} color="#b6d69a" />
            <Text className="ml-2 text-base font-bold text-brand">
              {`Log target ${formatLoad(target.weight, units)} x ${target.reps}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}
