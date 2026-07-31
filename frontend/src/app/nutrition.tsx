import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { aiParseErrorMessage } from '@/api/errors';
import type { NutritionEntry, ParsedNutritionItem } from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState } from '@/components/ui/Feedback';

const INPUT =
  'rounded-lg border border-iron-700 bg-iron-900 px-3 py-2.5 text-base text-iron-50';

/** Local calendar day key (YYYY-MM-DD). Grouping happens here, not on the
 * server, which stores UTC and knows nothing about the user's timezone. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  if (key === today) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function sum(entries: NutritionEntry[], field: 'calories' | 'protein'): number {
  return entries.reduce((total, e) => total + (e[field] ?? 0), 0);
}

/** A target bar. Renders without a target too — the number still matters. */
function TargetRow({
  label,
  value,
  target,
  unit,
}: {
  label: string;
  value: number;
  target: number | null;
  unit: string;
}) {
  const pct = target && target > 0 ? Math.min(1, value / target) : null;
  return (
    <View className="mb-3 last:mb-0">
      <View className="mb-1 flex-row items-baseline justify-between">
        <Text variant="caption" className="text-iron-400">
          {label}
        </Text>
        <Text variant="body" className="text-iron-50">
          {Math.round(value)}
          {target ? <Text className="text-iron-500"> / {Math.round(target)}</Text> : null}
          <Text className="text-iron-500"> {unit}</Text>
        </Text>
      </View>
      {pct != null ? (
        <View className="h-1.5 w-full overflow-hidden rounded-full bg-iron-800">
          <View
            style={{ width: `${pct * 100}%` }}
            className={`h-full rounded-full ${pct >= 1 ? 'bg-mint' : 'bg-brand'}`}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function NutritionScreen() {
  const [entries, setEntries] = useState<NutritionEntry[]>([]);
  const [calorieTarget, setCalorieTarget] = useState<number | null>(null);
  const [proteinTarget, setProteinTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ParsedNutritionItem[] | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, profile] = await Promise.all([
        api.nutrition(14),
        api.getProfile().catch(() => null),
      ]);
      setEntries(rows);
      setCalorieTarget(profile?.calorie_target ?? null);
      setProteinTarget(profile?.protein_target ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load nutrition');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchAll();
    }, [fetchAll]),
  );

  const days = useMemo(() => {
    const grouped = new Map<string, NutritionEntry[]>();
    for (const e of entries) {
      const key = dayKey(e.eaten_at);
      const list = grouped.get(key);
      if (list) list.push(e);
      else grouped.set(key, [e]);
    }
    return [...grouped.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  const todayKey = dayKey(new Date().toISOString());
  const todayEntries = useMemo(
    () => entries.filter((e) => dayKey(e.eaten_at) === todayKey),
    [entries, todayKey],
  );

  async function addEntry(input: {
    label?: string | null;
    calories?: number | null;
    protein?: number | null;
  }) {
    setBusy(true);
    setActionError(null);
    try {
      // eaten_at is omitted, so the server stamps now — the common case of
      // logging as you eat needs no date handling at all.
      await api.createNutrition(input);
      setLabel('');
      setCalories('');
      setProtein('');
      await fetchAll();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save that entry');
    } finally {
      setBusy(false);
    }
  }

  async function onParse() {
    const text = sentence.trim();
    if (!text) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.parseNutrition(text);
      setProposal(res.items);
    } catch (e) {
      setActionError(aiParseErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyProposal(items: ParsedNutritionItem[]) {
    setBusy(true);
    setActionError(null);
    try {
      for (const item of items) {
        await api.createNutrition({
          label: item.label,
          calories: item.calories,
          protein: item.protein,
        });
      }
      setProposal(null);
      setSentence('');
      await fetchAll();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save those entries');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setActionError(null);
    try {
      await api.deleteNutrition(String(id));
      await fetchAll();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not delete that entry');
    }
  }

  if (loading || error) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Nutrition' }} />
        {loading ? <Loading /> : <ErrorState message={error ?? ''} onRetry={fetchAll} />}
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Nutrition' }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-3 pb-28"
          keyboardShouldPersistTaps="handled">
          {/* today's totals */}
          <Card className="mb-4 rounded-[20px] p-4">
            <Text variant="heading" className="mb-3">
              Today
            </Text>
            <TargetRow
              label="Calories"
              value={sum(todayEntries, 'calories')}
              target={calorieTarget}
              unit="cal"
            />
            <TargetRow
              label="Protein"
              value={sum(todayEntries, 'protein')}
              target={proteinTarget}
              unit="g"
            />
            {calorieTarget == null && proteinTarget == null ? (
              <Text variant="caption" className="mt-1 text-iron-500">
                Set daily targets in your profile to track progress.
              </Text>
            ) : null}
          </Card>

          {/* quick add */}
          <Text variant="heading" className="mb-2">
            Add
          </Text>
          <Card className="mb-3 rounded-[20px] p-4">
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="What did you eat?"
              placeholderTextColor="#64748b"
              selectionColor="#818cf8"
              className={INPUT}
            />
            <View className="mt-2 flex-row gap-2">
              <View className="flex-1">
                <Text variant="caption" className="mb-1 text-iron-400">
                  Calories
                </Text>
                <TextInput
                  value={calories}
                  onChangeText={setCalories}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#64748b"
                  selectionColor="#818cf8"
                  className={INPUT}
                />
              </View>
              <View className="flex-1">
                <Text variant="caption" className="mb-1 text-iron-400">
                  Protein (g)
                </Text>
                <TextInput
                  value={protein}
                  onChangeText={setProtein}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor="#64748b"
                  selectionColor="#818cf8"
                  className={INPUT}
                />
              </View>
            </View>
            <Button
              title="Add entry"
              className="mt-3"
              loading={busy}
              disabled={!calories.trim() && !protein.trim() && !label.trim()}
              onPress={() =>
                void addEntry({
                  label: label.trim() || null,
                  calories: calories.trim() ? parseInt(calories, 10) : null,
                  protein: protein.trim() ? parseFloat(protein) : null,
                })
              }
            />
          </Card>

          {/* sentence entry */}
          <Card className="mb-4 rounded-[20px] p-4">
            <View className="mb-2 flex-row items-center">
              <Ionicons name="sparkles" size={15} color="#818cf8" />
              <Text variant="label" className="ml-1.5 text-brand">
                Or describe it
              </Text>
            </View>
            <TextInput
              value={sentence}
              onChangeText={setSentence}
              placeholder='e.g. "chicken and rice, about 800 cal 60g protein"'
              placeholderTextColor="#64748b"
              selectionColor="#818cf8"
              multiline
              className={`${INPUT} min-h-[60px]`}
              style={{ textAlignVertical: 'top' }}
            />
            {proposal ? (
              <View className="mt-3 rounded-2xl border border-brand/40 bg-brand/5 p-3">
                {proposal.map((item, i) => (
                  <View key={i} className="flex-row items-center py-1">
                    <Text variant="body" numberOfLines={1} className="flex-1 text-iron-100">
                      {item.label}
                    </Text>
                    <Text variant="caption" className="text-iron-400">
                      {[
                        item.calories != null ? `${item.calories} cal` : null,
                        item.protein != null ? `${item.protein}g` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                ))}
                <View className="mt-2 flex-row gap-2">
                  <Button
                    title="Add these"
                    className="flex-1"
                    loading={busy}
                    onPress={() => void applyProposal(proposal)}
                  />
                  <Button
                    title="Discard"
                    variant="secondary"
                    className="flex-1"
                    onPress={() => setProposal(null)}
                  />
                </View>
              </View>
            ) : (
              <Button
                title="Read it"
                variant="secondary"
                className="mt-2"
                loading={busy}
                disabled={!sentence.trim()}
                onPress={() => void onParse()}
              />
            )}
          </Card>

          {actionError ? (
            <Text className="mb-3 text-sm text-red-400">{actionError}</Text>
          ) : null}

          {/* history, newest day first */}
          {days.length === 0 ? (
            <Text variant="muted">Nothing logged yet.</Text>
          ) : (
            days.map(([key, dayEntries]) => (
              <View key={key} className="mb-4">
                <View className="mb-2 flex-row items-baseline justify-between">
                  <Text variant="heading">{dayLabel(key)}</Text>
                  <Text variant="caption" className="text-iron-400">
                    {Math.round(sum(dayEntries, 'calories'))} cal ·{' '}
                    {Math.round(sum(dayEntries, 'protein'))}g protein
                  </Text>
                </View>
                <Card className="rounded-[20px] p-2">
                  {[...dayEntries]
                    .sort((a, b) => (a.eaten_at < b.eaten_at ? 1 : -1))
                    .map((e) => (
                      <View key={e.id} className="flex-row items-center px-2 py-2">
                        <Text variant="caption" className="w-16 text-iron-500">
                          {timeLabel(e.eaten_at)}
                        </Text>
                        <Text variant="body" numberOfLines={1} className="flex-1 text-iron-100">
                          {e.label || 'Entry'}
                        </Text>
                        <Text variant="caption" className="mr-2 text-iron-400">
                          {[
                            e.calories != null ? `${e.calories} cal` : null,
                            e.protein != null ? `${e.protein}g` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        <Pressable
                          onPress={() => void remove(e.id)}
                          hitSlop={8}
                          accessibilityLabel={`Remove ${e.label ?? 'entry'}`}
                          className="w-7 items-center active:opacity-60">
                          <Ionicons name="close" size={16} color="#ef4444" />
                        </Pressable>
                      </View>
                    ))}
                </Card>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
