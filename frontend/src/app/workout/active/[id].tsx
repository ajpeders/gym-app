import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { SetInput } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Feedback';
import { ActiveExerciseCard } from '@/components/workout/ActiveExerciseCard';
import { NaturalLanguageLog } from '@/components/workout/NaturalLanguageLog';
import { formatDuration } from '@/lib/format';

function confirm(title: string, message: string, onConfirm: () => void, destructive = false) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'OK', style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

export default function ActiveWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { settings } = useSettings();
  const {
    workout,
    activeId,
    load,
    refresh,
    addSet,
    removeSet,
    removeExercise,
    finish,
    discard,
    pendingCount,
    sync,
  } = useActiveWorkout();

  const [ready, setReady] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Tick for the running-duration display.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ensureLoaded = useCallback(async () => {
    if (id && activeId !== id) {
      await load(id);
    }
    setReady(true);
  }, [id, activeId, load]);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const onLogSet = useCallback(
    async (weId: string, input: SetInput) => {
      await addSet(weId, input);
    },
    [addSet],
  );

  async function onFinish() {
    setFinishing(true);
    try {
      await finish();
      router.replace('/(tabs)/workouts');
    } finally {
      setFinishing(false);
    }
  }

  function onDiscard() {
    confirm(
      'Discard workout?',
      'This permanently deletes this in-progress workout.',
      async () => {
        await discard();
        router.replace('/(tabs)');
      },
      true,
    );
  }

  if (!ready || !workout) {
    return (
      <SafeAreaView className="flex-1 bg-iron-950">
        <Stack.Screen options={{ headerShown: true, title: 'Workout' }} />
        <Loading label="Loading workout…" />
      </SafeAreaView>
    );
  }

  const totalSets = workout.exercises.reduce((acc, e) => acc + e.sets.length, 0);
  const totalVolume = workout.exercises.reduce(
    (acc, e) => acc + e.sets.reduce((a, s) => a + s.reps * (s.weight ?? 0), 0),
    0,
  );

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen
        options={{
          headerShown: true,
          title: workout.name ?? 'Workout',
          headerRight: () => (
            <Pressable
              onPress={onDiscard}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Discard workout"
              className="mr-1 h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
              <Ionicons name="trash-outline" size={18} color="#ef4444" />
            </Pressable>
          ),
        }}
      />
      {/* keyboardShouldPersistTaps="handled": without it the first tap while the
          keyboard is open is swallowed just to dismiss it, so "Log set" needed
          two presses. */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-3 pb-40"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* summary */}
        <View className="mb-3 flex-row flex-wrap gap-2">
          <Stat icon="time-outline" label="Duration" value={formatDuration(workout.started_at)} />
          <Stat icon="fitness-outline" label="Exercises" value={String(workout.exercises.length)} />
          <Stat icon="checkmark-done-outline" label="Sets" value={String(totalSets)} />
          <Stat
            icon="flash-outline"
            label="Volume"
            value={`${Math.round(totalVolume)} ${settings.units}`}
          />
        </View>

        {pendingCount > 0 ? (
          <Pressable
            onPress={() => void sync()}
            className="mb-3 flex-row items-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 active:opacity-70">
            <Ionicons name="cloud-offline-outline" size={16} color="#fbbf24" />
            <Text variant="caption" className="ml-2 flex-1 font-semibold text-amber-300">
              {pendingCount} set{pendingCount === 1 ? '' : 's'} saved on this device — will sync
              automatically
            </Text>
            <Text variant="caption" className="font-bold text-amber-300">
              Retry
            </Text>
          </Pressable>
        ) : null}

        {/* natural-language set logging */}
        <NaturalLanguageLog workoutId={workout.id} units={settings.units} onApplied={refresh} />

        {/* in-set AI prompt stub */}
        {settings.feature_flags.in_set_prompts ? (
          <Card className="mb-3 border-brand bg-iron-900">
            <View className="flex-row items-center">
              <Ionicons name="sparkles" size={18} color="#f97316" />
              <Text variant="label" className="ml-2 text-brand">
                AI coaching on
              </Text>
            </View>
          </Card>
        ) : (
          <Card className="mb-3">
            <View className="flex-row items-center">
              <Ionicons name="sparkles-outline" size={18} color="#78716c" />
              <Text variant="label" className="ml-2 text-iron-400">
                AI coaching off
              </Text>
            </View>
          </Card>
        )}

        {/* exercises */}
        {workout.exercises.length === 0 ? (
          <Card className="mb-3">
            <Text variant="muted">No exercises yet. Add one to start logging sets.</Text>
          </Card>
        ) : (
          workout.exercises
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((we) => (
              <ActiveExerciseCard
                key={we.id}
                workoutExercise={we}
                units={settings.units}
                quickButtons={settings.feature_flags.quick_buttons}
                onAddSet={(input) => onLogSet(we.id, input)}
                onRemoveSet={(setId) => removeSet(we.id, setId)}
                onRemoveExercise={() =>
                  confirm(
                    'Remove exercise?',
                    'This removes the exercise and its sets from this workout.',
                    () => void removeExercise(we.id),
                    true,
                  )
                }
              />
            ))
        )}

        <Button
          title="Add exercise"
          variant="secondary"
          size="lg"
          icon="add"
          className="mt-1"
          onPress={() => router.push('/workout/add-exercise')}
        />
      </ScrollView>

      {/* finish bar */}
      <View className="absolute bottom-0 left-0 right-0 border-t border-iron-800 bg-iron-950/95 px-4 pb-6 pt-3">
        <Button title="Finish workout" size="lg" icon="checkmark" loading={finishing} onPress={onFinish} />
      </View>
    </SafeAreaView>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  return (
    <View className="w-[48%] rounded-lg border border-iron-800 bg-iron-900/90 px-3 py-2.5">
      <View className="flex-row items-center">
        <Ionicons name={icon} size={14} color="#f97316" />
        <Text variant="caption" className="ml-1.5 text-iron-400">
          {label}
        </Text>
      </View>
      <Text variant="subheading" className="mt-0.5" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
