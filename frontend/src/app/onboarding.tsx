import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Units } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useSettings } from '@/state/settings';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * First run, for someone who isn't the person who built this.
 *
 * One screen rather than a wizard: three things worth deciding, each with a
 * sane default already applied, and every one skippable. Nothing here blocks
 * reaching the app — a new account is fully usable if you tap "Skip for now",
 * which is the point. The AI section in particular has to be skippable, since
 * a non-homelab user has no Ollama to point at.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { settings, update } = useSettings();
  const [busy, setBusy] = useState(false);

  // Recorded on settings rather than on the device: onboarding belongs to the
  // account, so a second phone doesn't ask again.
  async function finish(then?: string) {
    setBusy(true);
    try {
      await update({ feature_flags: { ...settings.feature_flags, onboarded: true } });
    } catch {
      // Never trap someone on the welcome screen because a PATCH failed.
    } finally {
      setBusy(false);
    }
    if (then) router.replace(then);
    else router.replace('/(tabs)');
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={user?.display_name ? `Welcome, ${user.display_name}` : 'Welcome'}
        subtitle="Three quick things. You can change any of them later in Settings."
      />

      <Text variant="label" className="mb-2">
        1 · Units
      </Text>
      <Card className="mb-4">
        <Text variant="body" className="mb-3">
          What do the weights in your gym say?
        </Text>
        <View className="flex-row gap-2">
          {(['kg', 'lb'] as Units[]).map((u) => (
            <Button
              key={u}
              title={u === 'kg' ? 'Kilograms' : 'Pounds'}
              variant={settings.units === u ? 'primary' : 'secondary'}
              className="flex-1"
              onPress={() => void update({ units: u })}
            />
          ))}
        </View>
      </Card>

      <Text variant="label" className="mb-2">
        2 · Spotter (optional)
      </Text>
      <Card className="mb-4">
        <Text variant="body">
          The Spotter reads pasted workout notes, logs in plain English and
          reads your log back to you. Connect a local Ollama server or use a
          Claude or OpenAI API key. Everything else works without AI.
        </Text>
        <Button
          title="Set up AI"
          variant="secondary"
          className="mt-3"
          onPress={() => void finish('/(tabs)/coach')}
        />
      </Card>

      <Text variant="label" className="mb-2">
        3 · Your plan
      </Text>
      <Card className="mb-6">
        <Text variant="body">
          Already train on a plan? Paste it in — a whole week of notes becomes
          real, editable workouts. Otherwise just start logging and build one as
          you go.
        </Text>
        <Button
          title="Import my plan"
          variant="secondary"
          className="mt-3"
          onPress={() => void finish('/workout-import')}
        />
      </Card>

      <Button title="Continue to app" size="lg" loading={busy} onPress={() => void finish()} />

      <View className="mt-6 flex-row items-start">
        <Ionicons name="lock-closed-outline" size={14} color="#64748b" />
        <Text variant="caption" className="ml-2 flex-1 text-iron-500">
          Your training stays on the server you point this app at. Export or
          delete all of it any time from Settings.
        </Text>
      </View>
    </Screen>
  );
}
