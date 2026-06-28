import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { StatsSummary } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useActiveWorkout } from '@/state/active-workout';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading } from '@/components/ui/Feedback';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

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

function FeatureCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-1 rounded-lg border border-iron-700 bg-iron-900 p-4 active:opacity-70">
      <View className="mb-2 h-9 w-9 items-center justify-center rounded-full bg-brand/15">
        <Ionicons name={icon} size={20} color="#f97316" />
      </View>
      <Text variant="subheading">{title}</Text>
      <Text variant="caption" className="mt-0.5">
        {subtitle}
      </Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
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

  const streak = stats?.streak ?? 0;

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
        <Text variant="title" className="mt-3">
          Hey{user?.display_name ? `, ${user.display_name}` : ''}
        </Text>

        {!aiLoading && !aiConfigured ? (
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            className="mt-3 flex-row items-center rounded-lg border border-brand bg-brand/10 p-4 active:opacity-80">
            <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-brand/20">
              <Ionicons name="sparkles" size={22} color="#f97316" />
            </View>
            <View className="flex-1">
              <Text variant="subheading" className="text-brand">
                Set up your AI coach
              </Text>
              <Text variant="caption" className="mt-0.5">
                Connect your local AI to unlock the coach, logging, and import.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#f97316" />
          </Pressable>
        ) : null}

        {/* Primary: start or resume today's session */}
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

        {/* Status: streak + glance */}
        {loading ? (
          <Loading />
        ) : (
          <View className="mt-5">
            <Card className="flex-row items-center">
              <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-brand/15">
                <Ionicons name="flame" size={24} color="#f97316" />
              </View>
              <View className="flex-1">
                <Text variant="subheading">
                  {streak > 0 ? `${streak}-day streak` : 'Start a streak'}
                </Text>
                <Text variant="caption" className="mt-0.5">
                  {streak > 0 ? 'Keep it going — train today.' : 'Log a workout today to begin.'}
                </Text>
              </View>
            </Card>

            <View className="mt-3 flex-row gap-3">
              <StatTile value={stats?.this_week ?? 0} label="This week" />
              <StatTile value={stats?.total_workouts ?? 0} label="Total" />
              <StatTile value={stats?.recent_prs?.length ?? 0} label="PRs" />
            </View>
          </View>
        )}

        {/* Everything not in the bottom tabs */}
        <View className="mt-6 gap-3">
          <View className="flex-row gap-3">
            <FeatureCard
              icon="barbell-outline"
              title="Workouts"
              subtitle="History & past sessions"
              onPress={() => router.push('/workouts')}
            />
            <FeatureCard
              icon="fitness-outline"
              title="Exercises"
              subtitle="Browse the library"
              onPress={() => router.push('/exercises')}
            />
          </View>
          <View className="flex-row gap-3">
            <FeatureCard
              icon="clipboard-outline"
              title="Routines"
              subtitle="View & start plans"
              onPress={() => router.push('/routines')}
            />
            <FeatureCard
              icon="document-text-outline"
              title="Import"
              subtitle="Paste a routine"
              onPress={() => router.push('/routine-import')}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
