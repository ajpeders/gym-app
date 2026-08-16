import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { aiParseErrorMessage } from '@/api/errors';
import type { Food, NutritionEntry, ParsedNutritionItem } from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { parseServerDate } from '@/lib/format';

const INPUT =
  'rounded-lg border border-iron-700 bg-iron-900 px-3 py-2.5 text-base text-iron-50';

/** Local calendar day key (YYYY-MM-DD). Grouping happens here, not on the
 * server, which stores UTC and knows nothing about the user's timezone. */
function dayKey(iso: string): string {
  const d = parseServerDate(iso);
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

/** Local YYYY-MM-DD and HH:MM for the editable time controls. */
function localParts(iso: string): { date: string; time: string } {
  const d = parseServerDate(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Build an ISO instant from local date + time text. Null when either is not a
 * real value, so a typo can't silently move an entry to 1970. */
function isoFromParts(date: string, time: string): string | null {
  const dm = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const [y, mo, da] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [h, mi] = [Number(tm[1]), Number(tm[2])];
  if (h > 23 || mi > 59) return null;
  const d = new Date(y, mo - 1, da, h, mi, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d.toISOString();
}

function timeLabel(iso: string): string {
  return parseServerDate(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
  // The common-foods shelf: pick one and the macros come with it, so logging a
  // meal doesn't start with looking up what chicken breast weighs in calories.
  const [foodQuery, setFoodQuery] = useState('');
  const [foods, setFoods] = useState<Food[]>([]);
  const [picked, setPicked] = useState<Food | null>(null);
  const [amount, setAmount] = useState('100');
  const [protein, setProtein] = useState('');
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ParsedNutritionItem[] | null>(null);
  // The entry being edited, plus its editable fields as text.
  const [editing, setEditing] = useState<NutritionEntry | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCalories, setEditCalories] = useState('');
  const [editProtein, setEditProtein] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');

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
    food?: string;
    amount?: number;
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

  function openEdit(entry: NutritionEntry) {
    const parts = localParts(entry.eaten_at);
    setEditing(entry);
    setEditLabel(entry.label ?? '');
    setEditCalories(entry.calories != null ? String(entry.calories) : '');
    setEditProtein(entry.protein != null ? String(entry.protein) : '');
    setEditDate(parts.date);
    setEditTime(parts.time);
    setActionError(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const eaten = isoFromParts(editDate, editTime);
    if (!eaten) {
      setActionError('Enter the date as YYYY-MM-DD and the time as HH:MM.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.updateNutrition(String(editing.id), {
        label: editLabel.trim() || null,
        calories: editCalories.trim() ? parseInt(editCalories, 10) : null,
        protein: editProtein.trim() ? parseFloat(editProtein) : null,
        eaten_at: eaten,
      });
      setEditing(null);
      await fetchAll();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save that entry');
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

          {/* common foods */}
          <Text variant="heading" className="mb-2">
            Common foods
          </Text>
          <Card className="mb-3 rounded-[20px] p-4">
            <TextInput
              value={foodQuery}
              onChangeText={(text) => {
                setFoodQuery(text);
                void api
                  .foods(text)
                  .then((rows) => setFoods(text.trim() ? rows.slice(0, 6) : []))
                  .catch(() => setFoods([]));
              }}
              placeholder="Search foods — chicken, rice, oats..."
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
              className={INPUT}
            />

            {picked ? (
              <View className="mt-3">
                <Text variant="label">{picked.name}</Text>
                <Text variant="caption" className="mt-0.5 text-iron-400">
                  {picked.calories} cal · {picked.protein}g protein per{' '}
                  {picked.unit === 'item' ? 'item' : picked.unit}
                </Text>
                <View className="mt-2 flex-row items-end gap-2">
                  <View className="flex-1">
                    <Text variant="caption" className="mb-1 text-iron-400">
                      {picked.unit === 'item' ? 'How many' : `How much (${picked.unit.replace('100', '')})`}
                    </Text>
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      accessibilityLabel="Amount"
                      placeholder={picked.unit === 'item' ? '1' : '100'}
                      placeholderTextColor="#64748b"
                      selectionColor="#5eead4"
                      className={INPUT}
                    />
                  </View>
                  <Button
                    title="Log it"
                    className="flex-1"
                    loading={busy}
                    onPress={() => {
                      const qty = parseFloat(amount);
                      void addEntry({
                        food: picked.slug,
                        amount: Number.isFinite(qty) && qty > 0 ? qty : 1,
                      }).then(() => {
                        setPicked(null);
                        setFoodQuery('');
                        setFoods([]);
                      });
                    }}
                  />
                </View>
              </View>
            ) : null}

            {foods.map((food) => (
              <Pressable
                key={food.slug}
                accessibilityRole="button"
                onPress={() => {
                  setPicked(food);
                  setAmount(food.unit === 'item' ? '1' : '100');
                  setFoods([]);
                }}
                className="mt-2 flex-row items-center justify-between rounded-lg border border-iron-800 bg-iron-950/60 px-3 py-2 active:opacity-70">
                <Text variant="label" numberOfLines={1}>
                  {food.name}
                </Text>
                <Text variant="caption" className="text-iron-400">
                  {food.calories} cal · {food.protein}g
                </Text>
              </Pressable>
            ))}
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
              selectionColor="#5eead4"
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
                  selectionColor="#5eead4"
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
                  selectionColor="#5eead4"
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
              <Ionicons name="sparkles" size={15} color="#5eead4" />
              <Text variant="label" className="ml-1.5 text-brand">
                Or describe it
              </Text>
            </View>
            <TextInput
              value={sentence}
              onChangeText={setSentence}
              placeholder='e.g. "chicken and rice, about 800 cal 60g protein"'
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
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
                      <Pressable
                        key={e.id}
                        onPress={() => openEdit(e)}
                        accessibilityLabel={`Edit ${e.label ?? 'entry'}`}
                        className="flex-row items-center rounded-lg px-2 py-2 active:bg-iron-800">
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
                      </Pressable>
                    ))}
                </Card>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={editing != null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView
          className="flex-1 justify-end bg-black/60"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View className="rounded-t-2xl border-t border-iron-700 bg-iron-950 px-4 pb-8 pt-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text variant="heading">Edit entry</Text>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Text className="font-bold text-brand">Cancel</Text>
              </Pressable>
            </View>
            <TextInput
              value={editLabel}
              onChangeText={setEditLabel}
              placeholder="What did you eat?"
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
              className={INPUT}
            />
            <View className="mt-2 flex-row gap-2">
              <View className="flex-1">
                <Text variant="caption" className="mb-1 text-iron-400">
                  Calories
                </Text>
                <TextInput
                  value={editCalories}
                  onChangeText={setEditCalories}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#64748b"
                  selectionColor="#5eead4"
                  className={INPUT}
                />
              </View>
              <View className="flex-1">
                <Text variant="caption" className="mb-1 text-iron-400">
                  Protein (g)
                </Text>
                <TextInput
                  value={editProtein}
                  onChangeText={setEditProtein}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor="#64748b"
                  selectionColor="#5eead4"
                  className={INPUT}
                />
              </View>
            </View>
            <View className="mt-2 flex-row gap-2">
              <View className="flex-1">
                <Text variant="caption" className="mb-1 text-iron-400">
                  Day
                </Text>
                <TextInput
                  value={editDate}
                  onChangeText={setEditDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#64748b"
                  selectionColor="#5eead4"
                  autoCapitalize="none"
                  className={INPUT}
                />
              </View>
              <View className="flex-1">
                <Text variant="caption" className="mb-1 text-iron-400">
                  Time
                </Text>
                <TextInput
                  value={editTime}
                  onChangeText={setEditTime}
                  placeholder="HH:MM"
                  placeholderTextColor="#64748b"
                  selectionColor="#5eead4"
                  autoCapitalize="none"
                  className={INPUT}
                />
              </View>
            </View>
            {actionError ? (
              <Text className="mt-2 text-sm text-red-400">{actionError}</Text>
            ) : null}
            <Button title="Save changes" className="mt-3" loading={busy} onPress={() => void saveEdit()} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}
