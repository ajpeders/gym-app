import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { aiParseErrorMessage } from '@/api/errors';
import type { ParsedDay, ParsedItem, SetType } from '@/api/types';
import { useSettings } from '@/state/settings';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatLoad, titleCase } from '@/lib/format';
import { resolveDayLabel } from '@/lib/day-label';

/** The parse endpoint reports "working" sets; the log API uses "normal". */
function toSetType(t: string): SetType {
  return t === 'working' ? 'normal' : (t as SetType);
}

interface DraftDay {
  /** The header the parser echoed, for display. */
  label: string | null;
  /** Local YYYY-MM-DD; empty when the label carried no date to resolve. */
  date: string;
  items: ParsedItem[];
  saved: boolean;
}

/** Only matched items carrying sets can be written. */
function usable(item: ParsedItem): boolean {
  return item.exercise_id != null && item.sets.length > 0;
}

function isValidDate(s: string): boolean {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, 12);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return false;
  return dt.getTime() <= new Date().setHours(23, 59, 59, 999);
}

function itemSummary(item: ParsedItem, units: string): string {
  return item.sets
    .map((s) => `${s.reps}${s.weight != null ? ` @ ${formatLoad(s.weight, units)}` : ''}`)
    .join(', ');
}

const PLACEHOLDER = `Thu - Push
Bench 95 10, 90 11
Incline DB press 3x10 @30

Sat
Lat pulldown 3x10 @100`;

/**
 * Paste several already-trained days at once and save each as its own
 * backdated session.
 *
 * The date per day is always shown and editable: the parser echoes the header
 * verbatim ("Thu - Push") and this screen resolves it against the device's
 * calendar, which is a guess worth confirming before it becomes history.
 */
