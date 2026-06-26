import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import type { SetInput } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { useRestTimer } from '@/hooks/use-rest-timer';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Loading } from '@/components/ui/Feedback';
import { RestTimerBar } from '@/components/workout/RestTimerBar';
import { ActiveExerciseCard } from '@/components/workout/ActiveExerciseCard';
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
    addSet,
    removeSet,
    removeExercise,
    finish,
    discard,
  } = useActiveWorkout();

  const [ready, setReady] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const timer = useRestTimer(settings.rest_timer_default);

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
      // auto-start rest timer after logging a set
      timer.start();
    },
    [addSet, timer],
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
    (acc, e) => acc + e.sets.reduce((a, s) => a + s.reps * s.weight, 0),
    0,
  );

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen
        options={{
          headerShown: true,
          title: workout.name ?? 'Workout',
          headerRight: () => (
            <Pressable onPress={onDiscard} hitSlop={8}>
              <Text className="text-red-500 font-semibold mr-1">Discard</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-40">
        {/* summary */}
        <View className="flex-row justify-between mb-3">
          <Stat label="Duration" value={formatDuration(workout.started_at)} />
          <Stat label="Exercises" value={String(workout.exercises.length)} />
          <Stat label="Sets" value={String(totalSets)} />
          <Stat
            label="Volume"
            value={`${Math.round(totalVolume)} ${settings.units}`}
          />
        </View>

        <View className="mb-3">
          <RestTimerBar timer={timer} />
        </View>

        {/* in-set AI prompt stub */}
        {settings.feature_flags.in_set_prompts ? (
          <Card className="mb-3 border-brand bg-iron-900">
            <Text variant="label" className="text-brand">
              AI coaching · on
            </Text>
            <Text variant="muted" className="mt-1">
              Between-set coaching prompts will appear here once AI is connected. (Preview - no
              suggestions are generated yet.)
            </Text>
          </Card>
        ) : (
          <Card className="mb-3">
            <Text variant="label" className="text-iron-400">
              AI coaching · off
            </Text>
            <Text variant="muted" className="mt-1">
              Enable in-set prompts in Settings to preview AI coaching.
            </Text>
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
          className="mt-1"
          onPress={() => router.push('/workout/add-exercise')}
        />
      </ScrollView>

      {/* finish bar */}
      <View className="absolute bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-iron-950/95 border-t border-iron-800">
        <Button title="Finish workout" size="lg" loading={finishing} onPress={onFinish} />
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text variant="subheading">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}
