import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api, ApiError } from '@/api/client';
import type { CheckinResult } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/Feedback';

interface Props {
  /** Bubble the freshly-updated profile up (e.g. so a parent can refresh). */
  onUpdated?: (result: CheckinResult) => void;
  className?: string;
}

const PLACEHOLDER = "shoulder's tight today, only have dumbbells…";

export function CoachCheckin({ onUpdated, className }: Props) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);

  async function onSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.checkIn(trimmed);
      setResult(res);
      setText('');
      onUpdated?.(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) {
        setError('Coach unavailable — check Settings.');
      } else {
        setError("Couldn't reach your coach. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const profile = result?.profile;

  return (
    <Card className={`border-brand ${className ?? ''}`}>
      <Pressable
        onPress={() => router.push('/profile')}
        accessibilityRole="button"
        className="flex-row items-center justify-between active:opacity-70">
        <View className="flex-1 pr-2">
          <Text variant="subheading" className="text-brand">
            🏋️ Check in with your coach
          </Text>
          <Text variant="caption" className="mt-0.5">
            Tell it how you feel — it updates your athlete profile.
          </Text>
        </View>
        <Text className="text-xl text-brand">›</Text>
      </Pressable>

      <View className="mt-3">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={PLACEHOLDER}
          placeholderTextColor="#64748b"
          multiline
          editable={!busy}
          className="min-h-[64px] rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-base text-iron-50"
          style={{ textAlignVertical: 'top' }}
        />

        {error ? (
          <View className="mt-3">
            <FormError message={error} />
          </View>
        ) : null}

        <View className="mt-3 flex-row items-center gap-2">
          {/* Voice — roadmap'd, no native speech dep yet. */}
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
              title={busy ? 'Coaching…' : 'Check in'}
              loading={busy}
              disabled={!text.trim()}
              onPress={onSubmit}
            />
          </View>
        </View>

        {busy ? (
          <Text variant="caption" className="mt-2 text-center">
            Your coach is thinking… this can take a few seconds.
          </Text>
        ) : null}

        <Pressable
          onPress={() => router.push('/coach')}
          accessibilityRole="button"
          className="mt-3 flex-row items-center justify-center active:opacity-60">
          <Text variant="label" className="text-brand">
            💬 Ask your coach ›
          </Text>
        </Pressable>
      </View>

      {result ? (
        <View className="mt-3 rounded-lg border border-iron-700 bg-iron-950 p-3">
          <Text variant="body" className="italic">
            “{result.acknowledgement}”
          </Text>

          {profile?.session_note ? (
            <View className="mt-3">
              <Text variant="label" className="text-brand">
                TODAY
              </Text>
              <Text variant="body" className="mt-0.5">
                {profile.session_note}
              </Text>
            </View>
          ) : null}

          {profile && profile.injuries.length > 0 ? (
            <View className="mt-3">
              <Text variant="label" className="text-red-400">
                INJURIES
              </Text>
              <View className="mt-1 flex-row flex-wrap">
                {profile.injuries.map((inj) => (
                  <View
                    key={inj}
                    className="mb-1.5 mr-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1">
                    <Text variant="caption" className="text-red-300">
                      {inj}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View className="mt-3 flex-row items-center justify-between">
            <Text variant="caption" className="flex-1 pr-2">
              {result.provider} · {result.model} · {result.latency_ms} ms
            </Text>
            <Pressable
              onPress={() => router.push('/profile')}
              hitSlop={8}
              accessibilityRole="button"
              className="active:opacity-60">
              <Text variant="label" className="text-brand">
                View profile ›
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Card>
  );
}
