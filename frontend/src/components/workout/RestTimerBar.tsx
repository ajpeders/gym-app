import { Pressable, View } from 'react-native';

import type { RestTimer } from '@/hooks/use-rest-timer';
import { Text } from '@/components/ui/Text';
import { formatClock } from '@/lib/format';

export function RestTimerBar({ timer }: { timer: RestTimer }) {
  const active = timer.running || timer.remaining > 0;
  const progress = timer.duration > 0 ? timer.remaining / timer.duration : 0;

  return (
    <View className="rounded-lg border border-iron-700 bg-iron-900 p-4">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-xs font-bold uppercase text-iron-400">Rest timer</Text>
          <Text className="text-4xl font-black text-iron-50 tabular-nums mt-0.5">
            {formatClock(active ? timer.remaining : timer.duration)}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {active ? (
            <>
              <Pill label="-15s" onPress={() => timer.addTime(-15)} />
              <Pill label="+15s" onPress={() => timer.addTime(15)} />
              {timer.running ? (
                <Pill label="Pause" onPress={timer.pause} />
              ) : (
                <Pill label="Resume" onPress={timer.resume} primary />
              )}
              <Pill label="Skip" onPress={timer.skip} />
            </>
          ) : (
            <Pill label="Start" onPress={() => timer.start()} primary />
          )}
        </View>
      </View>
      <View className="mt-3 h-2 rounded-full bg-iron-800 overflow-hidden">
        <View
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </View>
    </View>
  );
}

function Pill({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-lg px-2.5 py-1.5 active:opacity-70 ${
        primary ? 'bg-brand' : 'bg-iron-800 border border-iron-700'
      }`}>
      <Text className={`text-xs font-bold ${primary ? 'text-iron-950' : 'text-iron-100'}`}>{label}</Text>
    </Pressable>
  );
}
