import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { api } from '@/api/client';
import { aiParseErrorMessage } from '@/api/errors';
import type { ParsedItem, ParseResult, SetType, Units } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/Feedback';

interface Props {
  workoutId: string;
  units: Units;
  /** Refresh the active workout once new sets have been applied. */
  onApplied: () => Promise<void>;
}

type Mode = 'idle' | 'input' | 'confirm';

const PLACEHOLDER = 'e.g. "bench 3x8 @60, last set hard. then squats 5,5,5 @100"';

// The parse endpoint reports "working" sets; the set log API uses "normal".
function toSetType(t: string): SetType {
  return t === 'working' ? 'normal' : (t as SetType);
}

const MATCH_BADGE: Record<ParsedItem['match'], { icon: string; label: string; cls: string }> = {
  exact: { icon: '✓', label: 'exact', cls: 'text-green-400' },
  fuzzy: { icon: '~', label: 'fuzzy', cls: 'text-brand' },
  none: { icon: '⚠', label: 'no match', cls: 'text-red-400' },
};

export function NaturalLanguageLog({ workoutId, units, onApplied }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  // Indices of parsed items the user has chosen to exclude from apply.
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  function reset() {
    setMode('idle');
    setText('');
    setParsing(false);
    setApplying(false);
    setError(null);
    setResult(null);
    setExcluded(new Set());
  }

  async function onParse() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setParsing(true);
    setError(null);
    try {
      const res = await api.parseSets({ text: trimmed, workout_id: Number(workoutId) });
      setResult(res);
      setExcluded(new Set());
      setMode('confirm');
    } catch (e) {
      setError(aiParseErrorMessage(e));
    } finally {
      setParsing(false);
    }
  }

  function toggleExcluded(i: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function onConfirm() {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      for (let i = 0; i < result.items.length; i++) {
        const item = result.items[i];
        if (excluded.has(i)) continue;
        if (item.exercise_id == null) continue; // unmatched: skipped (see note in UI)
        const we = await api.addWorkoutExercise(workoutId, {
          exercise_id: String(item.exercise_id),
        });
        for (const s of item.sets) {
          await api.addSet(workoutId, we.id, {
            reps: s.reps,
            weight: s.weight ?? 0,
            rpe: s.rpe,
            set_type: toSetType(s.set_type),
          });
        }
      }
      await onApplied();
      reset();
    } catch {
      setError("Couldn't add those sets. Try again.");
    } finally {
      setApplying(false);
    }
  }

  // ---- collapsed entry point ----
  if (mode === 'idle') {
    return (
      <Pressable
        onPress={() => setMode('input')}
        accessibilityRole="button"
        className="mb-3 flex-row items-center justify-between rounded-lg border border-brand bg-iron-900 px-4 py-3 active:opacity-80">
        <View className="flex-1 pr-2">
          <Text variant="subheading" className="text-brand">
            ✨ Log by sentence
          </Text>
          <Text variant="caption" className="mt-0.5">
            Type a set in plain English and let AI fill it in.
          </Text>
        </View>
        <Text className="text-xl text-brand">›</Text>
      </Pressable>
    );
  }

  // ---- input + confirm panel ----
  return (
    <Card className="mb-3 border-brand">
      <View className="flex-row items-center justify-between">
        <Text variant="subheading" className="text-brand">
          ✨ Log by sentence
        </Text>
        <Pressable onPress={reset} hitSlop={8} className="active:opacity-60">
          <Text className="text-sm font-bold text-iron-400">Close</Text>
        </Pressable>
      </View>

      {mode === 'input' ? (
        <View className="mt-3">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={PLACEHOLDER}
            placeholderTextColor="#78716c"
            multiline
            editable={!parsing}
            className="min-h-[72px] rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-base text-iron-50"
            style={{ textAlignVertical: 'top' }}
          />

          {error ? (
            <View className="mt-3">
              <FormError message={error} />
            </View>
          ) : null}

          <View className="mt-3 flex-row items-center gap-2">
            {/* Voice — roadmap'd, not yet available in Expo Go. */}
            <Pressable
              disabled
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              className="flex-row items-center rounded-md border border-iron-700 bg-iron-900 px-3 py-3 opacity-50">
              <Text className="text-base text-iron-300">🎤</Text>
              <Text variant="caption" className="ml-1.5">
                voice · soon
              </Text>
            </Pressable>
            <View className="flex-1">
              <Button
                title={parsing ? 'Parsing…' : 'Parse'}
                loading={parsing}
                disabled={!text.trim()}
                onPress={onParse}
              />
            </View>
          </View>

          {parsing ? (
            <Text variant="caption" className="mt-2 text-center">
              Reading your set… the first parse can take a moment.
            </Text>
          ) : null}
        </View>
      ) : null}

      {mode === 'confirm' && result ? (
        <View className="mt-3">
          <Text variant="caption" className="mb-2">
            {result.provider} · {result.model} · {result.latency_ms} ms
          </Text>

          {result.items.length === 0 ? (
            <Text variant="muted">Nothing recognised. Try rephrasing.</Text>
          ) : (
            result.items.map((item, i) => {
              const badge = MATCH_BADGE[item.match];
              const unmatched = item.exercise_id == null;
              const isExcluded = excluded.has(i) || unmatched;
              return (
                <View
                  key={`${item.exercise_name}-${i}`}
                  className={`mb-2 rounded-lg border border-iron-700 bg-iron-950 p-3 ${
                    isExcluded ? 'opacity-50' : ''
                  }`}>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 flex-row items-center pr-2">
                      <Text className={`mr-1.5 text-base font-bold ${badge.cls}`}>
                        {badge.icon}
                      </Text>
                      <Text variant="subheading" numberOfLines={1} className="flex-1">
                        {item.exercise_name}
                      </Text>
                    </View>
                    {unmatched ? (
                      <Text variant="caption" className={badge.cls}>
                        {badge.label}
                      </Text>
                    ) : (
                      <Pressable
                        onPress={() => toggleExcluded(i)}
                        hitSlop={8}
                        className="active:opacity-60">
                        <Text
                          className={`text-sm font-bold ${
                            excluded.has(i) ? 'text-brand' : 'text-red-500'
                          }`}>
                          {excluded.has(i) ? 'Include' : 'Remove'}
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  {/* sets */}
                  <View className="mt-2 gap-1">
                    {item.sets.map((s, si) => (
                      <View key={si} className="flex-row items-center">
                        <Text variant="body" className="flex-1">
                          {s.reps} × {s.weight == null ? 'bw' : `${s.weight} ${units}`}
                          {s.rpe != null ? `  ·  RPE ${s.rpe}` : ''}
                        </Text>
                        <View className="rounded bg-iron-800 px-2 py-0.5">
                          <Text variant="caption" className="text-iron-300">
                            {s.set_type}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  {item.notes ? (
                    <Text variant="caption" className="mt-1.5 italic">
                      “{item.notes}”
                    </Text>
                  ) : null}

                  {unmatched ? (
                    <Text variant="caption" className="mt-1.5 text-red-400">
                      No catalog match — add this exercise manually after applying.
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}

          {error ? (
            <View className="mb-3">
              <FormError message={error} />
            </View>
          ) : null}

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button title="Back" variant="secondary" disabled={applying} onPress={() => setMode('input')} />
            </View>
            <View className="flex-1">
              <Button
                title="Confirm & add"
                loading={applying}
                disabled={result.items.every((it, i) => it.exercise_id == null || excluded.has(i))}
                onPress={onConfirm}
              />
            </View>
          </View>
        </View>
      ) : null}
    </Card>
  );
}
