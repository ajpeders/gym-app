import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Session } from '@/api/types';
import { useSettings } from '@/state/settings';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { formatDateTime, formatDuration, formatLoad, titleCase } from '@/lib/format';
import { promptExport, sessionToJson, sessionToText } from '@/lib/export';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text variant="subheading">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setSession(await api.session(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  const totalSets = session?.exercises.reduce((acc, e) => acc + e.sets.length, 0) ?? 0;
  const totalVolume =
    session?.exercises.reduce(
      (acc, e) => acc + e.sets.reduce((a, s) => a + (s.reps ?? 0) * (s.weight ?? 0), 0),
      0,
    ) ?? 0;

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: session?.name ?? 'Session',
          headerRight: () =>
            session ? (
              <Pressable
                onPress={() =>
                  promptExport(
                    session.name || 'Session',
                    sessionToText(session, settings.units),
                    sessionToJson(session, settings.units),
                  )
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Export session"
                className="pl-3 active:opacity-60">
                <Ionicons name="share-outline" size={22} color="#818cf8" />
              </Pressable>
            ) : null,
        }}
      />
      {loading ? (
        <Loading />
      ) : error || !session ? (
        <ErrorState message={error ?? 'Not found'} onRetry={fetch} />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
          <Text variant="title">{session.name ?? 'Session'}</Text>
          <Text variant="muted" className="mt-0.5">
            {formatDateTime(session.started_at)}
          </Text>

          <View className="flex-row justify-between my-4">
            <Stat label="Duration" value={formatDuration(session.started_at, session.finished_at)} />
            <Stat label="Exercises" value={String(session.exercises.length)} />
            <Stat label="Sets" value={String(totalSets)} />
            <Stat label="Volume" value={`${Math.round(totalVolume)} ${settings.units}`} />
          </View>

          {session.notes ? (
            <Card className="mb-3">
              <Text variant="label" className="mb-1">
                Notes
              </Text>
              <Text variant="body">{session.notes}</Text>
            </Card>
          ) : null}

          {session.exercises
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((we) => (
              <Card key={we.id} className="mb-3">
                <Text variant="subheading">{we.exercise?.name ?? 'Exercise'}</Text>
                {we.exercise?.primary_muscles?.length ? (
                  <Text variant="muted" numberOfLines={1}>
                    {we.exercise.primary_muscles.map(titleCase).join(', ')}
                  </Text>
                ) : null}
                <View className="mt-2 gap-1">
                  {we.sets.length === 0 ? (
                    <Text variant="muted">No sets logged.</Text>
                  ) : (
                    we.sets.map((s, i) => (
                      <View
                        key={s.id}
                        className="flex-row items-center rounded-md bg-iron-800 px-3 py-2">
                        <Text variant="label" className="w-10">
                          {i + 1}
                        </Text>
                        <Text variant="body" className="flex-1">
                          {formatLoad(s.weight, settings.units)} × {s.reps}
                        </Text>
                        {s.rpe ? <Text variant="muted">RPE {s.rpe}</Text> : null}
                      </View>
                    ))
                  )}
                </View>
              </Card>
            ))}
        </ScrollView>
      )}
    </Screen>
  );
}
