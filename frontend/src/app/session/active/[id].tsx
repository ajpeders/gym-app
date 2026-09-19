import { useCallback, useEffect, useRef, useState } from 'react';
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
import { isLocalSessionId, resolveId } from '@/lib/offline';
import { isAvailable, listen, type Listener } from '@/lib/speech';
import { api } from '@/api/client';
import type { ReadinessCheck } from '@/api/types';

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

  // Say a set. The words go to the same parser as typed text; the review
  // screen shows what was heard before anything is written.
  // How today feels, asked where it is useful: at the start of a session,
  // before the first set. It used to be an input sitting in the middle of
  // the stats page.
  const [readiness, setReadiness] = useState<ReadinessCheck | null>(null);
  const [readinessSaving, setReadinessSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechAvailable] = useState(() => isAvailable());
  const [speechError, setSpeechError] = useState<string | null>(null);
  const listener = useRef<Listener | null>(null);
  function sayASet() {
    if (!workout) return;
    if (listening) {
      listener.current?.stop();
      return;
    }
    setSpeechError(null);
    setListening(true);
    listener.current = listen({
      onTranscript: (text) =>
        router.push(`/log-chat?sessionId=${workout.id}&text=${encodeURIComponent(text)}`),
      onError: (reason) => setSpeechError(reason),
      onEnd: () => setListening(false),
    });
    if (!listener.current) setListening(false);
  }

  // Tick for the running-duration display.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load once per session id. This must not re-run when `activeId` changes:
  // finishing clears it, and reloading then re-marked the closed session as
  // active for a moment — long enough for History to offer to resume it.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!id || loadedFor.current === id) return;
    loadedFor.current = id;
    void (async () => {
      if (activeId !== id) await load(id);
      setReady(true);
    })();
  }, [id, activeId, load]);

  const onLogSet = useCallback(
    async (weId: string, input: SetInput) => {
      await addSet(weId, input);
    },
    [addSet],
  );

  async function onFinish() {
    if (!workout) return;
    setFinishing(true);
    try {
      const serverId = await resolveId(workout.id);
      await finish();
      // A landing moment: what you just did, then Done. A session finished
      // offline has no server copy to show yet, so that one goes to History.
      if (isLocalSessionId(serverId)) router.replace('/(tabs)/history');
      else router.replace(`/session/${serverId}?finished=1`);
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
              <Ionicons name="timer-outline" size={21} color="#b6d69a" />
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
                <Ionicons name="sparkles" size={13} color="#b6d69a" />
                <Text variant="caption" className="ml-1 font-bold text-brand">
                  Coach on
                </Text>
              </View>
            ) : null}
          </View>
        </Card>

        {totalSets === 0 || readiness ? (
          <Card className="mb-3 p-4">
            <Text variant="subheading">How today feels</Text>
            <Text variant="caption" className="mt-0.5 text-iron-400">
              {readiness?.advice ?? 'Advice, never a gate — the app doesn’t get to tell you not to train.'}
            </Text>
            <View className="mt-3 flex-row gap-2">
              {([
                ['Slept well', { sleep_hours: 8, energy: 4 }],
                ['Rough night', { sleep_hours: 5, energy: 2 }],
                ['Still sore', { soreness: 4 }],
              ] as const).map(([label, patch]) => (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  disabled={readinessSaving}
                  onPress={() => {
                    setReadinessSaving(true);
                    void api
                      .recordReadiness(patch)
                      .then(setReadiness)
                      .catch(() => undefined)
                      .finally(() => setReadinessSaving(false));
                  }}
                  className="min-h-[44px] flex-1 items-center justify-center rounded-lg border border-iron-700 bg-iron-900 px-2 active:opacity-70">
                  <Text variant="caption">{label}</Text>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

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

        {/* exercises */}
        {workout.exercises.length === 0 ? (
          <Card className="mb-3">
            <Text variant="muted" className="mb-3">
              No exercises yet. Add one to start logging sets.
            </Text>
            <Button
              title="Add exercise"
              icon="add"
              onPress={() => router.push('/session/add-exercise')}
            />
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

        {/* Everything that isn't logging a set sits below the sets, as
          * secondary: adding a movement, or saying / typing one. */}
        <View className="mt-1 flex-row gap-2">
          {workout.exercises.length > 0 ? (
            <Button
              title="Add exercise"
              variant="secondary"
              icon="add"
              className="flex-1"
              onPress={() => router.push('/session/add-exercise')}
            />
          ) : null}
          {speechAvailable ? (
            <Button
              title={listening ? 'Listening…' : 'Say a set'}
              variant="secondary"
              icon={listening ? 'stop-circle-outline' : 'mic-outline'}
              className="flex-1"
              accessibilityLabel={listening ? 'Stop listening' : 'Say a set'}
              onPress={sayASet}
            />
          ) : (
            <Button
              title="Type a set"
              variant="secondary"
              icon="chatbubble-ellipses-outline"
              className="flex-1"
              onPress={() => router.push(`/log-chat?sessionId=${workout.id}`)}
            />
          )}
        </View>
        {speechAvailable ? (
          <Pressable
            onPress={() => router.push(`/log-chat?sessionId=${workout.id}`)}
            className="mt-2 self-center py-1 active:opacity-60">
            <Text variant="caption" className="text-iron-400">
              or type a set like “bench 3x8 @60”
            </Text>
          </Pressable>
        ) : null}
        {speechError ? <Text className="mt-2 text-sm text-red-400">{speechError}</Text> : null}
      </ScrollView>

      <BottomAction>
        <Button title="Finish session" size="lg" icon="checkmark" loading={finishing} onPress={onFinish} />
      </BottomAction>
    </SafeAreaView>
  );
}
