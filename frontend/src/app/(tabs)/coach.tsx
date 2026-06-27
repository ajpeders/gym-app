import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';

import { api, ApiError } from '@/api/client';
import type { CoachMessage } from '@/api/types';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState } from '@/components/ui/Feedback';

/** A message in the local chat log. `error` flags an assistant-styled failure bubble. */
type ChatMessage = CoachMessage & { id: string; error?: boolean };

const SUGGESTIONS = [
  'What should I train today?',
  "I'm short on time",
  'Is my volume balanced?',
];

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `local-${idSeq}-${Date.now()}`;
}

/** Markdown styling tuned for the iron dark theme. */
const markdownStyles = {
  body: { color: '#f5f5f4', fontSize: 16, lineHeight: 23 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { color: '#ffffff', fontWeight: '700' as const },
  em: { fontStyle: 'italic' as const },
  bullet_list: { marginBottom: 4 },
  ordered_list: { marginBottom: 4 },
  list_item: { marginBottom: 4, flexDirection: 'row' as const },
  bullet_list_icon: { color: '#f97316', marginRight: 6 },
  ordered_list_icon: { color: '#f97316', marginRight: 6, fontWeight: '700' as const },
  heading1: { color: '#f5f5f4', fontSize: 20, fontWeight: '800' as const, marginBottom: 6 },
  heading2: { color: '#f5f5f4', fontSize: 18, fontWeight: '800' as const, marginBottom: 6 },
  heading3: { color: '#f5f5f4', fontSize: 16, fontWeight: '700' as const, marginBottom: 4 },
  link: { color: '#f97316' },
  code_inline: {
    color: '#ffedd5',
    backgroundColor: '#1c1917',
    borderRadius: 4,
    paddingHorizontal: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fence: {
    color: '#e7e5e4',
    backgroundColor: '#12100e',
    borderColor: '#292524',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  code_block: {
    color: '#e7e5e4',
    backgroundColor: '#12100e',
    borderColor: '#292524',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  blockquote: {
    backgroundColor: '#12100e',
    borderColor: '#f97316',
    borderLeftWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
};

function UserBubble({ content }: { content: string }) {
  return (
    <View className="mb-3 flex-row justify-end">
      <View className="max-w-[85%] rounded-2xl rounded-br-md border border-brand/40 bg-brand/15 px-3.5 py-2.5">
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
          error ? 'border-red-500/40 bg-red-500/10' : 'border-iron-700 bg-iron-900'
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

function TypingBubble() {
  return (
    <View className="mb-3 flex-row justify-start">
      <View className="flex-row items-center rounded-2xl rounded-bl-md border border-iron-700 bg-iron-900 px-3.5 py-3">
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
    <View className="px-1 py-6">
      <View className="mb-4 items-center">
        <View className="mb-3 h-14 w-14 items-center justify-center rounded-full border border-brand/40 bg-brand/10">
          <Ionicons name="chatbubbles" size={26} color="#f97316" />
        </View>
        <Text variant="heading" className="text-center">
          Your coach
        </Text>
        <Text variant="muted" className="mt-1.5 text-center">
          Ask your coach anything — what to train today, how to work around an injury,
          programming questions.
        </Text>
      </View>
      <View className="flex-row flex-wrap justify-center">
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => onPick(s)}
            accessibilityRole="button"
            className="mb-2 mr-2 rounded-full border border-iron-700 bg-iron-900 px-3.5 py-2 active:opacity-70">
            <Text variant="caption" className="text-iron-100">
              {s}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function CoachScreen() {
  const router = useRouter();
  const { configured, loading: aiLoading } = useAiStatus();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { messages: history } = await api.coachHistory();
      setMessages(history.map((m) => ({ ...m, id: nextId() })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load coach');
    } finally {
      setLoading(false);
    }
  }, []);

  // Only fetch coach history once AI is configured. Re-runs when the user
  // returns from Settings having just set up their provider (configured flips).
  useEffect(() => {
    if (configured) {
      void load();
    } else {
      setMessages([]);
      setLoadError(null);
      setLoading(false);
    }
  }, [configured, load]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    if (messages.length > 0 || sending) scrollToEnd();
  }, [messages, sending, scrollToEnd]);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || sending || !configured) return;

    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await api.coachSend(message);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: res.reply,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      const content =
        e instanceof ApiError && e.status === 502
          ? 'Coach unavailable — check your AI provider in Settings.'
          : 'Something went wrong, try again.';
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', content, error: true },
      ]);
      // Keep the user's typed message recoverable.
      setInput(message);
    } finally {
      setSending(false);
    }
  }

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
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full border border-brand/40 bg-brand/10">
            <Ionicons name="sparkles" size={28} color="#f97316" />
          </View>
          <Text variant="heading" className="text-center">
            Set up your local AI to chat with your coach
          </Text>
          <Text variant="muted" className="mt-2 text-center">
            Add your Ollama server in Settings, then come back.
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

  if (loading) {
    return (
      <Screen scroll={false} padded={false}>
        <Loading label="Loading your coach…" />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen scroll={false} padded={false}>
        <ErrorState message={loadError} onRetry={() => void load()} />
      </Screen>
    );
  }

  const canSend = input.trim().length > 0 && !sending;

  return (
    <Screen scroll={false} padded={false} edges={['left', 'right']}>
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
          {messages.length === 0 && !sending ? (
            <EmptyIntro onPick={setInput} />
          ) : (
            messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <AssistantBubble key={m.id} content={m.content} error={m.error} />
              ),
            )
          )}
          {sending ? <TypingBubble /> : null}
        </ScrollView>

        <View className="border-t border-iron-800 bg-iron-950 px-3 pb-6 pt-2.5">
          <View className="flex-row items-end">
            {/* Voice — roadmap'd, no native speech dep yet. */}
            <Pressable
              disabled
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              className="mr-2 h-11 flex-row items-center rounded-full border border-iron-700 bg-iron-900 px-3 opacity-50">
              <Ionicons name="mic-outline" size={16} color="#a8a29e" />
              <Text variant="caption" className="ml-1">
                soon
              </Text>
            </Pressable>

            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask your coach…"
              placeholderTextColor="#78716c"
              multiline
              editable={!sending}
              className="max-h-32 min-h-[44px] flex-1 rounded-2xl border border-iron-700 bg-iron-900 px-4 py-2.5 text-base text-iron-50"
              style={{ textAlignVertical: 'center' }}
            />

            <Pressable
              onPress={() => void send(input)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              className={`ml-2 h-11 w-11 items-center justify-center rounded-full ${
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
