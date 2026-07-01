import { useEffect, useMemo, useRef, useState } from 'react';
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
  ParsedMatch,
  ParsedRoutine,
  ParseRoutineResult,
  RoutineExerciseInput,
} from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/Feedback';

type Phase = 'input' | 'parsing' | 'review' | 'saving' | 'done';

const PLACEHOLDER = 'Paste your routine here.';

const MATCH_META: Record<ParsedMatch, { icon: string; label: string; className: string }> = {
  exact: { icon: '✓', label: 'matched', className: 'border-green-500/40 bg-green-500/10 text-green-300' },
  fuzzy: { icon: '~', label: 'close match', className: 'border-brand/40 bg-brand/10 text-brand' },
  none: { icon: '⚠', label: 'will be created', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
};

function exKey(dayIdx: number, exIdx: number) {
  return `${dayIdx}-${exIdx}`;
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

function summarizeTargets(
  sets: number | null,
  reps: number | null,
  weight: number | null,
  units: string,
): string | null {
  const parts: string[] = [];
  if (sets != null || reps != null) {
    parts.push(`${sets ?? '?'} × ${reps ?? '?'}`);
  }
  if (weight != null) {
    parts.push(`${weight} ${units}`);
  }
  return parts.length ? parts.join('  ·  ') : null;
}

export default function RoutineImportScreen() {
  const router = useRouter();

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseRoutineResult | null>(null);

  const [includeDay, setIncludeDay] = useState<Record<number, boolean>>({});
  const [includeExercise, setIncludeExercise] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [saveCurrent, setSaveCurrent] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const [savedCount, setSavedCount] = useState(0);

  // Characters of model output received so far — drives the parse progress bar.
  const [received, setReceived] = useState(0);

  const units = result?.units ?? 'kg';

  const saveableRoutines = useMemo(() => {
    if (!result) return [];
    return result.routines.filter((r, di) => {
      if (!includeDay[di] || r.rest_day) return false;
      return r.exercises.some((_, ei) => includeExercise[exKey(di, ei)] !== false);
    });
  }, [result, includeDay, includeExercise]);
  const saveableCount = saveableRoutines.length;

  async function onParse() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setReceived(0);
    setPhase('parsing');
    try {
      const res = await api.parseRoutineStream(trimmed, (p) => setReceived(p.received));
      const days: Record<number, boolean> = {};
      const exs: Record<string, boolean> = {};
      const exp: Record<number, boolean> = {};
      res.routines.forEach((r, di) => {
        days[di] = !r.rest_day; // rest days default to excluded from saving
        exp[di] = true;
        r.exercises.forEach((_, ei) => {
          exs[exKey(di, ei)] = true;
        });
      });
      setResult(res);
      setIncludeDay(days);
      setIncludeExercise(exs);
      setExpanded(exp);
      setPhase('review');
    } catch (e) {
      setPhase('input');
      setError(aiParseErrorMessage(e));
    }
  }

  async function onSave() {
    if (!result) return;
    const toSave = result.routines
      .map((r, di) => ({ r, di }))
      .filter(({ r, di }) => {
        if (!includeDay[di] || r.rest_day) return false;
        return r.exercises.some((_, ei) => includeExercise[exKey(di, ei)] !== false);
      });

    setSaveTotal(toSave.length);
    setSaveCurrent(0);
    setError(null);
    setPhase('saving');

    try {
      let done = 0;
      // Cache custom exercises created during this save, keyed by
      // case-insensitive name, so the same unmatched exercise (repeated within a
      // day or across days) creates ONE custom exercise and reuses its id.
      const createdCustom = new Map<string, string>();
      for (const { r, di } of toSave) {
        const exercises: RoutineExerciseInput[] = [];
        let order = 0;
        for (let ei = 0; ei < r.exercises.length; ei++) {
          if (includeExercise[exKey(di, ei)] === false) continue;
          const ex = r.exercises[ei];
          // No catalog match → create a custom exercise so nothing is lost.
          let exerciseId: string;
          if (ex.exercise_id === null) {
            const key = ex.exercise_name.trim().toLowerCase();
            let cachedId = createdCustom.get(key);
            if (!cachedId) {
              const created = await api.createExercise({ name: ex.exercise_name });
              cachedId = created.id;
              createdCustom.set(key, cachedId);
            }
            exerciseId = cachedId;
          } else {
            exerciseId = String(ex.exercise_id);
          }
          exercises.push({
            exercise_id: exerciseId,
            order,
            target_sets: ex.target_sets,
            target_reps: ex.target_reps,
            target_weight: ex.target_weight,
          });
          order += 1;
        }
        // A day with everything unchecked yields no exercises — never create an
        // empty routine.
        if (exercises.length === 0) continue;
        await api.createRoutine({
          name: r.name,
          notes: r.notes ?? undefined,
          exercises,
        });
        done += 1;
        setSaveCurrent(done);
      }
      setSavedCount(done);
      setPhase('done');
    } catch {
      setError('Saving failed — some routines may not have saved. Try again.');
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

  function reset(clearText = false) {
    setResult(null);
    setError(null);
    setPhase('input');
    setIncludeDay({});
    setIncludeExercise({});
    setExpanded({});
    if (clearText) setText('');
  }

  // ---- parsing progress ----
  if (phase === 'parsing') {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Import routine' }} />
        <ParseProgress received={received} />
      </Screen>
    );
  }

  // ---- success ----
  if (phase === 'done') {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Import routine' }} />
        <View className="flex-1 items-center justify-center px-6">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full border border-brand/40 bg-brand/10">
            <Ionicons name="checkmark" size={34} color="#f97316" />
          </View>
          <Text variant="heading" className="text-center">
            Saved {savedCount} {savedCount === 1 ? 'routine' : 'routines'}
          </Text>
          <Text variant="muted" className="mt-1.5 text-center">
            Your routines are ready. Start a workout from any of them.
          </Text>
          <View className="mt-6 w-full gap-2">
            <Button title="View routines" size="lg" onPress={() => router.replace('/routines')} />
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
            Found {result?.routines.length ?? 0} days. Toggle anything you don&apos;t want, then
            save.
          </Text>

          {error ? (
            <View className="mb-3">
              <FormError message={error} />
            </View>
          ) : null}

          {result?.routines.map((r, di) => (
            <DayCard
              key={di}
              routine={r}
              dayIdx={di}
              units={units}
              included={!!includeDay[di]}
              expanded={!!expanded[di]}
              includeExercise={includeExercise}
              disabled={saving}
              onToggleDay={() => toggleDay(di)}
              onToggleExpanded={() => toggleExpanded(di)}
              onToggleExercise={(ei) => toggleExercise(di, ei)}
            />
          ))}
        </ScrollView>

        <View className="border-t border-iron-800 bg-iron-950 px-4 pb-8 pt-3">
          {saving ? (
            <Text variant="caption" className="mb-2 text-center">
              Saving routine {saveCurrent} of {saveTotal}…
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
                      ? `Save ${saveableCount} ${saveableCount === 1 ? 'routine' : 'routines'}`
                      : 'Nothing selected'
                }
                loading={saving}
                disabled={saveableCount === 0}
                onPress={onSave}
              />
            </View>
          </View>
        </View>
      </Screen>
    );
  }

  // ---- input ----
  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Import routine' }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-3 pb-6"
          keyboardShouldPersistTaps="handled">
          <Text variant="heading" className="mb-2">
            Paste your routine here
          </Text>
          <Text variant="muted" className="mb-3">
            Drop in your workout plan and the AI will turn it into routines.
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={PLACEHOLDER}
            placeholderTextColor="#78716c"
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

        </ScrollView>
        <View className="border-t border-iron-800 bg-iron-950 px-4 pb-8 pt-3">
          <Button title="Parse" size="lg" disabled={!text.trim()} onPress={onParse} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const PARSE_STAGES = [
  'Reading your notes',
  'Finding the exercises',
  'Matching them to the catalog',
  'Building your routines',
  'Almost there',
];

// Progress for the streaming parse. Before the first token arrives the bar
// creeps to ~12% so it never looks frozen; once tokens stream in it tracks real
// output via an asymptotic curve (never quite 100% — the result flips the
// screen). The status line walks the actual pipeline stages for flavor.
function ParseProgress({ received = 0 }: { received?: number }) {
  const [stage, setStage] = useState(0);
  const progress = useRef(new Animated.Value(0.02)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0.12,
      duration: 4000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    const id = setInterval(() => {
      setStage((s) => Math.min(s + 1, PARSE_STAGES.length - 1));
    }, 3500);
    return () => clearInterval(id);
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
      <View className="mb-5 h-16 w-16 items-center justify-center rounded-2xl border border-brand/40 bg-brand/10">
        <Ionicons name="sparkles" size={28} color="#f97316" />
      </View>
      <Text variant="heading" className="text-center">
        {PARSE_STAGES[stage]}
        <Text className="text-brand">…</Text>
      </Text>
      <Text variant="muted" className="mt-1.5 text-center">
        The AI is turning your notes into routines.
      </Text>

      <View className="mt-6 h-2 w-full overflow-hidden rounded-full bg-iron-800">
        <Animated.View style={{ width }} className="h-full rounded-full bg-brand" />
      </View>
      <Text variant="caption" className="mt-3 text-center">
        A full week can take 10–20 seconds.
      </Text>
    </View>
  );
}

interface DayCardProps {
  routine: ParsedRoutine;
  dayIdx: number;
  units: string;
  included: boolean;
  expanded: boolean;
  includeExercise: Record<string, boolean>;
  disabled: boolean;
  onToggleDay: () => void;
  onToggleExpanded: () => void;
  onToggleExercise: (exIdx: number) => void;
}

function DayCard({
  routine,
  dayIdx,
  units,
  included,
  expanded,
  includeExercise,
  disabled,
  onToggleDay,
  onToggleExpanded,
  onToggleExercise,
}: DayCardProps) {
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
            color={included ? '#f97316' : '#78716c'}
          />
        </Pressable>

        <Pressable
          onPress={onToggleExpanded}
          className="flex-1 flex-row items-center active:opacity-70">
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text variant="subheading" numberOfLines={1} className="flex-shrink">
                {routine.name}
              </Text>
              {routine.rest_day ? (
                <View className="ml-2 rounded-md border border-iron-600 bg-iron-800 px-2 py-0.5">
                  <Text className="text-xs font-bold text-iron-300">REST</Text>
                </View>
              ) : null}
            </View>
            <Text variant="caption" className="mt-0.5">
              {routine.exercises.length}{' '}
              {routine.exercises.length === 1 ? 'exercise' : 'exercises'}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#78716c"
          />
        </Pressable>
      </View>

      {expanded ? (
        <View className="mt-3 gap-2">
          {routine.notes ? (
            <Text variant="muted" className="italic">
              {routine.notes}
            </Text>
          ) : null}

          {routine.exercises.length === 0 ? (
            <Text variant="muted">No exercises on this day.</Text>
          ) : (
            routine.exercises.map((ex, ei) => {
              const exIncluded = includeExercise[exKey(dayIdx, ei)] !== false;
              const targets = summarizeTargets(
                ex.target_sets,
                ex.target_reps,
                ex.target_weight,
                units,
              );
              return (
                <View
                  key={ei}
                  className={`flex-row rounded-lg border border-iron-700 bg-iron-950 p-2.5 ${
                    exIncluded ? '' : 'opacity-50'
                  }`}>
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
                      color={exIncluded ? '#f97316' : '#78716c'}
                    />
                  </Pressable>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text variant="body" numberOfLines={1} className="flex-1 pr-2">
                        {ex.exercise_name}
                      </Text>
                      <MatchBadge match={ex.match} />
                    </View>
                    {targets ? (
                      <Text variant="label" className="mt-1 text-brand">
                        {targets}
                      </Text>
                    ) : null}
                    {ex.notes ? (
                      <Text variant="caption" className="mt-1">
                        {ex.notes}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </Card>
  );
}
