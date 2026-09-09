import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Session, StatsSummary } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
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
    brand: { box: 'border-brand/30 bg-brand/10', text: 'text-brand', icon: '#5eead4' },
    mint: { box: 'border-mint/30 bg-mint/10', text: 'text-mint', icon: '#34d399' },
    steel: { box: 'border-steel/30 bg-steel/10', text: 'text-steel', icon: '#60a5fa' },
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
    brand: { box: 'border-brand/30 bg-brand/10', text: 'text-brand', icon: '#5eead4' },
    mint: { box: 'border-mint/30 bg-mint/10', text: 'text-mint', icon: '#34d399' },
    steel: { box: 'border-steel/30 bg-steel/10', text: 'text-steel', icon: '#60a5fa' },
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
  const { activeId } = useActiveWorkout();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [w, summary] = await Promise.all([
        api.sessions({ limit: 50 }),
        api.statsSummary().catch(() => null),
      ]);
      setSessions(w.items);
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
          title="History"
          subtitle="Review completed sessions and fill in anything you missed."
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
            <Card className="p-4">
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
          <Card elevated className="mb-4 border-brand/30 bg-brand/10 p-4">
            <View className="flex-row items-center">
              <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-brand">
                <Ionicons name="radio-button-on" size={14} color="#030712" />
              </View>
              <View className="flex-1">
                <Text variant="subheading">Session in progress</Text>
                <Text variant="caption" className="mt-0.5 text-iron-300">
                  Keep logging where you left off.
                </Text>
              </View>
              <Button
                title="Resume"
                size="sm"
                icon="play"
                onPress={() => router.push(`/session/active/${activeId}`)}
              />
            </View>
          </Card>
        ) : null}

        <View className="mb-1 flex-row gap-2">
          <Button
            title="Add past session"
            variant="secondary"
            icon="create-outline"
            className="flex-1"
            onPress={() => router.push('/session/log')}
          />
          <Button
            title="Catch up"
            variant="secondary"
            icon="calendar-outline"
            className="flex-1"
            onPress={() => router.push('/catch-up')}
          />
        </View>

        <Text variant="caption" className="mb-3 mt-6 text-iron-400">
          {completed.length > 0 ? `${completed.length} completed sessions` : 'No completed sessions yet'}
        </Text>

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
                  <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl border border-iron-700 bg-iron-850">
                    <Ionicons name="checkmark" size={20} color="#34d399" />
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
