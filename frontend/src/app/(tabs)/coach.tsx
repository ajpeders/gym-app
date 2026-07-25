import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';

import { api, ApiError } from '@/api/client';
import type { CompanionEvent, CompanionMessage } from '@/api/client';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Feedback';

const SUGGESTIONS = [
  'What should I train today?',
  'Log 3x5 squats at 100kg',
  'How has my bench been trending?',
];

let idSeq = 0;
const nextId = () => `local-${(idSeq += 1)}-${Date.now()}`;

/** One rendered row in the chat log. */
type Item =
  | { id: string; kind: 'user'; content: string }
  | { id: string; kind: 'assistant'; content: string; error?: boolean }
  | { id: string; kind: 'activity'; label: string }
  | {
      id: string;
      kind: 'confirm';
      callId: string;
      name: string;
      args: Record<string, unknown>;
      messages: CompanionMessage[];
    };

/** Turn a synthesized tool name (post_api_workouts_start) into something human. */
function humanize(name: string): string {
  return name
    .replace(/^(get|post|patch|delete|put)_api_/, '')
    .replace(/_by_[a-z_]*id/g, '')
    .replace(/_/g, ' ')
    .trim();
}

const markdownStyles = {
  body: { color: '#f5f5f4', fontSize: 16, lineHeight: 23 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  bullet_list: { marginBottom: 4 },
  ordered_list: { marginBottom: 4 },
  list_item: { marginBottom: 4, flexDirection: 'row' as const },
  bullet_list_icon: { color: '#f97316', marginRight: 6 },
  ordered_list_icon: { color: '#f97316', marginRight: 6, fontWeight: '700' as const },
  heading2: { color: '#f5f5f4', fontSize: 18, fontWeight: '800' as const, marginBottom: 6 },
  heading3: { color: '#f5f5f4', fontSize: 16, fontWeight: '700' as const, marginBottom: 4 },
  code_inline: {
    color: '#ffedd5',
    backgroundColor: '#1c1917',
    borderRadius: 4,
    paddingHorizontal: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
};

function UserBubble({ content }: { content: string }) {
  return (
    <View className="mb-3 flex-row justify-end">
      <View className="max-w-[85%] rounded-2xl rounded-br-md border border-brand/40 bg-brand/20 px-3.5 py-2.5">
        <Text variant="body" className="text-iron-50">
          {content}
        </Text>
      </View>
    </View>
  );
}

function AssistantBubble({ content, error }: { content: string; error?: boolean }) {
  return (
    <View className="mb-3 flex-row justify-start">
      <View
        className={`max-w-[88%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 ${
          error ? 'border-red-500/40 bg-red-500/10' : 'border-iron-800 bg-iron-900/95'
        }`}>
        {error ? (
          <Text variant="body" className="text-red-300">
            {content}
          </Text>
        ) : (
          <Markdown style={markdownStyles}>{content}</Markdown>
        )}
      </View>
    </View>
  );
}

/** Subtle centered line shown while the coach reads/uses a tool. */
function ActivityChip({ label }: { label: string }) {
  return (
    <View className="mb-2 flex-row items-center justify-center">
      <View className="flex-row items-center rounded-full border border-iron-800 bg-iron-900/70 px-3 py-1">
        <Ionicons name="construct-outline" size={12} color="#a8a29e" />
        <Text variant="caption" className="ml-1.5 text-iron-400">
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Inline approval card for a write the coach wants to make. */
function ConfirmCard({
  item,
  busy,
  onApprove,
  onSkip,
}: {
  item: Extract<Item, { kind: 'confirm' }>;
  busy: boolean;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const args = Object.entries(item.args).filter(([, v]) => v !== null && v !== '');
  return (
    <View className="mb-3 flex-row justify-start">
      <View className="max-w-[90%] rounded-2xl rounded-bl-md border border-brand/40 bg-brand/10 px-3.5 py-3">
        <View className="mb-1.5 flex-row items-center">
          <Ionicons name="alert-circle-outline" size={16} color="#f97316" />
          <Text variant="body" className="ml-1.5 font-semibold text-iron-50">
            Confirm: {humanize(item.name)}
          </Text>
        </View>
        {args.length > 0 && (
          <View className="mb-2.5">
            {args.map(([k, v]) => (
              <Text key={k} variant="caption" className="text-iron-300">
                {k}: {String(v)}
              </Text>
            ))}
          </View>
        )}
        <View className="flex-row">
          <Pressable
            disabled={busy}
            onPress={onApprove}
            accessibilityRole="button"
            className={`mr-2 rounded-lg px-4 py-2 ${busy ? 'bg-iron-800 opacity-50' : 'bg-brand active:bg-brand-600'}`}>
            <Text variant="caption" className="font-semibold text-iron-950">
              Do it
            </Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={onSkip}
            accessibilityRole="button"
            className="rounded-lg border border-iron-700 px-4 py-2 active:opacity-70">
            <Text variant="caption" className="text-iron-200">
              Skip
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function TypingBubble() {
  return (
    <View className="mb-3 flex-row justify-start">
      <View className="flex-row items-center rounded-2xl rounded-bl-md border border-iron-800 bg-iron-900/95 px-3.5 py-3">
        <Ionicons name="ellipsis-horizontal" size={18} color="#f97316" />
        <Text variant="muted" className="ml-2">
          Coaching…
        </Text>
      </View>
    </View>
  );
}

function EmptyIntro({ onPick }: { onPick: (q: string) => void }) {
  return (
    <View>
      <View className="mb-5 rounded-[24px] border border-brand/30 bg-brand/10 p-5">
        <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl border border-brand/30 bg-brand/15">
          <Ionicons name="sparkles" size={25} color="#f97316" />
        </View>
        <Text variant="heading">
          What can I help with?
        </Text>
        <Text variant="muted" className="mt-1">
          Ask about your training, review progress, or log a set without digging through forms.
        </Text>
      </View>
      <Text variant="eyebrow" className="mb-2">
        Try asking
      </Text>
      <View className="gap-2">
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => onPick(s)}
            accessibilityRole="button"
            className="flex-row items-center rounded-[18px] border border-iron-800 bg-iron-900/90 px-4 py-3.5 active:opacity-70">
            <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl bg-iron-800">
              <Ionicons name="arrow-up-outline" size={16} color="#f97316" style={{ transform: [{ rotate: '45deg' }] }} />
            </View>
            <Text variant="label" className="flex-1 text-iron-100">{s}</Text>
            <Ionicons name="chevron-forward" size={16} color="#57534e" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function CoachScreen() {
  const router = useRouter();
  const { configured, loading: aiLoading } = useAiStatus();
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Wire history sent to the model (user + assistant text turns only; tool steps
  // are ephemeral). In a ref so stream callbacks always see the latest.
  const convo = useRef<CompanionMessage[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);
  useEffect(() => {
    if (items.length > 0 || sending) scrollToEnd();
  }, [items, sending, scrollToEnd]);

  // Reset the session when AI config changes (e.g. user just set up a provider).
  useEffect(() => {
    setItems([]);
    convo.current = [];
  }, [configured]);

  const push = useCallback((item: Item) => setItems((prev) => [...prev, item]), []);

  const runTurn = useCallback(
    async (messages: CompanionMessage[], approvals?: Record<string, boolean>) => {
      setSending(true);
      let assistantText = '';
      try {
        await api.companionChat(
          messages,
          (ev: CompanionEvent) => {
            switch (ev.type) {
              case 'text':
                assistantText = ev.text;
                push({ id: nextId(), kind: 'assistant', content: ev.text });
                break;
              case 'tool_call':
                push({
                  id: nextId(),
                  kind: 'activity',
                  label:
                    ev.access === 'read'
                      ? `Checking ${humanize(ev.name)}…`
                      : `Preparing to ${humanize(ev.name)}…`,
                });
                break;
              case 'confirm':
                push({
                  id: nextId(),
                  kind: 'confirm',
                  callId: ev.id,
                  name: ev.name,
                  args: (ev.arguments as Record<string, unknown>) ?? {},
                  messages: ev.messages,
                });
                break;
              case 'error':
                push({ id: nextId(), kind: 'assistant', content: ev.error, error: true });
                break;
              case 'done':
                if (!ev.pending && assistantText) {
                  convo.current = [...convo.current, { role: 'assistant', content: assistantText }];
                }
                break;
              default:
                break;
            }
          },
          approvals,
        );
      } catch (e) {
        const content =
          e instanceof ApiError && (e.status === 503 || e.status === 502)
            ? e.message
            : 'Something went wrong, try again.';
        push({ id: nextId(), kind: 'assistant', content, error: true });
      } finally {
        setSending(false);
      }
    },
    [push],
  );

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || sending || !configured) return;
      push({ id: nextId(), kind: 'user', content: message });
      convo.current = [...convo.current, { role: 'user', content: message }];
      setInput('');
      await runTurn(convo.current);
    },
    [sending, configured, push, runTurn],
  );

  const approve = useCallback(
    (item: Extract<Item, { kind: 'confirm' }>) => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      void runTurn(item.messages, { [item.callId]: true });
    },
    [runTurn],
  );

  const skip = useCallback((item: Extract<Item, { kind: 'confirm' }>) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { id: i.id, kind: 'assistant', content: `Skipped ${humanize(item.name)}.` }
          : i,
      ),
    );
    convo.current = [
      ...convo.current,
      { role: 'assistant', content: `(Skipped the ${humanize(item.name)} action.)` },
    ];
  }, []);

  if (aiLoading) {
    return (
      <Screen scroll={false} padded={false}>
        <Loading label="Loading your coach…" />
      </Screen>
    );
  }

  if (!configured) {
    return (
      <Screen scroll={false} padded={false}>
        <View className="flex-1 items-center justify-center px-8">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl border border-brand/40 bg-brand/10">
            <Ionicons name="sparkles" size={28} color="#f97316" />
          </View>
          <Text variant="heading" className="text-center">
            Set up your AI to chat with your coach
          </Text>
          <Text variant="muted" className="mt-2 text-center">
            Add your Ollama server or Claude key in Settings, then come back.
          </Text>
          <Button
            title="Go to Settings"
            className="mt-6 self-stretch"
            onPress={() => router.push('/settings')}
          />
        </View>
      </Screen>
    );
  }

  const hasConfirm = items.some((i) => i.kind === 'confirm');
  const canSend = input.trim().length > 0 && !sending && !hasConfirm;

  return (
    <Screen scroll={false} padded={false} edges={['left', 'right']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-4"
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollToEnd}>
          {items.length === 0 && !sending ? (
            <>
              <ScreenHeader
                eyebrow="AI training partner"
                title="Coach"
                subtitle="Advice grounded in your plans, history, goals, and limitations."
              />
              <EmptyIntro onPick={setInput} />
            </>
          ) : (
            items.map((m) => {
              switch (m.kind) {
                case 'user':
                  return <UserBubble key={m.id} content={m.content} />;
                case 'assistant':
                  return <AssistantBubble key={m.id} content={m.content} error={m.error} />;
                case 'activity':
                  return <ActivityChip key={m.id} label={m.label} />;
                case 'confirm':
                  return (
                    <ConfirmCard
                      key={m.id}
                      item={m}
                      busy={sending}
                      onApprove={() => approve(m)}
                      onSkip={() => skip(m)}
                    />
                  );
                default:
                  return null;
              }
            })
          )}
          {sending ? <TypingBubble /> : null}
        </ScrollView>

        <View className="border-t border-iron-800 bg-iron-950/95 px-3 pb-6 pt-2.5">
          <View className="flex-row items-end">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={hasConfirm ? 'Respond to the action above…' : 'Ask your coach'}
              placeholderTextColor="#78716c"
              selectionColor="#f97316"
              multiline
              editable={!sending && !hasConfirm}
              className="max-h-32 min-h-[48px] flex-1 rounded-xl border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
              style={{ textAlignVertical: 'center' }}
            />
            <Pressable
              onPress={() => void send(input)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              className={`ml-2 h-12 w-12 items-center justify-center rounded-xl ${
                canSend ? 'bg-brand active:bg-brand-600' : 'bg-iron-800 opacity-50'
              }`}>
              <Ionicons name="arrow-up" size={20} color="#080706" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
