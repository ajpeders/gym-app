import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { aiParseErrorMessage } from '@/api/errors';
import type { ParsedItem, ParseResult, SetType } from '@/api/types';
import { useSettings } from '@/state/settings';
import { useActiveWorkout } from '@/state/active-workout';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { formatLoad, titleCase } from '@/lib/format';

/** The parse endpoint reports "working" sets; the set log API uses "normal". */
function toSetType(t: string): SetType {
  return t === 'working' ? 'normal' : (t as SetType);
}

type Turn =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'proposal'; result: ParseResult };

const SUGGESTIONS = [
  'bench 3x8 @60, last set hard',
  'squats 5,5,5 @100',
  'lat pulldown 3x10 at 40kg then hammer curls 3x12 @12.5',
];

/** Only matched items that actually carry sets get written. */
function isApplicable(item: ParsedItem): boolean {
  return item.exercise_id != null && item.sets.length > 0;
}

function itemSummary(item: ParsedItem, units: string): string {
  const parts = item.sets.map((s) => {
    const load = s.weight != null ? ` @ ${formatLoad(s.weight, units)}` : '';
    return `${s.reps}${load}`;
  });
  return parts.join(', ');
}

export default function LogChatScreen() {
  const router = useRouter();
  const { settings } = useSettings();
  const { activeId, start, refresh } = useActiveWorkout();
  // Logging into a specific session (opened from the active-session screen)
  // rather than whichever session happens to be active.
  const { sessionId: sessionParam } = useLocalSearchParams<{ sessionId?: string }>();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const targetId = sessionParam ?? activeId ?? null;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setError(null);
    setInput('');
    setTurns((prev) => [...prev, { kind: 'user', text }]);
    setBusy(true);
    scrollToEnd();
    try {
      // A session id is only a naming hint for the parser — this screen works
      // with no session at all, and creates one when the sets are confirmed.
      const result = await api.parseSets({
        text,
        workout_id: targetId != null ? Number(targetId) : undefined,
      });
      const usable = result.items.filter(isApplicable).length;
      setTurns((prev) => [
        ...prev,
        {
          kind: 'assistant',
          text: usable
            ? `Got ${usable} exercise${usable === 1 ? '' : 's'} — check it over and add.`
            : "I couldn't match any of those to exercises in your catalog.",
        },
        { kind: 'proposal', result },
      ]);
      scrollToEnd();
    } catch (e) {
      setError(aiParseErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Write a proposal's sets, starting a session first if none is running. */
  async function apply(result: ParseResult) {
    setBusy(true);
    setError(null);
    try {
      let sessionId = targetId;
      if (!sessionId) {
        const started = await start({ name: 'Logged by sentence' });
        sessionId = started.id;
      }
      let added = 0;
      for (const item of result.items) {
        if (item.exercise_id == null) continue; // unmatched — nothing to attach sets to
        // The parser sometimes emits an extra item carrying only a comment
        // ("last set hard"). Adding it would leave an empty exercise row.
        if (item.sets.length === 0) continue;
        const we = await api.addSessionExercise(sessionId, {
          exercise_id: String(item.exercise_id),
        });
        for (const s of item.sets) {
          await api.addSet(sessionId, we.id, {
            reps: s.reps,
            weight: s.weight,
            rpe: s.rpe,
            set_type: toSetType(s.set_type),
          });
          added += 1;
        }
      }
      await refresh().catch(() => {});
      setTurns((prev) => [
        // Drop the proposal card once applied so it can't be added twice.
        ...prev.filter((t) => t.kind !== 'proposal' || t.result !== result),
        { kind: 'assistant', text: `Added ${added} set${added === 1 ? '' : 's'}.` },
      ]);
      scrollToEnd();
    } catch {
      setError("Couldn't add those sets — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen options={{ headerShown: true, title: 'Log by sentence' }} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="px-4 pt-3 pb-4"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}>
          {turns.length === 0 ? (
            <View className="py-4">
              <Text variant="muted" className="mb-3">
                Describe your sets in plain English and I'll turn them into a log. Nothing is saved
                until you tap Add.
                {targetId ? '' : ' With no session running, adding starts a new one.'}
              </Text>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setInput(s)}
                  className="mb-2 self-start rounded-full border border-iron-700 bg-iron-900/90 px-3.5 py-2 active:opacity-70">
                  <Text variant="caption" className="text-iron-100">
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {turns.map((t, i) => {
            if (t.kind === 'user') {
              return (
                <View key={i} className="mb-3 flex-row justify-end">
                  <View className="max-w-[85%] rounded-2xl rounded-br-md border border-brand/40 bg-brand/20 px-3.5 py-2.5">
                    <Text variant="body" className="text-iron-50">
                      {t.text}
                    </Text>
                  </View>
                </View>
              );
            }
            if (t.kind === 'assistant') {
              return (
                <View key={i} className="mb-3 flex-row justify-start">
                  <View className="max-w-[88%] rounded-2xl rounded-bl-md border border-iron-800 bg-iron-900/95 px-3.5 py-2.5">
                    <Text variant="body" className="text-iron-50">
                      {t.text}
                    </Text>
                  </View>
                </View>
              );
            }
            // Items with no sets are parser commentary, not something to log —
            // hide them so the preview matches exactly what Add will write.
            const shown = t.result.items.filter((it) => it.sets.length > 0);
            const unmatched = shown.filter((it) => it.exercise_id == null);
            const usable = shown.length - unmatched.length;
            return (
              <View
                key={i}
                className="mb-3 rounded-2xl border border-brand/40 bg-brand/5 p-3.5">
                {shown.map((item, j) => (
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
                {unmatched.length > 0 ? (
                  <Text variant="caption" className="mt-2 text-amber-400">
                    {unmatched.length} not in your catalog — {usable > 0 ? 'skipped on add' : 'nothing to add'}.
                  </Text>
                ) : null}
                {usable > 0 ? (
                  <Button
                    title="Add to session"
                    onPress={() => void apply(t.result)}
                    loading={busy}
                    className="mt-3"
                  />
                ) : null}
              </View>
            );
          })}

          {busy ? (
            <View className="mb-3 flex-row items-center">
              <Ionicons name="sparkles" size={15} color="#818cf8" />
              <Text variant="body" className="ml-2 text-iron-100">
                Working on it<Text className="text-brand">…</Text>
              </Text>
            </View>
          ) : null}

          {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}
        </ScrollView>

        {targetId ? (
          <Pressable
            onPress={() => router.push(`/session/active/${targetId}`)}
            className="mx-4 mb-2 flex-row items-center justify-center rounded-lg border border-iron-700 bg-iron-900 py-2.5 active:opacity-70">
            <Ionicons name="open-outline" size={15} color="#94a3b8" />
            <Text variant="caption" className="ml-1.5 text-iron-200">
              Open the session
            </Text>
          </Pressable>
        ) : null}

        <View className="border-t border-iron-800 bg-iron-950 px-3 pb-6 pt-2.5">
          <View className="flex-row items-end">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder='e.g. "bench 3x8 @60, last set hard"'
              placeholderTextColor="#64748b"
              selectionColor="#818cf8"
              multiline
              editable={!busy}
              className="max-h-32 min-h-[44px] flex-1 rounded-lg border border-iron-700 bg-iron-900 px-4 py-2.5 text-base text-iron-50"
              style={{ textAlignVertical: 'center' }}
            />
            <Pressable
              onPress={() => void send(input)}
              disabled={!input.trim() || busy}
              className={`ml-2 h-11 w-11 items-center justify-center rounded-lg ${
                input.trim() && !busy ? 'bg-brand active:bg-brand-600' : 'bg-iron-800 opacity-50'
              }`}>
              <Ionicons name="arrow-up" size={20} color="#070b12" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
