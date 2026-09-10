import { View } from 'react-native';

import type { OverloadSuggestion } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';

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
 * number can't disagree. Shown on Home next to Start, and on Insights. */
export function NextTargets({
  workoutName,
  suggestions,
  className,
}: {
  workoutName: string;
  suggestions: OverloadSuggestion[];
  className?: string;
}) {
  return (
    <Card className={`mb-4 ${className ?? ''}`}>
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
