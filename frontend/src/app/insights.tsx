import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type {
  Achievement,
  MuscleCoverage,
  MuscleReport,
  OverloadSuggestion,
  StatsSummary,
  TodayWorkout,
} from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { titleCase } from '@/lib/format';

/**
 * Where the training actually went.
 *
 * Every number here is arithmetic over logged sets (`api/app/analysis.py`) —
 * no model is involved, and the screen says so, because "your rear delts are
 * undertrained" is only worth reading if it's counted rather than guessed.
 */

const WINDOWS = [1, 4, 12];

const STATUS: Record<MuscleCoverage['status'], { label: string; tint: string; bar: string }> = {
  missing: { label: 'Nothing logged', tint: 'text-red-300', bar: 'bg-red-500/70' },
  under: { label: 'Below the useful range', tint: 'text-amber-300', bar: 'bg-amber-400/80' },
  productive: { label: 'In the productive range', tint: 'text-brand', bar: 'bg-brand' },
  over: { label: 'Past what you can recover from', tint: 'text-amber-300', bar: 'bg-amber-400/80' },
};

/** A muscle's weekly sets drawn against its own MRV, so the bars are comparable. */
function CoverageRow({ row }: { row: MuscleCoverage }) {
  const status = STATUS[row.status];
  const pct = Math.min(100, Math.round((row.weekly_sets / row.mrv) * 100));

  return (
    <View className="mb-3.5">
      <View className="mb-1 flex-row items-center justify-between">
        <Text variant="label">{titleCase(row.muscle)}</Text>
        <Text variant="caption" className={status.tint}>
          {row.weekly_sets} sets/wk
        </Text>
      </View>
      <View className="h-2.5 w-full overflow-hidden rounded-full bg-iron-800">
        <View className={`h-full rounded-full ${status.bar}`} style={{ width: `${pct}%` }} />
      </View>
      <View className="mt-1 flex-row items-center justify-between">
        <Text variant="caption" className="text-iron-500">
          {status.label}
        </Text>
        <Text variant="caption" className="text-iron-500">
          aim {row.mev}–{row.mav}
        </Text>
      </View>
    </View>
  );
}

/** Weekly volume as bars. Deliberately plain Views: a charting library is a lot
 * of bundle for eight bars, and this scales to the window's own maximum. */
