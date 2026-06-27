import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { StatsSummary } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Feedback';
import { formatWeight } from '@/lib/format';

function StatTile({ value, label }: { value: string | number; label: string }) {
  return (
    <Card className="flex-1 items-center py-3">
      <Text variant="title" className="text-brand">
        {value}
      </Text>
      <Text variant="caption" className="mt-0.5 uppercase tracking-wide">
        {label}
      </Text>
    </Card>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { settings } = useSettings();
  const { workout: active, start } = useActiveWorkout();
  const { configured: aiConfigured, loading: aiLoading } = useAiStatus();

  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const s = await api.statsSummary().catch(() => null);
      if (s) setStats(s);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData]),
  );

  async function onStartBlank() {
    setStarting(true);
    try {
      const w = await start({ name: 'Quick workout' });
      router.push(`/workout/active/${w.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-2 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchData();
            }}
          />
        }>
        {!aiLoading && !aiConfigured ? (
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            className="mt-2 flex-row items-center rounded-lg border border-brand bg-brand/10 p-4 active:opacity-80">
            <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-brand/20">
              <Ionicons name="sparkles" size={22} color="#f97316" />
            </View>
            <View className="flex-1">
              <Text variant="subheading" className="text-brand">
                Set up your AI coach
              </Text>
              <Text variant="caption" className="mt-0.5">
                Connect your local AI (Ollama) to unlock your coach, natural-language
                logging, and routine import.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#f97316" />
          </Pressable>
        ) : null}

        <View className="mt-2 rounded-lg border border-iron-700 bg-iron-900 p-4">
          <Text variant="label" className="text-brand">
            TRAINING DECK
          </Text>
          <Text variant="title" className="mt-1">
            {user?.display_name ?? 'Athlete'}
          </Text>
          <Text variant="muted" className="mt-1">
            Log the work. Beat the last session.
          </Text>
        </View>

        {active ? (
          <Card
            className="mt-4 border-brand bg-iron-900"
            onPress={() => router.push(`/workout/active/${active.id}`)}>
            <Text variant="label" className="text-brand">
              Workout in progress
            </Text>
            <Text variant="subheading" className="mt-0.5">
              {active.name ?? 'Active workout'} · {active.exercises.length} exercises
            </Text>
            <Text variant="muted" className="mt-1">
              Tap to resume
            </Text>
          </Card>
        ) : (
          <Button
            title="Start workout"
            size="lg"
            className="mt-4"
            loading={starting}
            onPress={onStartBlank}
          />
        )}

        <View className="mt-4 flex-row gap-3">
          <Pressable
            onPress={() => router.push('/routine-import')}
            accessibilityRole="button"
            className="flex-1 rounded-lg border border-brand/50 bg-iron-900 p-4 active:opacity-70">
            <View className="mb-2 h-9 w-9 items-center justify-center rounded-full bg-brand/15">
              <Ionicons name="document-text-outline" size={20} color="#f97316" />
            </View>
            <Text variant="subheading">Import from notes</Text>
            <Text variant="caption" className="mt-0.5">
              Paste a routine, let AI build it
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/routines')}
            accessibilityRole="button"
            className="flex-1 rounded-lg border border-iron-700 bg-iron-900 p-4 active:opacity-70">
            <View className="mb-2 h-9 w-9 items-center justify-center rounded-full bg-iron-800">
              <Ionicons name="list-outline" size={20} color="#f97316" />
            </View>
            <Text variant="subheading">Routines</Text>
            <Text variant="caption" className="mt-0.5">
              View and start your plans
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <Loading />
        ) : (
          <>
            <View className="mt-6 flex-row gap-3">
              <StatTile value={stats?.total_workouts ?? 0} label="Total" />
              <StatTile value={stats?.this_week ?? 0} label="This week" />
              <StatTile value={stats?.recent_prs?.length ?? 0} label="Recent PRs" />
            </View>

            {stats?.recent_prs && stats.recent_prs.length > 0 ? (
              <View className="mt-6">
                <Text variant="heading" className="mb-2">
                  Recent PRs
                </Text>
                <Card className="gap-2">
                  {stats.recent_prs.slice(0, 4).map((pr, i) => (
                    <View
                      key={`${pr.exercise_id}-${i}`}
                      className="flex-row items-center justify-between">
                      <Text variant="body" numberOfLines={1} className="flex-1">
                        {pr.exercise_name ?? 'Exercise'}
                      </Text>
                      <Text variant="label">
                        {formatWeight(pr.weight, settings.units)} × {pr.reps}
                      </Text>
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
