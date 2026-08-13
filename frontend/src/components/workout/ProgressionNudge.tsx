import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';

/**
 * "When you hit the top of the rep range for all sets, increase weight next
 * time" — the rule every plan states and the app used to stay quiet about.
 *
 * Whether it was earned is decided server-side (`cleared_rep_range` on a
 * session exercise), so a set logged offline surfaces the nudge once the queue
 * syncs rather than immediately.
 */
export function ProgressionNudge({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <View className="mt-3 flex-row items-center rounded-lg bg-emerald-500/10 px-3 py-2">
      <Ionicons name="trending-up" size={16} color="#34d399" />
      <Text variant="caption" className="ml-2 flex-1 font-semibold text-emerald-400">
        Top of the range on every set — add weight next time.
      </Text>
    </View>
  );
}
