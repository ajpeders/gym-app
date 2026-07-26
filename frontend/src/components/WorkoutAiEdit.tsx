import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import type { WorkoutEditProposal, WorkoutEditWorkingExercise } from '@/api/types';
import { aiParseErrorMessage } from '@/api/errors';
import { formatRepRange, titleCase } from '@/lib/format';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

export interface WorkoutAiWorking {
  name: string;
  notes: string | null;
  exercises: WorkoutEditWorkingExercise[];
}

interface Props {
  visible: boolean;
  units: string;
  initialWorking: WorkoutAiWorking;
  onApply: (proposal: WorkoutEditProposal) => void;
  onClose: () => void;
}

type Turn = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'Add a set to every exercise',
  'Make the main lifts 8–12 reps',
  'Swap lunges for Bulgarian split squats',
];

/** Fold the proposal into the next turn's working state (exercises by name). */
function proposalToWorking(p: WorkoutEditProposal): WorkoutAiWorking {
  return {
    name: p.name,
    notes: p.notes,
    exercises: p.exercises.map((e) => ({
      exercise: e.exercise_name,
      target_sets: e.target_sets,
      target_reps: e.target_reps,
      target_reps_max: e.target_reps_max,
      target_weight: e.target_weight,
      notes: e.notes,
    })),
  };
}

export function WorkoutAiEdit({ visible, units, initialWorking, onApply, onClose }: Props) {
  const [working, setWorking] = useState<WorkoutAiWorking>(initialWorking);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<WorkoutEditProposal | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [received, setReceived] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // Reset the session each time the sheet opens so it always starts from the
  // workout's current saved state.
  useEffect(() => {
    if (visible) {
      setWorking(initialWorking);
      setTurns([]);
      setProposal(null);
      setInput('');
      setError(null);
      setReceived(0);
    }
  }, [visible, initialWorking]);

  const unmatched = proposal?.exercises.filter((e) => e.exercise_id == null) ?? [];

  async function send(raw: string) {
    const instruction = raw.trim();
    if (!instruction || sending) return;
    setError(null);
    setReceived(0);
    setInput('');
    setTurns((prev) => [...prev, { role: 'user', content: instruction }]);
    setSending(true);
    try {
      const p = await api.editWorkoutStream(
        {
          instruction,
          name: working.name,
          notes: working.notes,
          exercises: working.exercises,
        },
        (info) => setReceived(info.received),
      );
      setProposal(p);
      setWorking(proposalToWorking(p));
      setTurns((prev) => [...prev, { role: 'assistant', content: p.reply || 'Updated the workout.' }]);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      const msg = e instanceof ApiError ? aiParseErrorMessage(e) : 'Something went wrong — try again.';
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
        <View className="flex-row items-center justify-between border-b border-iron-800 px-4 py-3">
          <View className="flex-row items-center">
            <Ionicons name="sparkles" size={18} color="#f97316" />
            <Text variant="heading" className="ml-2">
              Edit with AI
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
                  Tell the AI how to change this workout. It proposes an update; nothing is saved
                  until you tap Apply.
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

            {sending ? <EditProgress received={received} /> : null}

            {proposal && !sending ? (
              <ProposalCard proposal={proposal} units={units} />
            ) : null}

            {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}
          </ScrollView>

          {proposal && !sending ? (
            <View className="border-t border-iron-800 px-4 pt-2.5">
              {unmatched.length > 0 ? (
                <Text variant="caption" className="mb-2 text-amber-400">
                  {unmatched.length} exercise{unmatched.length > 1 ? 's' : ''} not in your catalog
                  will be skipped on apply.
                </Text>
              ) : null}
              <Button
                title="Apply changes"
                onPress={() => onApply(proposal)}
                className="mb-1"
              />
            </View>
          ) : null}

          <View className="border-t border-iron-800 bg-iron-950 px-3 pb-6 pt-2.5">
            <View className="flex-row items-end">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="e.g. add a 4th set to bench"
                placeholderTextColor="#78716c"
                selectionColor="#f97316"
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
                <Ionicons name="arrow-up" size={20} color="#080706" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const EDIT_STAGES = [
  'Reading your workout',
  'Working out the change',
  'Matching exercises',
  'Finalizing',
];

// Inline "thinking" indicator for an in-flight edit. A cycling status line + a
// thin bar that creeps to ~12% before the first token, then tracks real output
// via an asymptotic curve (plateaus near 95% — the proposal flips it to done).
function EditProgress({ received = 0 }: { received?: number }) {
  const [stage, setStage] = useState(0);
  const progress = useRef(new Animated.Value(0.02)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0.12,
      duration: 3500,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
    const id = setInterval(() => {
      setStage((s) => Math.min(s + 1, EDIT_STAGES.length - 1));
    }, 2800);
    return () => clearInterval(id);
  }, [progress]);

  useEffect(() => {
    if (received <= 0) return;
    const frac = Math.min(0.95, Math.max(0.12, 1 - Math.exp(-received / 900)));
    Animated.timing(progress, {
      toValue: frac,
      duration: 250,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [received, progress]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] });

  return (
    <View className="mb-3 flex-row justify-start">
      <View className="w-[88%] rounded-2xl rounded-bl-md border border-iron-800 bg-iron-900/95 px-3.5 py-3">
        <View className="mb-2 flex-row items-center">
          <Ionicons name="sparkles" size={15} color="#f97316" />
          <Text variant="body" className="ml-2 text-iron-100">
            {EDIT_STAGES[stage]}
            <Text className="text-brand">…</Text>
          </Text>
        </View>
        <View className="h-1.5 w-full overflow-hidden rounded-full bg-iron-800">
          <Animated.View style={{ width }} className="h-full rounded-full bg-brand" />
        </View>
      </View>
    </View>
  );
}

function ProposalCard({ proposal, units }: { proposal: WorkoutEditProposal; units: string }) {
  return (
    <View className="mb-2 rounded-2xl border border-brand/40 bg-brand/5 p-3.5">
      <Text variant="subheading" className="mb-2 text-iron-50">
        {titleCase(proposal.name)}
      </Text>
      {proposal.exercises.map((e, i) => {
        const reps = formatRepRange(e.target_reps, e.target_reps_max);
        const sets = e.target_sets != null ? String(e.target_sets) : null;
        const scheme = sets && reps ? `${sets}×${reps}` : sets ? `${sets} sets` : reps ? `${reps} reps` : null;
        const weight = e.target_weight != null ? `${e.target_weight}${units}` : null;
        const missing = e.exercise_id == null;
        return (
          <View key={i} className="flex-row items-center py-1">
            <Text variant="caption" className="w-5 text-iron-500">
              {i + 1}
            </Text>
            <Text
              variant="body"
              numberOfLines={1}
              className={`flex-1 ${missing ? 'text-amber-400' : 'text-iron-100'}`}>
              {titleCase(e.exercise_name)}
              {missing ? '  (not in catalog)' : ''}
            </Text>
            <Text variant="caption" className="text-iron-400">
              {[scheme, weight].filter(Boolean).join(' · ')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
