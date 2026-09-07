import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { aiParseErrorMessage } from '@/api/errors';
import type {
  Exercise,
  ParsedMatch,
  ParsedWorkout,
  ParseWorkoutResult,
  Split,
  SplitImportInput,
  SplitImportWorkout,
} from '@/api/types';
import { formatRepRange } from '@/lib/format';
import { importKey, newImportNonce } from '@/lib/import-key';
import { parseStructuredPlan, type StructuredPlan } from '@/lib/plan-parse';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BottomAction } from '@/components/ui/BottomAction';
import { FormField } from '@/components/ui/FormField';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { FormError } from '@/components/ui/Feedback';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';
import { WeekdayPicker } from '@/components/WeekdayPicker';

type Phase = 'input' | 'parsing' | 'review' | 'saving' | 'done';
type ResolveMode = 'matched' | 'swapped' | 'custom';

interface ExerciseResolution {
  exercise_id: string | null;
  exercise_name: string;
  match: ParsedMatch;
  mode: ResolveMode;
}

interface ExerciseDraft {
  sets: string;
  reps: string;
  weight: string;
  duration: string;
  notes: string;
}

interface PickerState {
  dayIdx: number;
  exIdx: number;
}

const PLACEHOLDER =
  'Paste your workout split here — plain notes, a CSV, or a JSON export.';

