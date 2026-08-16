import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { SetInput } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useSettings } from '@/state/settings';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { BottomAction } from '@/components/ui/BottomAction';
import { Loading } from '@/components/ui/Feedback';
import { ActiveExerciseCard } from '@/components/workout/ActiveExerciseCard';
import { formatDuration } from '@/lib/format';
import { confirm } from '@/lib/confirm';

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
      router.replace('/(tabs)/history');
    } finally {
      setFinishing(false);
    }
  }

  function onDiscard() {
    confirm(
      'Discard session?',
      'This permanently deletes this in-progress session.',
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
        <Stack.Screen options={{ headerShown: true, title: 'Session' }} />
        <Loading label="Loading session…" />
      </SafeAreaView>
    );
  }

  const totalSets = workout.exercises.reduce((acc, e) => acc + e.sets.length, 0);
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen
        options={{
          headerShown: true,
          title: workout.name ?? 'Session',
          headerRight: () => (
            <Pressable
              onPress={onDiscard}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Discard session"
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
        <Card className="mb-3 p-4">
          <View className="flex-row items-center">
            <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-brand/10">
              <Ionicons name="timer-outline" size={21} color="#5eead4" />
            </View>
            <View className="min-w-0 flex-1">
              <Text variant="heading" numberOfLines={1}>
                {formatDuration(workout.started_at)}
              </Text>
              <Text variant="caption" className="mt-0.5 text-iron-400">
                {workout.exercises.length} exercises · {totalSets} sets logged
              </Text>
            </View>
            {settings.feature_flags.in_set_prompts ? (
              <View className="ml-2 flex-row items-center rounded-full bg-brand/10 px-2.5 py-1.5">
                <Ionicons name="sparkles" size={13} color="#5eead4" />
                <Text variant="caption" className="ml-1 font-bold text-brand">
                  Coach on
                </Text>
              </View>
            ) : null}
          </View>
        </Card>

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

        <View className="mb-3 flex-row gap-2">
          <Button
            title="Add exercise"
            icon="add"
            className="flex-1"
            onPress={() => router.push('/session/add-exercise')}
          />
          <Button
            title="Log by text"
            variant="secondary"
            icon="chatbubble-ellipses-outline"
            className="flex-1"
            onPress={() => router.push(`/log-chat?sessionId=${workout.id}`)}
          />
        </View>

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
                sessionExercise={we}
                units={settings.units}
                quickButtons={settings.feature_flags.quick_buttons}
                onAddSet={(input) => onLogSet(we.id, input)}
                onRemoveSet={(setId) => removeSet(we.id, setId)}
                onRemoveExercise={() =>
                  confirm(
                    'Remove exercise?',
                    'This removes the exercise and its sets from this session.',
                    () => void removeExercise(we.id),
                    true,
                  )
                }
                onSwapExercise={() =>
                  router.push(
                    `/session/add-exercise?swapId=${we.id}&swapName=${encodeURIComponent(
                      we.exercise?.name ?? '',
                    )}`,
                  )
                }
              />
            ))
        )}

        {workout.exercises.length > 0 ? (
          <Button
            title="Add another exercise"
            variant="secondary"
            icon="add"
            className="mt-1"
            onPress={() => router.push('/session/add-exercise')}
          />
        ) : null}
      </ScrollView>

      <BottomAction>
        <Button title="Finish session" size="lg" icon="checkmark" loading={finishing} onPress={onFinish} />
      </BottomAction>
    </SafeAreaView>
  );
}