function VolumeChart({ weeks }: { weeks: { week: string; volume: number }[] }) {
  const recent = weeks.slice(-8);
  const peak = Math.max(...recent.map((w) => w.volume), 1);
  return (
    <View className="flex-row items-end justify-between" style={{ height: 120 }}>
      {recent.map((w) => (
        <View key={w.week} className="flex-1 items-center px-0.5">
          <View
            className="w-full rounded-t bg-brand/80"
            style={{ height: Math.max(3, Math.round((w.volume / peak) * 96)) }}
          />
          <Text variant="caption" className="mt-1 text-iron-500" numberOfLines={1}>
            {w.week.slice(-3)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const ACTION_LABEL: Record<OverloadSuggestion['action'], string> = {
  start: 'First time',
  repeat: 'Same again',
  add_weight: 'Add weight',
  add_reps: 'Add a rep',
  add_time: 'Add time',
};

/** What the plan's own rule says to aim for next time on each movement.
 *
 * Derived from the last session's sets, never from a model — the same rule
 * that decides whether the progression badge lights up, so the badge and the
 * number can't disagree. */
function NextTargets({
  workoutName,
  suggestions,
}: {
  workoutName: string;
  suggestions: OverloadSuggestion[];
}) {
  return (
    <Card className="mb-4">
      <Text variant="heading">Next time: {workoutName}</Text>
      <Text variant="muted" className="mb-3 mt-0.5">
        Clear the top of the rep range on every working set and the weight goes up.
      </Text>
      {suggestions.map((s) => (
        <View key={s.exercise_id} className="mb-3 last:mb-0">
          <View className="flex-row items-center justify-between">
            <Text variant="label" className="flex-1 pr-2" numberOfLines={1}>
              {s.exercise_name}
            </Text>
            <Text
              variant="caption"
              className={s.action === 'repeat' || s.action === 'start' ? '' : 'font-bold text-brand'}>
              {ACTION_LABEL[s.action]}
              {s.weight != null ? ` · ${s.weight}kg` : ''}
              {s.reps != null ? ` x ${s.reps}` : ''}
              {s.duration_seconds != null ? ` · ${s.duration_seconds}s` : ''}
            </Text>
          </View>
          <Text variant="caption" className="mt-0.5 text-iron-500">
            {s.reason}
          </Text>
        </View>
      ))}
    </Card>
  );
}

export default function InsightsScreen() {
  const [weeks, setWeeks] = useState(4);
  const [report, setReport] = useState<MuscleReport | null>(null);
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [nextUp, setNextUp] = useState<{ name: string; suggestions: OverloadSuggestion[] } | null>(
    null,
  );
  const [awards, setAwards] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s, today, earned] = await Promise.all([
        api.muscleReport(weeks),
        api.statsSummary(),
        api.splitToday().catch(() => [] as TodayWorkout[]),
        api.achievements().catch(() => [] as Achievement[]),
      ]);
      setReport(r);
      setSummary(s);
      setAwards(earned);
      // Whatever the plan says is due — today's day in a weekday split, the
      // next one round in a rotation.
      const due = today.find((w) => w.up_next || w.scheduled_today) ?? today[0];
      setNextUp(
        due
          ? {
              name: due.name,
              suggestions: await api.workoutSuggestions(String(due.id)).catch(() => []),
            }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your training analysis');
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  if (loading && !report) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Insights' }} />
        <Loading />
      </Screen>
    );
  }

  if (error || !report) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Insights' }} />
        <ErrorState message={error ?? 'No analysis available'} onRetry={fetch} />
      </Screen>
    );
  }

  const gaps = report.coverage.filter((r) => r.status === 'missing' || r.status === 'under');

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Insights' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        <View className="mb-4 flex-row gap-2">
          {WINDOWS.map((w) => (
            <Pressable
              key={w}
              onPress={() => setWeeks(w)}
              accessibilityRole="radio"
              accessibilityState={{ selected: weeks === w }}
              className={`flex-1 items-center rounded-lg border py-2 ${
                weeks === w ? 'border-brand bg-brand/10' : 'border-iron-700 bg-iron-900'
              }`}>
              <Text variant="caption" className={weeks === w ? 'font-bold text-brand' : ''}>
                {w === 1 ? 'This week' : `${w} weeks`}
              </Text>
            </Pressable>
          ))}
        </View>

        {nextUp && nextUp.suggestions.length > 0 ? (
          <NextTargets workoutName={nextUp.name} suggestions={nextUp.suggestions} />
        ) : null}

        <Card className="mb-4">
          <Text variant="heading">Volume by muscle</Text>
          <Text variant="muted" className="mb-4 mt-0.5">
            {report.total_hard_sets} hard sets over {report.weeks}{' '}
            {report.weeks === 1 ? 'week' : 'weeks'}. Warmups and drop sets aren&apos;t counted;
            a movement&apos;s secondary muscles get half credit.
          </Text>
          {report.coverage.map((row) => (
            <CoverageRow key={row.muscle} row={row} />
          ))}
        </Card>

        {gaps.length > 0 ? (
          <Card className="mb-4 border-amber-500/30 bg-amber-500/5">
            <View className="flex-row items-center">
              <Ionicons name="alert-circle-outline" size={17} color="#fbbf24" />
              <Text variant="heading" className="ml-2">
                Gaps
              </Text>
            </View>
            <Text variant="muted" className="mt-1">
              {gaps.map((g) => titleCase(g.muscle)).join(', ')} — below the range that reliably
              drives progress. Adding a set or two is usually enough.
            </Text>
          </Card>
        ) : null}

        <Card className="mb-4">
          <Text variant="heading">Balance</Text>
          <Text variant="muted" className="mb-3 mt-0.5">
            Ratios of hard sets, not of effort — a lopsided one is worth a look, not a panic.
          </Text>
          {report.ratios.map((r) => (
            <View key={r.name} className="mb-2 flex-row items-center justify-between">
              <Text variant="label">{r.name}</Text>
              <Text variant="caption" className={r.balanced ? 'text-brand' : 'text-amber-300'}>
                {r.ratio == null
                  ? `${r.left} vs ${r.right} — nothing on one side`
                  : `${r.ratio}:1 (${r.left} vs ${r.right})`}
              </Text>
            </View>
          ))}
        </Card>

        {summary && summary.volume_by_week.length > 0 ? (
          <Card className="mb-4">
            <Text variant="heading">Weekly tonnage</Text>
            <Text variant="muted" className="mb-3 mt-0.5">
              Total load moved — reps times weight, summed over each week.
            </Text>
            <VolumeChart weeks={summary.volume_by_week as { week: string; volume: number }[]} />
          </Card>
        ) : null}

        {awards.length > 0 ? (
          <Card className="mb-4">
            <Text variant="heading">Milestones</Text>
            <Text variant="muted" className="mb-3 mt-0.5">
              Nothing here is awarded — each one is just something your log already says.
            </Text>
            {awards.map((award) => (
              <View key={award.slug} className="mb-2.5 last:mb-0">
                <View className="flex-row items-center justify-between">
                  <Text variant="label" className={award.earned ? 'text-brand' : ''}>
                    {award.earned ? '✓ ' : ''}
                    {award.name}
                  </Text>
                  <Text variant="caption" className="text-iron-400">
                    {award.earned
                      ? award.blurb
                      : `${Math.round(award.progress)} of ${Math.round(award.target)}`}
                  </Text>
                </View>
                {!award.earned ? (
                  <View className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-iron-800">
                    <View
                      className="h-full rounded-full bg-iron-600"
                      style={{ width: `${Math.min(100, (award.progress / award.target) * 100)}%` }}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        <Text variant="caption" className="mt-1 text-iron-500">
          Counted from your logged sets, not estimated by a model. Volume landmarks are
          general guidance, not a prescription for you.
        </Text>
      </ScrollView>
    </Screen>
  );
}
