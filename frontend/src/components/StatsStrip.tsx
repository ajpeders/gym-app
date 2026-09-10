import { View } from 'react-native';

import type { StatsSummary } from '@/api/types';
import { Text } from '@/components/ui/Text';

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="min-w-0 flex-1 items-center px-2 py-2.5">
      <Text variant="subheading" className="text-brand" numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The three training numbers, the same way everywhere.
 *
 * Home, History and the profile each had their own strip with its own labels
 * ("This week" / "Last 7 days" / "7 days"), and once the server counted an
 * unfinished session they showed different numbers too. One component, one
 * vocabulary; the rule (finished sessions only) lives on the server.
 *
 * Zeros stay visible on a fresh account — Alex's call — so the strip is the
 * same shape on day one as on day one hundred.
 */
export function StatsStrip({ stats, className }: { stats: StatsSummary; className?: string }) {
  return (
    <View
      className={`flex-row divide-x divide-iron-800 rounded-2xl border border-iron-800 bg-iron-900/70 ${className ?? ''}`}>
      <Stat value={String(stats.this_week)} label="This week" />
      <Stat value={`${stats.streak ?? 0}d`} label="Streak" />
      <Stat value={String(stats.total_workouts)} label="Sessions" />
    </View>
  );
}