export default function CatchUpPasteScreen() {
  const router = useRouter();
  const { settings } = useSettings();
  const [text, setText] = useState('');
  const [days, setDays] = useState<DraftDay[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  async function read() {
    const notes = text.trim();
    if (!notes || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.parseDays(notes);
      const drafts: DraftDay[] = result.days
        .map((d: ParsedDay) => ({
          label: d.day,
          date: resolveDayLabel(d.day) ?? '',
          // Set-less items are parser commentary, not something to log.
          items: d.items.filter((i) => i.sets.length > 0),
          saved: false,
        }))
        .filter((d) => d.items.length > 0);
      if (drafts.length === 0) {
        setError("I couldn't find any sets in that.");
        return;
      }
      setDays(drafts);
    } catch (e) {
      setError(aiParseErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function setDate(index: number, date: string) {
    setDays((prev) => prev?.map((d, i) => (i === index ? { ...d, date } : d)) ?? prev);
  }

  function removeDay(index: number) {
    setDays((prev) => prev?.filter((_, i) => i !== index) ?? prev);
  }

  /** Save every ready day. Each is its own session, so a partial failure still
   *  keeps the days that did save — hence the per-day `saved` flag. */
  async function saveAll() {
    if (!days || busy) return;
    setBusy(true);
    setError(null);
    let written = 0;
    const next = [...days];
    for (let i = 0; i < next.length; i += 1) {
      const day = next[i];
      const rows = day.items.filter(usable);
      if (day.saved || !isValidDate(day.date) || rows.length === 0) continue;
      try {
        await api.logSession({
          name: day.label?.trim() || null,
          started_at: new Date(`${day.date}T12:00:00`).toISOString(),
          exercises: rows.map((item) => ({
            exercise_id: String(item.exercise_id),
            sets: item.sets.map((s) => ({
              reps: s.reps,
              weight: s.weight,
              rpe: s.rpe,
              set_type: toSetType(s.set_type),
            })),
          })),
        });
        next[i] = { ...day, saved: true };
        written += 1;
      } catch {
        setError(`Couldn't save ${day.label ?? day.date} — the others were saved.`);
      }
    }
    setDays(next);
    setSavedCount((c) => c + written);
    setBusy(false);
    if (written > 0 && next.every((d) => d.saved)) router.replace('/catch-up');
  }

  const ready = days?.filter((d) => !d.saved && isValidDate(d.date) && d.items.some(usable)) ?? [];

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen options={{ headerShown: true, title: 'Paste several days' }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-3 pb-10"
          keyboardShouldPersistTaps="handled">
          {days === null ? (
            <>
              <Text variant="muted" className="mb-3">
                Paste a stretch of your notes with a day header before each day. Each day
                becomes its own session, dated for you — nothing is saved until you confirm.
              </Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={PLACEHOLDER}
                placeholderTextColor="#929b89"
                selectionColor="#b6d69a"
                multiline
                editable={!busy}
                className="min-h-[200px] rounded-lg border border-iron-700 bg-iron-900 px-3.5 py-2.5 text-base text-iron-50"
                style={{ textAlignVertical: 'top' }}
              />
              {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}
              <Button
                title="Read my notes"
                icon="sparkles"
                onPress={() => void read()}
                loading={busy}
                disabled={!text.trim()}
                className="mt-3"
              />
            </>
          ) : (
            <>
              <Text variant="muted" className="mb-3">
                {days.length} {days.length === 1 ? 'day' : 'days'} found. Check each date, then
                save.
              </Text>
              {error ? <Text className="mb-2 text-sm text-red-400">{error}</Text> : null}

              {days.map((day, i) => {
                const rows = day.items.filter(usable);
                const unmatched = day.items.length - rows.length;
                const dateOk = isValidDate(day.date);
                return (
                  <Card key={i} className="mb-3">
                    <View className="flex-row items-center">
                      <Text variant="subheading" numberOfLines={1} className="flex-1">
                        {day.label ? titleCase(day.label) : 'Untitled day'}
                      </Text>
                      {day.saved ? (
                        <View className="flex-row items-center">
                          <Ionicons name="checkmark-circle" size={16} color="#7bc6a4" />
                          <Text variant="caption" className="ml-1 text-mint">
                            Saved
                          </Text>
                        </View>
                      ) : (
                        <Pressable onPress={() => removeDay(i)} hitSlop={6}>
                          <Text className="text-sm font-bold text-red-500">Skip</Text>
                        </Pressable>
                      )}
                    </View>

                    <View className="mt-2.5 flex-row items-center">
                      <Text variant="caption" className="mr-2 text-iron-400">
                        Date
                      </Text>
                      <TextInput
                        value={day.date}
                        onChangeText={(v) => setDate(i, v)}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#929b89"
                        selectionColor="#b6d69a"
                        autoCapitalize="none"
                        editable={!day.saved}
                        className={`flex-1 rounded-md border bg-iron-950 px-3 py-2 text-base text-iron-50 ${
                          dateOk ? 'border-iron-700' : 'border-amber-500/60'
                        }`}
                      />
                    </View>
                    {!dateOk ? (
                      <Text variant="caption" className="mt-1 text-amber-400">
                        {day.date
                          ? 'Use YYYY-MM-DD, today or earlier.'
                          : "I couldn't tell which day this was — set a date."}
                      </Text>
                    ) : null}

                    <View className="mt-2.5">
                      {day.items.map((item, j) => (
                        <View key={j} className="flex-row items-center py-1">
                          <Text
                            variant="body"
                            numberOfLines={1}
                            className={`flex-1 ${
                              item.exercise_id == null ? 'text-amber-400' : 'text-iron-100'
                            }`}>
                            {titleCase(item.matched_name ?? item.exercise_name)}
                            {item.exercise_id == null ? '  (not in catalog)' : ''}
                          </Text>
                          <Text variant="caption" className="text-iron-400">
                            {itemSummary(item, settings.units)}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {unmatched > 0 ? (
                      <Text variant="caption" className="mt-1.5 text-amber-400">
                        {unmatched} not in your catalog — skipped on save.
                      </Text>
                    ) : null}
                  </Card>
                );
              })}

              <Button
                title={
                  ready.length > 0
                    ? `Save ${ready.length} ${ready.length === 1 ? 'session' : 'sessions'}`
                    : 'Nothing ready to save'
                }
                size="lg"
                loading={busy}
                disabled={ready.length === 0}
                onPress={() => void saveAll()}
                className="mt-1"
              />
              {savedCount > 0 ? (
                <Text variant="caption" className="mt-2 text-center text-mint">
                  {savedCount} saved so far.
                </Text>
              ) : null}
              <Button
                title="Start over"
                variant="ghost"
                className="mt-2"
                disabled={busy}
                onPress={() => {
                  setDays(null);
                  setError(null);
                }}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
