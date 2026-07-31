import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { api, ApiError } from '@/api/client';
import type { SplitEditProposal, SplitEditWorkingDay } from '@/api/types';
import { aiParseErrorMessage } from '@/api/errors';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

export interface SplitAiWorking {
  name: string;
  notes: string | null;
  rules: string[];
  days: SplitEditWorkingDay[];
}

interface Props {
  visible: boolean;
  initialWorking: SplitAiWorking;
  onApply: (proposal: SplitEditProposal) => void;
  onClose: () => void;
}

type Turn = { role: 'user' | 'assistant'; content: string };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SUGGESTIONS = [
  'Move leg day to Wednesday',
  'Give me a rest day on Sunday',
  'Rewrite my progression rules to be simpler',
];

function scheduleLabel(day: SplitEditWorkingDay): string {
  if (day.floating || day.weekdays.length === 0) return 'Anytime';
  return day.weekdays.map((d) => DOW[d] ?? '?').join(' / ');
}

/** Fold a proposal into the next turn's working state, so follow-up edits build
 * on what the model just proposed rather than the saved split. */
function proposalToWorking(p: SplitEditProposal): SplitAiWorking {
  return { name: p.name, notes: p.notes, rules: p.rules, days: p.days };
}

export function SplitAiEdit({ visible, initialWorking, onApply, onClose }: Props) {
  const [working, setWorking] = useState<SplitAiWorking>(initialWorking);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<SplitEditProposal | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // Reset each time the sheet OPENS so it starts from the saved split. Keyed on
  // `visible` alone and read through a ref: the parent rebuilds initialWorking
  // every render, so depending on its identity would re-run this on each render
  // and wipe the proposal the moment it arrived.
  const latestInitial = useRef(initialWorking);
  latestInitial.current = initialWorking;
  useEffect(() => {
    if (visible) {
      setWorking(latestInitial.current);
      setTurns([]);
      setProposal(null);
      setInput('');
      setError(null);
    }
  }, [visible]);

  const added = proposal?.days.filter((d) => d.id == null).length ?? 0;
  const removedCount = proposal
    ? working.days.filter(
        (before) => before.id != null && !proposal.days.some((d) => d.id === before.id),
      ).length
    : 0;

  async function send(raw: string) {
    const instruction = raw.trim();
    if (!instruction || sending) return;
    setError(null);
    setInput('');
    setTurns((prev) => [...prev, { role: 'user', content: instruction }]);
    setSending(true);
    try {
      const p = await api.editSplitStream({
        instruction,
        name: working.name,
        notes: working.notes,
        rules: working.rules,
        days: working.days,
      });
      setProposal(p);
      setWorking(proposalToWorking(p));
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: p.reply || 'Updated the split.' },
      ]);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      setError(
        e instanceof ApiError ? aiParseErrorMessage(e) : 'Something went wrong — try again.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
        <View className="flex-row items-center justify-between border-b border-iron-800 px-4 py-3">
          <View className="flex-row items-center">
            <Ionicons name="sparkles" size={18} color="#818cf8" />
            <Text variant="heading" className="ml-2">
              Edit split with AI
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text className="font-bold text-brand">Close</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerClassName="px-4 pt-3 pb-4"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
            {turns.length === 0 && !sending ? (
              <View className="py-4">
                <Text variant="muted" className="mb-3">
                  Change the split's name, notes, progression rules, or which day falls on which
                  weekday — a weekday with nothing on it is a rest day. Nothing is saved until you
                  tap Apply. To change the exercises inside a day, open that day and use its own AI
                  edit.
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

            {turns.map((t, i) =>
              t.role === 'user' ? (
                <View key={i} className="mb-3 flex-row justify-end">
                  <View className="max-w-[85%] rounded-2xl rounded-br-md border border-brand/40 bg-brand/20 px-3.5 py-2.5">
                    <Text variant="body" className="text-iron-50">
                      {t.content}
                    </Text>
                  </View>
                </View>
              ) : (
                <View key={i} className="mb-3 flex-row justify-start">
                  <View className="max-w-[88%] rounded-2xl rounded-bl-md border border-iron-800 bg-iron-900/95 px-3.5 py-2.5">
                    <Text variant="body" className="text-iron-50">
                      {t.content}
                    </Text>
                  </View>
                </View>
              ),
            )}

            {sending ? (
              <View className="mb-3 flex-row items-center">
                <Ionicons name="sparkles" size={15} color="#818cf8" />
                <Text variant="body" className="ml-2 text-iron-100">
                  Reworking your split<Text className="text-brand">…</Text>
                </Text>
              </View>
            ) : null}

            {proposal && !sending ? (
              <View className="mb-2 rounded-2xl border border-brand/40 bg-brand/5 p-3.5">
                <Text variant="subheading" className="mb-2 text-iron-50">
                  {proposal.name}
                </Text>
                {proposal.days.map((d, i) => (
                  <View key={i} className="flex-row items-center py-1">
                    <Text variant="body" numberOfLines={1} className="flex-1 text-iron-100">
                      {d.name}
                      {d.id == null ? '  (new)' : ''}
                    </Text>
                    <Text variant="caption" className="text-iron-400">
                      {scheduleLabel(d)}
                    </Text>
                  </View>
                ))}
                {proposal.rules.length > 0 ? (
                  <Text variant="caption" className="mt-2 text-iron-400">
                    {proposal.rules.length} progression rule
                    {proposal.rules.length === 1 ? '' : 's'}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}
          </ScrollView>

          {proposal && !sending ? (
            <View className="border-t border-iron-800 px-4 pt-2.5">
              {removedCount > 0 || added > 0 ? (
                <Text variant="caption" className="mb-2 text-amber-400">
                  {[
                    removedCount > 0
                      ? `${removedCount} day${removedCount === 1 ? '' : 's'} will be removed from this split`
                      : null,
                    added > 0
                      ? `${added} new day${added === 1 ? '' : 's'} will be created empty`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
              <Button title="Apply changes" onPress={() => onApply(proposal)} className="mb-1" />
            </View>
          ) : null}

          <View className="border-t border-iron-800 bg-iron-950 px-3 pb-6 pt-2.5">
            <View className="flex-row items-end">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="e.g. move leg day to Wednesday"
                placeholderTextColor="#64748b"
                selectionColor="#818cf8"
                multiline
                editable={!sending}
                className="max-h-32 min-h-[44px] flex-1 rounded-lg border border-iron-700 bg-iron-900 px-4 py-2.5 text-base text-iron-50"
                style={{ textAlignVertical: 'center' }}
              />
              <Pressable
                onPress={() => void send(input)}
                disabled={!input.trim() || sending}
                className={`ml-2 h-11 w-11 items-center justify-center rounded-lg ${
                  input.trim() && !sending ? 'bg-brand active:bg-brand-600' : 'bg-iron-800 opacity-50'
                }`}>
                <Ionicons name="arrow-up" size={20} color="#070b12" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
