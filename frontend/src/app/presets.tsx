import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { PresetSplit } from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState } from '@/components/ui/Feedback';

/**
 * The programs shelf.
 *
 * This is the answer to a new account's empty home screen: pick something
 * known-good and start training today. What you adopt is a copy — an ordinary
 * split you can edit freely, with no link back to the library.
 */
export default function PresetsScreen() {
  const router = useRouter();
  const [presets, setPresets] = useState<PresetSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One program open at a time: seven identical primary buttons competed
  // for the tap. Tap a card to read it; Use appears on the open one.
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPresets(await api.presetSplits());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the programs');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  async function adopt(preset: PresetSplit) {
    setAdopting(preset.slug);
    setNotice(null);
    try {
      const result = await api.adoptPreset(preset.slug);
      if (result.unmatched.length > 0) {
        // Better to say which lifts didn't make it than to hand over a program
        // quietly missing two of them.
        setNotice(
          `Added "${result.split.name}" — but ${result.unmatched.join(', ')} weren't in the ` +
            `exercise library, so add them yourself.`,
        );
      }
      router.push(`/split/${result.split.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that program');
    } finally {
      setAdopting(null);
    }
  }

  if (loading && presets.length === 0) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Programs' }} />
        <Loading />
      </Screen>
    );
  }

  if (error && presets.length === 0) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Programs' }} />
        <ErrorState message={error} onRetry={fetch} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Programs' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        <Text variant="muted" className="mb-4">
          Established programs, ready to train. Adding one copies it into your splits — edit it
          however you like from there.
        </Text>

        {notice ? (
          <Card className="mb-4 border-amber-500/30 bg-amber-500/5">
            <Text variant="caption" className="text-amber-200">
              {notice}
            </Text>
          </Card>
        ) : null}
        {error ? <Text className="mb-3 text-sm text-red-400">{error}</Text> : null}

        {presets.map((preset) => {
          const open = openSlug === preset.slug;
          return (
            <Card key={preset.slug} className={`mb-3 ${open ? 'border-brand/40' : ''}`}>
              <Pressable
                onPress={() => setOpenSlug(open ? null : preset.slug)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={preset.name}
                className="active:opacity-70">
                <View className="flex-row items-start">
                  <View className="min-w-0 flex-1">
                    <Text variant="heading" numberOfLines={1}>
                      {preset.name}
                    </Text>
                    <Text variant="caption" className="mt-0.5 text-iron-400">
                      {preset.days_per_week}x / week · {preset.level} ·{' '}
                      {preset.mode === 'rolling' ? 'rotation' : 'fixed weekdays'}
                    </Text>
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
                </View>
                <Text variant="muted" className="mt-2" numberOfLines={open ? undefined : 2}>
                  {preset.description}
                </Text>
              </Pressable>

              {open ? (
                <>
                  <View className="mt-3 rounded-lg border border-iron-800 bg-iron-950/60 p-3">
                    {preset.days.map((day) => (
                      <Text key={day.name} variant="caption" className="mb-1 text-iron-300 last:mb-0">
                        <Text variant="caption" className="font-bold text-iron-200">
                          {day.name}:{' '}
                        </Text>
                        {day.exercises.map((e) => e.exercise).join(', ')}
                      </Text>
                    ))}
                  </View>
                  <Button
                    title={`Use ${preset.name}`}
                    icon="add"
                    className="mt-3"
                    loading={adopting === preset.slug}
                    onPress={() => void adopt(preset)}
                  />
                </>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
