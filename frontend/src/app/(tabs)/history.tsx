import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Session, StatsSummary, Workout } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, EmptyState } from '@/components/ui/Feedback';
import { formatDuration, relativeTime } from '@/lib/format';

function formatVolume(value: number): string {
  const rounded = Math.round(value);
  return rounded >= 1000 ? `${Math.round(rounded / 100) / 10}k` : String(rounded);
}

function SummaryTile({
  icon,
  label,
  value,
  tone = 'brand',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  tone?: 'brand' | 'mint' | 'steel';
}) {
  const colors = {
    brand: { box: 'border-brand/30 bg-brand/10', text: 'text-brand', icon: '#818cf8' },
    mint: { box: 'border-mint/30 bg-mint/10', text: 'text-mint', icon: '#2dd4bf' },
    steel: { box: 'border-steel/30 bg-steel/10', text: 'text-steel', icon: '#22d3ee' },
  }[tone];

  return (
    <View className={`flex-1 rounded-lg border px-3 py-3 ${colors.box}`}>
      <Ionicons name={icon} size={17} color={colors.icon} />
      <Text variant="heading" className={`mt-2 ${colors.text}`} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function StatBadge({
  icon,
  label,
  tone = 'brand',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone?: 'brand' | 'mint' | 'steel';
}) {
  const colors = {
    brand: { box: 'border-brand/30 bg-brand/10', text: 'text-brand', icon: '#818cf8' },
    mint: { box: 'border-mint/30 bg-mint/10', text: 'text-mint', icon: '#2dd4bf' },
    steel: { box: 'border-steel/30 bg-steel/10', text: 'text-steel', icon: '#22d3ee' },
  }[tone];

  return (
    <View className={`flex-row items-center rounded-full border px-2.5 py-1 ${colors.box}`}>
      <Ionicons name={icon} size={13} color={colors.icon} />
      <Text variant="caption" className={`ml-1 font-bold ${colors.text}`} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function HistoryScreen() {
  const router = useRouter();
  const { start, activeId } = useActiveWorkout();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [w, r, summary] = await Promise.all([
        api.sessions({ limit: 50 }),
        api.workouts().catch(() => [] as Workout[]),
        api.statsSummary().catch(() => null),
      ]);
      setSessions(w.items);
      setWorkouts(r);
      setStats(summary);
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

  async function startBlank() {
    setBusy(true);
    try {
      const w = await start({ name: 'Quick session' });
      router.push(`/session/active/${w.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function startFromWorkout(workout: Workout) {
    setBusy(true);
    try {
      const w = await start({
        workout_id: workout.id,
        name: workout.name,
      });
      router.push(`/session/active/${w.id}`);
    } finally {
      setBusy(false);
    }
  }

  const completed = sessions.filter((w) => w.finished_at != null);

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-4 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchData();
            }}
          />
        }>
        <ScreenHeader
          eyebrow="Training log"
          title="History"
          subtitle="Start training now or review what you have completed."
        />

        {stats ? (
          <View className="mb-5">
            <View className="mb-2 flex-row gap-2">
              <SummaryTile
                icon="calendar-outline"
                label="Last 7 days"
                value={String(stats.this_week)}
              />
              <SummaryTile
                icon="flame-outline"
                label="Streak"
                value={`${stats.streak ?? 0}d`}
                tone="mint"
              />
              <SummaryTile
                icon="barbell-outline"
                label="Total"
                value={String(stats.total_workouts)}
                tone="steel"
              />
            </View>
            <Card className="rounded-[20px] p-4">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text variant="caption" className="font-bold uppercase tracking-wider text-iron-400">
                    Latest weekly volume
                  </Text>
                  <Text variant="heading" className="mt-1">
                    {formatVolume(stats.volume_by_week.at(-1)?.volume ?? 0)}
                  </Text>
                </View>
                {stats.recent_prs[0] ? (
                  <View className="ml-4 flex-1 items-end">
                    <Text variant="caption" className="font-bold uppercase tracking-wider text-iron-400">
                      Top PR
                    </Text>
                    <Text variant="subheading" className="mt-1 text-right" numberOfLines={1}>
                      {stats.recent_prs[0].exercise ?? stats.recent_prs[0].exercise_name ?? 'Exercise'}
                    </Text>
                    <Text variant="caption" className="mt-0.5 text-iron-400">
                      {stats.recent_prs[0].weight} x {stats.recent_prs[0].reps ?? '-'}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Card>
          </View>
        ) : null}

        {activeId ? (
          <Card elevated className="mb-4 rounded-[24px] border-brand bg-brand/10 p-5">
            <View className="mb-4 flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl bg-brand">
                <Ionicons name="radio-button-on" size={14} color="#070b12" />
              </View>
              <View className="flex-1">
                <Text variant="heading">Active session</Text>
                <Text variant="caption" className="mt-0.5 text-iron-300">
                  Keep logging where you left off.
                </Text>
              </View>
            </View>
            <Button
              title="Resume"
              size="lg"
              icon="play"
              onPress={() => router.push(`/session/active/${activeId}`)}
            />
          </Card>
        ) : (
          <Card elevated className="mb-4 p-5">
            <Text variant="heading">Start a session</Text>
            <Text variant="muted" className="mt-1 mb-4">
              Begin empty, or choose one of your saved plans below.
            </Text>
            <Button
              title="Start empty session"
              size="lg"
              icon="add"
              loading={busy}
              onPress={startBlank}
            />
            <Button
              title="Add a past session"
              variant="secondary"
              icon="create-outline"
              className="mt-2"
              disabled={busy}
              onPress={() => router.push('/session/log')}
            />
          </Card>
        )}

        {workouts.length > 0 ? (
          <View className="mb-5">
            <SectionHeader
              title="From a plan"
              subtitle="Start with exercises and targets already loaded."
              className="mt-0"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {workouts.map((r) => (
                  <Card
                    key={r.id}
                    onPress={() => startFromWorkout(r)}
                    className="w-48 rounded-[22px] border-iron-700 bg-iron-900 p-5">
                    <View className="mb-3 h-11 w-11 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
                      <Ionicons name="clipboard-outline" size={20} color="#818cf8" />
                    </View>
                    <Text variant="subheading" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text variant="muted" className="mt-0.5">
                      {r.exercises.length} exercises
                    </Text>
                  </Card>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        <SectionHeader
          title="History"
          subtitle={completed.length > 0 ? `${completed.length} completed sessions` : 'No completed sessions yet'}
          className="mt-0"
        />

        {loading ? (
          <Loading />
        ) : completed.length === 0 ? (
          <EmptyState
            icon="LOG"
            title="No completed sessions"
            subtitle="Finish a session and it will show up here."
          />
        ) : (
          <View className="gap-2">
            {completed.map((w) => (
              <Card key={w.id} onPress={() => router.push(`/session/${w.id}`)}>
                <View className="flex-row items-center justify-between">
                  <View className="mr-3 h-11 w-11 items-center justify-center rounded-lg border border-iron-700 bg-iron-850">
                    <Ionicons name="checkmark" size={20} color="#2dd4bf" />
                  </View>
                  <View className="flex-1">
                    <Text variant="subheading" numberOfLines={1}>
                      {w.name ?? 'Session'}
                    </Text>
                    <Text variant="caption" className="mt-0.5">
                      {relativeTime(w.finished_at ?? w.started_at)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#475569" />
                </View>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <StatBadge icon="fitness-outline" label={`${w.exercises.length} exercises`} />
                  <StatBadge
                    icon="checkmark-done-outline"
                    label={`${w.exercises.reduce((acc, e) => acc + e.sets.length, 0)} sets`}
                    tone="mint"
                  />
                  <StatBadge
                    icon="time-outline"
                    label={formatDuration(w.started_at, w.finished_at)}
                    tone="steel"
                  />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
