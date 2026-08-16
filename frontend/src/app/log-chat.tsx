import { useCallback, useEffect, useRef, useState } from 'react';
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
import { isAvailable, listen, type Listener } from '@/lib/speech';

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
  // `text` arrives from a deep link — `gymapp://log-chat?text=bench%203x8%4060`.
  // That's what makes "Hey Siri, log bench three by eight" possible without a
  // native App Intent: a Shortcut opens the URL and this screen does the rest.
  const { sessionId: sessionParam, text: textParam } = useLocalSearchParams<{
    sessionId?: string;
    text?: string;
  }>();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const targetId = sessionParam ?? activeId ?? null;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  // Send a deep-linked phrase once, on arrival. Parsing it automatically is the
  // point — a Shortcut that dumped the text into a box and waited for a tap
  // would be slower than typing it.
  // Voice input, where the platform can do it.
  const [listening, setListening] = useState(false);
  const [speechAvailable] = useState(() => isAvailable());
  const listener = useRef<Listener | null>(null);

  function toggleListening() {
    if (listening) {
      listener.current?.stop();
      return;
    }
    setError(null);
    setListening(true);
    listener.current = listen({
      // Straight into the parser: a transcript that lands in the box and waits
      // for a tap is slower than typing, which defeats the point.
      onTranscript: (text) => void send(text),
      onError: (reason) => setError(reason),
      onEnd: () => setListening(false),
    });
    if (!listener.current) setListening(false);
  }

  const sentDeepLink = useRef(false);
  useEffect(() => {
    const incoming = typeof textParam === 'string' ? textParam.trim() : '';
    if (!incoming || sentDeepLink.current) return;
    sentDeepLink.current = true;
    void send(incoming);
    // `send` is stable enough for this one-shot; re-running on every render
    // would re-log the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textParam]);

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
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Log sets',
          headerRight: targetId
            ? () => (
                <Pressable
                  onPress={() => router.push(`/session/active/${targetId}`)}
                  accessibilityRole="button"
                  accessibilityLabel="Open the active session"
                  className="flex-row items-center active:opacity-70">
                  <Ionicons name="open-outline" size={16} color="#5eead4" />
                  <Text className="ml-1.5 text-sm font-bold text-brand">Session</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="px-4 pt-3 pb-4"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}>
          {turns.length === 0 ? (
            <View className="flex-1 justify-center py-6">
              <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
                <Ionicons name="sparkles" size={22} color="#5eead4" />
              </View>
              <Text variant="heading">Describe what you did</Text>
              <Text variant="muted" className="mb-4 mt-1">
                Write one sentence and review the sets before adding them.
                {targetId ? '' : ' With no session running, adding starts a new one.'}
              </Text>
              <Text variant="caption" className="mb-2 font-bold uppercase tracking-wider text-iron-500">
                Try an example
              </Text>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setInput(s)}
                  className="mb-2 flex-row items-center rounded-xl border border-iron-700 bg-iron-900/90 px-3.5 py-3 active:opacity-70">
                  <Text variant="caption" numberOfLines={2} className="flex-1 text-iron-100">
                    {s}
                  </Text>
                  <Ionicons name="arrow-forward" size={15} color="#64748b" />
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
              <Ionicons name="sparkles" size={15} color="#5eead4" />
              <Text variant="body" className="ml-2 text-iron-100">
                Working on it<Text className="text-brand">…</Text>
              </Text>
            </View>
          ) : null}

          {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}
        </ScrollView>

        <View className="border-t border-iron-800 bg-iron-950 px-3 pb-6 pt-2.5">
          <View className="flex-row items-end">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Describe your sets…"
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
              multiline
              editable={!busy}
              className="max-h-32 min-h-[44px] flex-1 rounded-lg border border-iron-700 bg-iron-900 px-4 py-2.5 text-base text-iron-50"
              style={{ textAlignVertical: 'center' }}
            />
            {/* Speak it instead. The parser already turns "bench three by
              * eight at sixty" into sets — this only supplies the words, and
              * only where the platform can hear them. */}
            {speechAvailable ? (
              <Pressable
                onPress={toggleListening}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={listening ? 'Stop listening' : 'Speak your sets'}
                className={`ml-2 h-11 w-11 items-center justify-center rounded-lg ${
                  listening ? 'bg-red-500/80' : 'bg-iron-800'
                }`}>
                <Ionicons name={listening ? 'stop' : 'mic'} size={19} color="#e2e8f0" />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void send(input)}
              disabled={!input.trim() || busy}
              accessibilityRole="button"
              accessibilityLabel="Read these sets"
              className={`ml-2 h-11 w-11 items-center justify-center rounded-lg ${
                input.trim() && !busy ? 'bg-brand active:bg-brand-600' : 'bg-iron-800 opacity-50'
              }`}>
              <Ionicons name="arrow-up" size={20} color="#030712" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