const MATCH_META: Record<ParsedMatch, { icon: string; label: string; className: string }> = {
  exact: { icon: '✓', label: 'matched', className: 'border-green-500/40 bg-green-500/10 text-green-300' },
  fuzzy: { icon: '~', label: 'close match', className: 'border-brand/40 bg-brand/10 text-brand' },
  none: { icon: '⚠', label: 'will be created', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
};

function exKey(dayIdx: number, exIdx: number) {
  return `${dayIdx}-${exIdx}`;
}

function formatNumberRange(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  if (low == null) return '';
  return high != null && high !== low ? `${low}-${high}` : String(low);
}

function parseNumberRange(value: string, integer = false): [number | null, number | null] {
  const normalized = value.trim().replace(/[–—]/g, '-');
  if (!normalized) return [null, null];
  const parts = normalized.split(/\s*(?:-|to)\s*/i).filter(Boolean);
  const parse = integer ? (part: string) => parseInt(part, 10) : (part: string) => parseFloat(part);
  const low = parse(parts[0]);
  const high = parts.length > 1 ? parse(parts[1]) : NaN;
  if (!Number.isFinite(low)) return [null, null];
  if (!Number.isFinite(high) || high === low) return [low, null];
  return low < high ? [low, high] : [high, low];
}

function MatchBadge({ match }: { match: ParsedMatch }) {
  const meta = MATCH_META[match];
  return (
    <View className={`flex-row items-center rounded-md border px-2 py-0.5 ${meta.className}`}>
      <Text className={`text-xs font-bold ${meta.className.split(' ').pop()}`}>
        {meta.icon} {meta.label}
      </Text>
    </View>
  );
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scheduleLabel(workout: ParsedWorkout): string {
  if (workout.rest_day) return 'Rest';
  if (workout.floating) return workout.optional ? 'Optional / floating' : 'Floating';
  if (workout.weekdays.length === 0) return 'Unscheduled';
  return workout.weekdays.map((day) => WEEKDAY_LABELS[day] ?? '?').join(' / ');
}

export default function WorkoutImportScreen() {
  const router = useRouter();

  const [text, setText] = useState('');
  // A logged history from another app — separate from the plan paste above,
  // because it creates sessions rather than workouts.
  const [csvText, setCsvText] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseWorkoutResult | null>(null);

  const [includeDay, setIncludeDay] = useState<Record<number, boolean>>({});
  const [includeExercise, setIncludeExercise] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [resolutions, setResolutions] = useState<Record<string, ExerciseResolution>>({});
  const [exerciseDrafts, setExerciseDrafts] = useState<Record<string, ExerciseDraft>>({});
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [customPicker, setCustomPicker] = useState<PickerState | null>(null);
  const [customName, setCustomName] = useState('');

  const [saveTotal, setSaveTotal] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);
  /** Minted per parse; half of the idempotency key. See lib/import-key.ts. */
  const [nonce, setNonce] = useState(() => newImportNonce());
  /** Plans already on the account, to offer updating one instead of adding another. */
  const [existingSplits, setExistingSplits] = useState<Split[]>([]);
  const [replaceSplitId, setReplaceSplitId] = useState<number | null>(null);

  // Characters of model output received so far — drives the parse progress bar.
  const [received, setReceived] = useState(0);

  const units = result?.units ?? 'kg';

  const saveableWorkouts = useMemo(() => {
    if (!result) return [];
    return result.workouts.filter((r, di) => {
      if (!includeDay[di] || r.rest_day) return false;
      return r.exercises.some((_, ei) => includeExercise[exKey(di, ei)] !== false);
    });
  }, [result, includeDay, includeExercise]);
  const saveableCount = saveableWorkouts.length;

  /**
   * A structured plan, matched to the catalog and shaped like an AI parse, so
   * the whole review screen below works on it unchanged. No model is called:
   * a CSV or a JSON export already says what the AI would have had to infer.
   */
  async function readStructured(plan: StructuredPlan): Promise<ParseWorkoutResult> {
    const names = [...new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.name)))];
    const matches = await api.matchExercises(names);
    const byName = new Map(matches.map((m) => [m.name, m]));
    return {
      provider: plan.source,
      model: plan.source === 'csv' ? 'CSV' : 'JSON',
      units: 'kg',
      latency_ms: 0,
      name: plan.name,
      notes: plan.notes,
      rules: plan.rules,
      workouts: plan.days.map((d) => ({
        name: d.name,
        notes: d.notes,
        rest_day: false,
        weekdays: d.weekdays,
        floating: d.floating,
        optional: false,
        exercises: d.exercises.map((e) => {
          const m = byName.get(e.name);
          return {
            exercise_name: e.name,
            exercise_id: m?.exercise_id ?? null,
            matched_name: m?.matched_name ?? null,
            match: m?.match ?? 'none',
            target_sets: e.sets,
            target_reps: e.reps,
            target_reps_max: e.repsMax,
            target_weight: e.weight,
            target_weight_max: null,
            target_duration_seconds: null,
            target_duration_seconds_max: null,
            notes: e.notes,
          };
        }),
      })),
    };
  }

  async function onParse() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setReceived(0);
    setPhase('parsing');
    try {
      // Already structured? Read it directly — faster, exact, and it doesn't
      // need an AI provider to be configured at all.
      const structured = parseStructuredPlan(trimmed);
      const res = structured
        ? await readStructured(structured)
        : await api.parseWorkoutStream(trimmed, (p) => setReceived(p.received));
      const days: Record<number, boolean> = {};
      const exs: Record<string, boolean> = {};
      const exp: Record<number, boolean> = {};
      const resolved: Record<string, ExerciseResolution> = {};
      const drafts: Record<string, ExerciseDraft> = {};
      res.workouts.forEach((r, di) => {
        days[di] = !r.rest_day; // rest days default to excluded from saving
        // Keep the review scannable: open the first real workout and leave the
        // rest collapsed until the user chooses to inspect them.
        exp[di] = di === 0 && !r.rest_day;
        r.exercises.forEach((ex, ei) => {
          const key = exKey(di, ei);
          exs[key] = true;
          resolved[key] = {
            exercise_id: ex.exercise_id == null ? null : String(ex.exercise_id),
            exercise_name: ex.matched_name ?? ex.exercise_name,
            match: ex.match,
            mode: ex.exercise_id == null ? 'custom' : 'matched',
          };
          drafts[key] = {
            sets: ex.target_sets == null ? '' : String(ex.target_sets),
            reps: formatRepRange(ex.target_reps, ex.target_reps_max) ?? '',
            weight: formatNumberRange(ex.target_weight, ex.target_weight_max),
            duration: formatNumberRange(
              ex.target_duration_seconds,
              ex.target_duration_seconds_max,
            ),
            notes: ex.notes ?? '',
          };
        });
      });
      setResult(res);
      setIncludeDay(days);
      setIncludeExercise(exs);
      setExpanded(exp);
      setResolutions(resolved);
      setExerciseDrafts(drafts);
      // A fresh parse is a fresh import, even of text imported before.
      setNonce(newImportNonce());
      setReplaceSplitId(null);
      // Offered as "update this plan" rather than adding a near-duplicate
      // beside it — a failure here only costs that option.
      const splits = await api.splits().catch(() => [] as Split[]);
      setExistingSplits(splits);
      const planName = (res.name ?? '').trim().toLowerCase();
      const sameName = splits.find((sp) => sp.name.trim().toLowerCase() === planName);
      if (sameName) setReplaceSplitId(sameName.id);
      setPhase('review');
    } catch (e) {
      setPhase('input');
      setError(aiParseErrorMessage(e));
    }
  }

  async function onImportCsv() {
    const csv = csvText.trim();
    if (!csv) return;
    setCsvBusy(true);
    setCsvResult(null);
    setError(null);
    try {
      const result = await api.importCsv(csv);
      const missed = result.unmatched.length
        ? ` ${result.unmatched.length} movement(s) weren't in the library: ${result.unmatched
            .slice(0, 3)
            .join(', ')}.`
        : '';
      setCsvResult(
        `Imported ${result.sessions_created} sessions and ${result.sets_imported} sets from your ${result.format} export.${missed}`,
      );
      setCsvText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read');
    } finally {
      setCsvBusy(false);
    }
  }

  /**
   * The reviewed plan, exactly as it will be sent. Built separately from the
   * save so the idempotency key can be a hash of it: the same content is a
   * retry, different content is a new import.
   */
  function buildPayload(): SplitImportInput | null {
    if (!result) return null;
    const workouts: SplitImportWorkout[] = [];
    result.workouts.forEach((r, di) => {
      if (!includeDay[di] || r.rest_day) return;
      const exercises = r.exercises
        .map((ex, ei) => ({ ex, ei }))
        .filter(({ ei }) => includeExercise[exKey(di, ei)] !== false)
        .map(({ ex, ei }, order) => {
          const draft = exerciseDrafts[exKey(di, ei)] ?? {
            sets: ex.target_sets == null ? '' : String(ex.target_sets),
            reps: formatRepRange(ex.target_reps, ex.target_reps_max) ?? '',
            weight: formatNumberRange(ex.target_weight, ex.target_weight_max),
            duration: formatNumberRange(
              ex.target_duration_seconds,
              ex.target_duration_seconds_max,
            ),
            notes: ex.notes ?? '',
          };
          const resolution = resolutions[exKey(di, ei)] ?? {
            exercise_id: ex.exercise_id == null ? null : String(ex.exercise_id),
            exercise_name: ex.matched_name ?? ex.exercise_name,
            match: ex.match,
            mode: ex.exercise_id == null ? 'custom' : 'matched',
          };
          const [reps, repsMax] = parseNumberRange(draft.reps, true);
          const [weight, weightMax] = parseNumberRange(draft.weight);
          const [duration, durationMax] = parseNumberRange(draft.duration, true);
          return {
            // No catalog match: the server creates (or reuses) an exercise you
            // own, so nothing is dropped and the shared catalog is untouched.
            exercise_id: resolution.exercise_id == null ? null : Number(resolution.exercise_id),
            custom_name: resolution.exercise_id == null ? resolution.exercise_name : null,
            order,
            target_sets: draft.sets ? parseInt(draft.sets, 10) : null,
            target_reps: reps,
            target_reps_max: repsMax,
            target_weight: weight,
            target_weight_max: weightMax,
            target_duration_seconds: duration,
            target_duration_seconds_max: durationMax,
            notes: draft.notes.trim() || null,
          };
        });
      // A day with everything unchecked yields no exercises — never create an
      // empty workout.
      if (exercises.length === 0) return;
      workouts.push({
        name: r.name.trim() || `Workout ${workouts.length + 1}`,
        notes: r.notes ?? null,
        weekdays: r.floating ? [] : r.weekdays,
        floating: r.floating,
        order: workouts.length,
        exercises,
      });
    });

    return {
      name: result.name?.trim() || 'Imported split',
      notes: result.notes ?? null,
      rules: result.rules ?? [],
      make_active: true,
      replace_split_id: replaceSplitId,
      workouts,
    };
  }

  async function onSave() {
    const payload = buildPayload();
    if (!payload) return;

    setSaveTotal(payload.workouts.length);
    setError(null);
    setPhase('saving');

    try {
      // One call, one transaction. The key means tapping Save again after a
      // timeout finishes the import rather than starting a second one.
      const res = await api.importSplit(payload, importKey(nonce, payload));
      setSavedCount(res.created_workouts + res.updated_workouts);
      const parts: string[] = [];
      if (res.created_workouts) parts.push(`${res.created_workouts} added`);
      if (res.updated_workouts) parts.push(`${res.updated_workouts} updated`);
      if (res.removed_workouts) parts.push(`${res.removed_workouts} removed`);
      if (res.created_exercises) {
        parts.push(
          `${res.created_exercises} new ${res.created_exercises === 1 ? 'exercise' : 'exercises'}`,
        );
      }
      setSavedSummary(parts.join(' · ') || null);
      setPhase('done');
    } catch (e) {
      // Nothing was written — the import is all-or-nothing — so "try again"
      // really does just try again.
      setError(
        e instanceof Error && e.message && !e.message.startsWith('Request failed')
          ? `${e.message} Nothing was saved — you can try again.`
          : 'Saving failed. Nothing was saved — try again.',
      );
      setPhase('review');
    }
  }

  function toggleDay(di: number) {
    setIncludeDay((prev) => ({ ...prev, [di]: !prev[di] }));
  }
  function toggleExpanded(di: number) {
    setExpanded((prev) => ({ ...prev, [di]: !prev[di] }));
  }
  function toggleExercise(di: number, ei: number) {
    setIncludeExercise((prev) => ({ ...prev, [exKey(di, ei)]: !prev[exKey(di, ei)] }));
  }
  function updatePlanName(name: string) {
    setResult((prev) => (prev ? { ...prev, name } : prev));
  }
  function updateWorkout(di: number, patch: Partial<ParsedWorkout>) {
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        workouts: prev.workouts.map((workout, index) =>
          index === di ? { ...workout, ...patch } : workout,
        ),
      };
    });
  }
  function updateExerciseDraft(di: number, ei: number, patch: Partial<ExerciseDraft>) {
    const key = exKey(di, ei);
    setExerciseDrafts((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }
  function moveExercise(di: number, from: number, direction: -1 | 1) {
    const to = from + direction;
    const workout = result?.workouts[di];
    if (!workout || to < 0 || to >= workout.exercises.length) return;

    setResult((prev) => {
      if (!prev) return prev;
      const workouts = [...prev.workouts];
      const exercises = [...workouts[di].exercises];
      [exercises[from], exercises[to]] = [exercises[to], exercises[from]];
      workouts[di] = { ...workouts[di], exercises };
      return { ...prev, workouts };
    });

    const fromKey = exKey(di, from);
    const toKey = exKey(di, to);
    setIncludeExercise((prev) => ({
      ...prev,
      [fromKey]: prev[toKey],
      [toKey]: prev[fromKey],
    }));
    setResolutions((prev) => ({
      ...prev,
      [fromKey]: prev[toKey],
      [toKey]: prev[fromKey],
    }));
    setExerciseDrafts((prev) => ({
      ...prev,
      [fromKey]: prev[toKey],
      [toKey]: prev[fromKey],
    }));
  }
  function removeExercise(di: number, ei: number) {
    setIncludeExercise((prev) => ({ ...prev, [exKey(di, ei)]: false }));
  }
  function selectExercise(exercise: Exercise) {
    if (!picker) return;
    const key = exKey(picker.dayIdx, picker.exIdx);
    setResolutions((prev) => ({
      ...prev,
      [key]: {
        exercise_id: String(exercise.id),
        exercise_name: exercise.name,
        match: 'exact',
        mode: 'swapped',
      },
    }));
    setIncludeExercise((prev) => ({ ...prev, [key]: true }));
    setPicker(null);
  }
  function startCustom(di: number, ei: number) {
    const key = exKey(di, ei);
    const fallback = result?.workouts[di]?.exercises[ei]?.exercise_name ?? '';
    setCustomName(resolutions[key]?.exercise_name ?? fallback);
    setCustomPicker({ dayIdx: di, exIdx: ei });
  }
  function saveCustom() {
    if (!customPicker) return;
    const name = customName.trim();
    if (!name) return;
    const key = exKey(customPicker.dayIdx, customPicker.exIdx);
    setResolutions((prev) => ({
      ...prev,
      [key]: {
        exercise_id: null,
        exercise_name: name,
        match: 'none',
        mode: 'custom',
      },
    }));
    setIncludeExercise((prev) => ({ ...prev, [key]: true }));
    setCustomPicker(null);
    setCustomName('');
  }

  function reset(clearText = false) {
    setResult(null);
    setError(null);
    setPhase('input');
    setIncludeDay({});
    setIncludeExercise({});
    setExpanded({});
    setResolutions({});
    setExerciseDrafts({});
    setPicker(null);
    setCustomPicker(null);
    setCustomName('');
    setReplaceSplitId(null);
    setSavedSummary(null);
    if (clearText) setText('');
  }

  // ---- parsing progress ----
  if (phase === 'parsing') {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Import workouts' }} />
        <ParseProgress received={received} />
      </Screen>
    );
  }

  // ---- success ----
  if (phase === 'done') {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Import workouts' }} />
        <View className="flex-1 items-center justify-center px-6">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full border border-brand/40 bg-brand/10">
            <Ionicons name="checkmark" size={34} color="#5eead4" />
          </View>
          <Text variant="heading" className="text-center">
            Saved {savedCount} {savedCount === 1 ? 'workout' : 'workouts'}
          </Text>
          <Text variant="muted" className="mt-1.5 text-center">
            {savedSummary ?? 'Your workouts are ready. Start a session from any of them.'}
          </Text>
          <View className="mt-6 w-full gap-2">
            <Button title="View workouts" size="lg" onPress={() => router.replace('/workouts')} />
            <Button title="Import another" variant="secondary" onPress={() => reset(true)} />
          </View>
        </View>
      </Screen>
    );
  }

  // ---- review ----
  if (phase === 'review' || phase === 'saving') {
    const saving = phase === 'saving';
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Review import' }} />
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-40">
          <Text variant="muted" className="mb-3">
            Found {result?.workouts.length ?? 0} days
            {result?.provider === 'csv' || result?.provider === 'json'
              ? ` (read straight from your ${result.provider.toUpperCase()} — no AI involved)`
              : ''}
            . Fix names and scheduling, then swap, remove, or create exercises
            before saving.
          </Text>

          <Card className="mb-3 rounded-lg p-4">
            <Text variant="label" className="text-brand">
              Plan name
            </Text>
            <TextInput
              value={result?.name ?? ''}
              onChangeText={updatePlanName}
              editable={!saving}
              placeholder="My split"
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
              className="mt-2 min-h-[50px] rounded-lg border border-iron-700 bg-iron-950 px-3.5 text-base font-bold text-iron-50"
            />
            <Text variant="caption" className="mt-2 text-iron-400">
              This becomes the name of the split that holds all imported workouts.
            </Text>

            {existingSplits.length > 0 ? (
              <View className="mt-4 border-t border-iron-800 pt-3">
                <Text variant="label" className="mb-2 text-brand">
                  Where it goes
                </Text>
                <Pressable
                  disabled={saving}
                  onPress={() => setReplaceSplitId(null)}
                  className="mb-2 flex-row items-center gap-2.5"
                >
                  <Ionicons
                    name={replaceSplitId == null ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={replaceSplitId == null ? '#5eead4' : '#64748b'}
                  />
                  <Text className="flex-1">Create a new plan</Text>
                </Pressable>
                {existingSplits.map((sp) => (
                  <Pressable
                    key={sp.id}
                    disabled={saving}
                    onPress={() => setReplaceSplitId(sp.id)}
                    className="mb-2 flex-row items-center gap-2.5"
                  >
                    <Ionicons
                      name={replaceSplitId === sp.id ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={replaceSplitId === sp.id ? '#5eead4' : '#64748b'}
                    />
                    <Text className="flex-1">Update &ldquo;{sp.name}&rdquo;</Text>
                  </Pressable>
                ))}
                <Text variant="caption" className="mt-1 text-iron-400">
                  {replaceSplitId == null
                    ? 'Re-importing a plan you already have will leave you with two of it.'
                    : 'Days are matched by name: matching ones are updated in place and keep their history, new ones are added, and days no longer in this import are removed.'}
                </Text>
              </View>
            ) : null}
          </Card>

          {result?.rules?.length ? (
            <Card className="mb-3 rounded-lg p-4">
              <Text variant="label" className="mb-2 text-brand">
                Progression rules
              </Text>
              {result.rules.map((rule, index) => (
                <Text key={index} variant="caption" className="mb-1 text-iron-300 last:mb-0">
                  - {rule}
                </Text>
              ))}
            </Card>
          ) : null}

          {error ? (
            <View className="mb-3">
              <FormError message={error} />
            </View>
          ) : null}

          {result?.workouts.map((r, di) => (
            <DayCard
              key={di}
              workout={r}
              dayIdx={di}
              units={units}
              included={!!includeDay[di]}
              expanded={!!expanded[di]}
              includeExercise={includeExercise}
              resolutions={resolutions}
              exerciseDrafts={exerciseDrafts}
              disabled={saving}
              onToggleDay={() => toggleDay(di)}
              onToggleExpanded={() => toggleExpanded(di)}
              onToggleExercise={(ei) => toggleExercise(di, ei)}
              onUpdateExercise={(ei, patch) => updateExerciseDraft(di, ei, patch)}
              onMoveExercise={(ei, direction) => moveExercise(di, ei, direction)}
              onChangeName={(name) => updateWorkout(di, { name })}
              onChangeWeekdays={(weekdays) =>
                updateWorkout(di, { weekdays, floating: false })
              }
              onChangeFloating={(floating) =>
                updateWorkout(di, { floating })
              }
              onSwapExercise={(ei) => setPicker({ dayIdx: di, exIdx: ei })}
              onCustomExercise={(ei) => startCustom(di, ei)}
              onRemoveExercise={(ei) => removeExercise(di, ei)}
            />
          ))}
        </ScrollView>

        <ExercisePickerModal
          visible={!!picker}
          onClose={() => setPicker(null)}
          onSelect={selectExercise}
        />

        <CustomExerciseModal
          visible={!!customPicker}
          value={customName}
          onChange={setCustomName}
          onCancel={() => {
            setCustomPicker(null);
            setCustomName('');
          }}
          onSave={saveCustom}
        />

        <BottomAction>
          {saving ? (
            <Text variant="caption" className="mb-2 text-center">
              Saving {saveTotal} {saveTotal === 1 ? 'workout' : 'workouts'}…
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                title="Back"
                variant="secondary"
                disabled={saving}
                onPress={() => reset()}
              />
            </View>
            <View className="flex-[2]">
              <Button
                title={
                  saving
                    ? 'Saving…'
                    : saveableCount > 0
                      ? `Save ${saveableCount} ${saveableCount === 1 ? 'workout' : 'workouts'}`
                      : 'Nothing selected'
                }
                loading={saving}
                disabled={saveableCount === 0}
                onPress={onSave}
              />
            </View>
          </View>
        </BottomAction>
      </Screen>
    );
  }

  // ---- input ----
  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Import workouts' }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-3 pb-6"
          keyboardShouldPersistTaps="handled">
          <Text variant="heading" className="mb-2">
            Paste your split here
          </Text>
          <Text variant="muted" className="mb-3">
            Drop in your workout split and it becomes editable workouts. A CSV
            (with an exercise column) or a JSON export is read directly; anything
            else goes to the AI.
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={PLACEHOLDER}
            placeholderTextColor="#64748b"
            multiline
            scrollEnabled
            className="h-56 rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
            style={{ textAlignVertical: 'top' }}
          />

          {error ? (
            <View className="mt-3">
              <FormError message={error} />
            </View>
          ) : null}


          {/* A history from another app. Deterministic — no model reads a CSV. */}
          <View className="mt-6 rounded-lg border border-iron-800 bg-iron-900/60 p-4">
            <Text variant="heading">Coming from Hevy or Strong?</Text>
            <Text variant="muted" className="mb-3 mt-0.5">
              Paste your CSV export and your whole logged history comes with you — dates,
              sets and all.
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              accessibilityLabel="CSV export"
              placeholder="Date,Workout Name,Exercise Name,..."
              placeholderTextColor="#64748b"
              multiline
              className="h-24 rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-sm text-iron-100"
              style={{ textAlignVertical: 'top' }}
            />
            {csvResult ? (
              <Text variant="caption" className="mt-2 text-brand">
                {csvResult}
              </Text>
            ) : null}
            <Button
              title="Import history"
              variant="secondary"
              icon="download-outline"
              className="mt-3"
              loading={csvBusy}
              disabled={!csvText.trim()}
              onPress={() => void onImportCsv()}
            />
          </View>

          {/* No program to paste? Point at the shelf of known-good ones.
            * Having the AI write a split is deliberately not offered here: a
            * generated program is a claim about someone's training, and the
            * presets are seven plans that already work. The endpoint still
            * exists for when we want it back. */}
          <View className="mt-6 rounded-lg border border-iron-800 bg-iron-900/60 p-4">
            <Text variant="heading">Don&apos;t have one?</Text>
            <Text variant="muted" className="mb-3 mt-0.5">
              Start from a proven program — PPL, Upper/Lower, 5x5 and more. Adopt one in
              a tap, then change whatever you like.
            </Text>
            <Button
              title="Browse programs"
              variant="secondary"
              icon="albums-outline"
              onPress={() => router.push('/presets')}
            />
          </View>
        </ScrollView>
        <BottomAction>
          <Button title="Parse" size="lg" disabled={!text.trim()} onPress={onParse} />
        </BottomAction>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const PARSE_STAGES = [
  'Reading your notes',
  'Finding the exercises',
  'Matching them to the catalog',
  'Building your workouts',
  'Almost there',
];

// Progress for the streaming parse. Before the first token arrives the bar
// creeps to ~12% so it never looks frozen; once tokens stream in it tracks real
// output via an asymptotic curve (never quite 100% — the result flips the
// screen). The status line walks the actual pipeline stages for flavor.
function ParseProgress({ received = 0 }: { received?: number }) {
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const progress = useRef(new Animated.Value(0.02)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0.12,
      duration: 4000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    const stageId = setInterval(() => {
      setStage((s) => Math.min(s + 1, PARSE_STAGES.length - 1));
    }, 3500);
    const elapsedId = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => {
      clearInterval(stageId);
      clearInterval(elapsedId);
    };
  }, [progress]);

  useEffect(() => {
    if (received <= 0) return;
    // Asymptotic: ~1.4k chars ≈ 63%, plateauing near 95%.
    const frac = Math.min(0.95, Math.max(0.12, 1 - Math.exp(-received / 1400)));
    Animated.timing(progress, {
      toValue: frac,
      duration: 250,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [received, progress]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['2%', '100%'],
  });

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="mb-5 h-16 w-16 items-center justify-center rounded-lg border border-brand/40 bg-brand/10">
        <Ionicons name="sparkles" size={28} color="#5eead4" />
      </View>
      <Text variant="heading" className="text-center">
        {PARSE_STAGES[stage]}
        <Text className="text-brand">…</Text>
      </Text>
      <Text variant="muted" className="mt-1.5 text-center">
        The AI is turning your notes into workouts.
      </Text>

      <View className="mt-6 h-2 w-full overflow-hidden rounded-full bg-iron-800">
        <Animated.View style={{ width }} className="h-full rounded-full bg-brand" />
      </View>
      <Text variant="caption" className="mt-3 text-center">
        {received > 0
          ? `Receiving the split · ${received.toLocaleString()} characters · ${elapsed}s`
          : `Waiting for Ollama's first response · ${elapsed}s`}
      </Text>
      <Text variant="caption" className="mt-1 text-center text-iron-500">
        Large splits can take a few minutes on a local model. You can leave this screen open.
      </Text>
    </View>
  );
}

interface DayCardProps {
  workout: ParsedWorkout;
  dayIdx: number;
  units: string;
  included: boolean;
  expanded: boolean;
  includeExercise: Record<string, boolean>;
  resolutions: Record<string, ExerciseResolution>;
  exerciseDrafts: Record<string, ExerciseDraft>;
  disabled: boolean;
  onToggleDay: () => void;
  onToggleExpanded: () => void;
  onToggleExercise: (exIdx: number) => void;
  onUpdateExercise: (exIdx: number, patch: Partial<ExerciseDraft>) => void;
  onMoveExercise: (exIdx: number, direction: -1 | 1) => void;
  onChangeName: (name: string) => void;
  onChangeWeekdays: (weekdays: number[]) => void;
  onChangeFloating: (floating: boolean) => void;
  onSwapExercise: (exIdx: number) => void;
  onCustomExercise: (exIdx: number) => void;
  onRemoveExercise: (exIdx: number) => void;
}

function DayCard({
  workout,
  dayIdx,
  units,
  included,
  expanded,
  includeExercise,
  resolutions,
  exerciseDrafts,
  disabled,
  onToggleDay,
  onToggleExpanded,
  onToggleExercise,
  onUpdateExercise,
  onMoveExercise,
  onChangeName,
  onChangeWeekdays,
  onChangeFloating,
  onSwapExercise,
  onCustomExercise,
  onRemoveExercise,
}: DayCardProps) {
  const [editingExercise, setEditingExercise] = useState<number | null>(null);

  return (
    <Card className={`mb-2.5 ${included ? 'border-brand/50' : 'opacity-60'}`}>
      <View className="flex-row items-center">
        <Pressable
          onPress={onToggleDay}
          disabled={disabled}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: included }}
          className="mr-3 active:opacity-60">
          <Ionicons
            name={included ? 'checkmark-circle' : 'ellipse-outline'}
            size={26}
            color={included ? '#5eead4' : '#64748b'}
          />
        </Pressable>

        <Pressable
          onPress={onToggleExpanded}
          className="flex-1 flex-row items-center active:opacity-70">
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text variant="subheading" numberOfLines={1} className="flex-shrink">
                {workout.name}
              </Text>
              {workout.rest_day ? (
                <View className="ml-2 rounded-md border border-iron-600 bg-iron-800 px-2 py-0.5">
                  <Text className="text-xs font-bold text-iron-300">REST</Text>
                </View>
              ) : null}
            </View>
            <Text variant="caption" className="mt-0.5">
              {scheduleLabel(workout)} · {workout.exercises.length}{' '}
              {workout.exercises.length === 1 ? 'exercise' : 'exercises'}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#64748b"
          />
        </Pressable>
      </View>

      {expanded ? (
        <View className="mt-3 gap-2">
          <View className="rounded-lg border border-iron-700 bg-iron-950 p-3">
            <Text variant="label" className="text-iron-300">
              Workout name
            </Text>
            <TextInput
              value={workout.name}
              onChangeText={onChangeName}
              editable={!disabled}
              placeholder={`Workout ${dayIdx + 1}`}
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
              className="mt-2 min-h-[48px] rounded-lg border border-iron-700 bg-iron-900 px-3 text-base font-bold text-iron-50"
            />

            {!workout.rest_day ? (
              <>
                <Text variant="label" className="mb-2 mt-4 text-iron-300">
                  When should it appear?
                </Text>
                <View className="flex-row gap-2">
                  <ScheduleMode
                    label="Selected days"
                    icon="calendar-outline"
                    active={!workout.floating}
                    disabled={disabled}
                    onPress={() => onChangeFloating(false)}
                  />
                  <ScheduleMode
                    label="Any day"
                    icon="shuffle-outline"
                    active={workout.floating}
                    disabled={disabled}
                    onPress={() => onChangeFloating(true)}
                  />
                </View>

                {workout.floating ? (
                  <Text variant="caption" className="mt-2 text-iron-400">
                    This workout is available whenever it fits, with no fixed weekday.
                  </Text>
                ) : (
                  <View className="mt-3">
                    <WeekdayPicker
                      value={workout.weekdays}
                      onChange={onChangeWeekdays}
                      disabled={disabled}
                    />
                    <Text variant="caption" className="mt-2 text-iron-400">
                      If several days are selected, it appears on those days until completed
                      once that Sunday–Saturday week.
                    </Text>
                  </View>
                )}
              </>
            ) : null}
          </View>

          {workout.notes ? (
            <Text variant="muted" className="italic">
              {workout.notes}
            </Text>
          ) : null}

          {workout.exercises.length === 0 ? (
            <Text variant="muted">No exercises on this day.</Text>
          ) : (
            workout.exercises.map((ex, ei) => {
              const exIncluded = includeExercise[exKey(dayIdx, ei)] !== false;
              const resolution = resolutions[exKey(dayIdx, ei)] ?? {
                exercise_id: ex.exercise_id == null ? null : String(ex.exercise_id),
                exercise_name: ex.matched_name ?? ex.exercise_name,
                match: ex.match,
                mode: ex.exercise_id == null ? 'custom' : 'matched',
              };
              const draft = exerciseDrafts[exKey(dayIdx, ei)] ?? {
                sets: ex.target_sets == null ? '' : String(ex.target_sets),
                reps: formatRepRange(ex.target_reps, ex.target_reps_max) ?? '',
                weight: formatNumberRange(ex.target_weight, ex.target_weight_max),
                duration: formatNumberRange(
                  ex.target_duration_seconds,
                  ex.target_duration_seconds_max,
                ),
                notes: ex.notes ?? '',
              };
              const editing = editingExercise === ei;
              const targetSummary = [
                draft.sets ? `${draft.sets} sets` : null,
                draft.reps ? `${draft.reps} reps` : null,
                draft.weight ? `${draft.weight} ${units}` : null,
                draft.duration ? `${draft.duration} sec` : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <View
                  key={ei}
                  className={`rounded-xl border border-iron-700 bg-iron-950 p-3 ${
                    exIncluded ? '' : 'opacity-50'
                  }`}>
                  <View className="flex-row items-start">
                    <Pressable
                      onPress={() => onToggleExercise(ei)}
                      disabled={disabled}
                      hitSlop={6}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: exIncluded }}
                      className="mr-2.5 mt-0.5 active:opacity-60">
                      <Ionicons
                        name={exIncluded ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={exIncluded ? '#5eead4' : '#64748b'}
                      />
                    </Pressable>
                    <Pressable
                      onPress={() => setEditingExercise(editing ? null : ei)}
                      disabled={disabled || !exIncluded}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: editing }}
                      className="min-w-0 flex-1 active:opacity-70">
                      <View className="flex-row items-start gap-2">
                        <Text variant="subheading" numberOfLines={1} className="min-w-0 flex-1">
                          {ex.exercise_name}
                        </Text>
                        <MatchBadge match={resolution.match} />
                      </View>
                      <Text variant="caption" numberOfLines={1} className="mt-0.5 text-iron-400">
                        {resolution.mode === 'custom' ? 'Custom exercise' : `Matched to ${resolution.exercise_name}`}
                        {resolution.mode === 'swapped' ? ' · swapped' : ''}
                      </Text>
                      <Text variant="caption" numberOfLines={1} className="mt-1 font-semibold text-brand">
                        {targetSummary || 'No targets detected'}
                      </Text>
                    </Pressable>
                  </View>

                  {ex.exercise_name.trim().toLowerCase() !==
                  resolution.exercise_name.trim().toLowerCase() ? (
                    <Text variant="caption" className="ml-8 mt-1 text-amber-200">
                      Using “{resolution.exercise_name}” from the exercise library.
                    </Text>
                  ) : null}

                  {editing ? (
                    <View className="ml-8 mt-3 border-t border-iron-800 pt-3">
                      <View className="flex-row flex-wrap gap-2">
                      <ReviewTargetField
                        label="Sets"
                        value={draft.sets}
                        placeholder="3"
                        keyboardType="number-pad"
                        disabled={disabled}
                        onChangeText={(sets) => onUpdateExercise(ei, { sets })}
                      />
                      <ReviewTargetField
                        label="Reps"
                        value={draft.reps}
                        placeholder="8-12"
                        disabled={disabled}
                        onChangeText={(reps) => onUpdateExercise(ei, { reps })}
                      />
                      <ReviewTargetField
                        label={`Weight (${units})`}
                        value={draft.weight}
                        placeholder="20-25"
                        disabled={disabled}
                        onChangeText={(weight) => onUpdateExercise(ei, { weight })}
                      />
                      <ReviewTargetField
                        label="Time (sec)"
                        value={draft.duration}
                        placeholder="20-60"
                        disabled={disabled}
                        onChangeText={(duration) => onUpdateExercise(ei, { duration })}
                      />
                      </View>
                      <Text variant="caption" className="mb-1 mt-3 text-iron-400">
                        Notes and alternatives
                      </Text>
                      <TextInput
                        value={draft.notes}
                        onChangeText={(notes) => onUpdateExercise(ei, { notes })}
                        editable={!disabled}
                        multiline
                        placeholder="Set history, cues, or substitutions"
                        placeholderTextColor="#64748b"
                        selectionColor="#5eead4"
                        className="min-h-[64px] rounded-lg border border-iron-700 bg-iron-900 px-3 py-2.5 text-sm text-iron-50"
                      />
                      <View className="mt-3 flex-row flex-wrap gap-2">
                        <ActionPill
                          icon="arrow-up"
                          label="Earlier"
                          disabled={disabled || ei === 0}
                          onPress={() => {
                            onMoveExercise(ei, -1);
                            setEditingExercise(null);
                          }}
                        />
                        <ActionPill
                          icon="arrow-down"
                          label="Later"
                          disabled={disabled || ei === workout.exercises.length - 1}
                          onPress={() => {
                            onMoveExercise(ei, 1);
                            setEditingExercise(null);
                          }}
                        />
                        <ActionPill
                          icon="swap-horizontal"
                          label="Swap"
                          disabled={disabled}
                          onPress={() => onSwapExercise(ei)}
                        />
                        <ActionPill
                          icon="create-outline"
                          label="Custom"
                          disabled={disabled}
                          onPress={() => onCustomExercise(ei)}
                        />
                        <ActionPill
                          icon="trash-outline"
                          label="Remove"
                          danger
                          disabled={disabled}
                          onPress={() => {
                            onRemoveExercise(ei);
                            setEditingExercise(null);
                          }}
                        />
                        <ActionPill
                          icon="checkmark"
                          label="Done"
                          disabled={disabled}
                          onPress={() => setEditingExercise(null)}
                        />
                      </View>
                    </View>
                  ) : (
                    <View className="ml-8 mt-3 flex-row flex-wrap gap-2">
                      {exIncluded ? (
                        <>
                          <ActionPill
                            icon="create-outline"
                            label="Edit"
                            disabled={disabled}
                            onPress={() => setEditingExercise(ei)}
                          />
                          <ActionPill
                            icon="swap-horizontal"
                            label="Swap"
                            disabled={disabled}
                            onPress={() => onSwapExercise(ei)}
                          />
                          <ActionPill
                            icon="trash-outline"
                            label="Remove"
                            danger
                            disabled={disabled}
                            onPress={() => onRemoveExercise(ei)}
                          />
                        </>
                      ) : (
                        <ActionPill
                          icon="add-circle-outline"
                          label="Restore"
                          disabled={disabled}
                          onPress={() => onToggleExercise(ei)}
                        />
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </Card>
  );
}

function ReviewTargetField({
  label,
  value,
  placeholder,
  keyboardType = 'default',
  disabled,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  keyboardType?: ComponentProps<typeof TextInput>['keyboardType'];
  disabled?: boolean;
  onChangeText: (value: string) => void;
}) {
  return (
    <View className="min-w-[46%] flex-1">
      <Text variant="caption" className="mb-1 text-iron-400">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor="#475569"
        selectionColor="#5eead4"
        className="min-h-[44px] rounded-lg border border-iron-700 bg-iron-900 px-3 text-sm text-iron-50"
      />
    </View>
  );
}

function ScheduleMode({
  label,
  icon,
  active,
  disabled,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[48px] flex-1 flex-row items-center justify-center rounded-lg border px-3 active:opacity-75 ${
        active ? 'border-brand bg-brand/15' : 'border-iron-700 bg-iron-900'
      } ${disabled ? 'opacity-50' : ''}`}>
      <Ionicons name={icon} size={16} color={active ? '#5eead4' : '#94a3b8'} />
      <Text
        variant="caption"
        className={`ml-2 font-bold ${active ? 'text-brand' : 'text-iron-200'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionPill({
  icon,
  label,
  disabled,
  danger = false,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`flex-row items-center rounded-full border px-3 py-1.5 active:opacity-70 ${
        danger ? 'border-red-500/40 bg-red-500/10' : 'border-iron-700 bg-iron-900'
      } ${disabled ? 'opacity-50' : ''}`}>
      <Ionicons name={icon} size={14} color={danger ? '#fca5a5' : '#5eead4'} />
      <Text
        variant="caption"
        className={`ml-1.5 font-bold ${danger ? 'text-red-200' : 'text-iron-100'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function ExercisePickerModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
}) {
  return (
    <ModalSheet
      visible={visible}
      title="Swap exercise"
      subtitle="Pick the database exercise that should replace the AI match."
      onClose={onClose}
      scroll={false}
      contentClassName="px-0">
      <ExerciseBrowser
        onSelect={onSelect}
        renderTrailing={() => (
          <View className="rounded-full bg-brand px-3 py-1">
            <Text variant="caption" className="font-bold text-iron-950">
              Use
            </Text>
          </View>
        )}
      />
    </ModalSheet>
  );
}

function CustomExerciseModal({
  visible,
  value,
  onChange,
  onCancel,
  onSave,
}: {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <ModalSheet
      visible={visible}
      title="Create custom exercise"
      subtitle="Use this when the database does not have the right movement, nickname, or variation."
      onClose={onCancel}>
      <FormField
        label="Exercise name"
        value={value}
        onChangeText={onChange}
        autoFocus
        placeholder="Exercise name"
      />
      <View className="mt-4 flex-row gap-2">
        <View className="flex-1">
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <Button title="Create" disabled={!value.trim()} onPress={onSave} />
        </View>
      </View>
    </ModalSheet>
  );
}
