import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Exercise, Session } from '@/api/types';
import { useSettings } from '@/state/settings';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';
import { ProgressionNudge } from '@/components/workout/ProgressionNudge';
import { formatDateTime, formatDuration, formatLoad, titleCase, muscleLabel } from '@/lib/format';
import { promptExport, sessionToJson, sessionToText } from '@/lib/export';
import { confirm } from '@/lib/confirm';

/** What the exercise picker is being opened for. */
type Picking = { mode: 'add' } | { mode: 'swap'; weId: string; name: string } | null;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text variant="subheading">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

export default function SessionDetailScreen() {
  // `finished=1` is how the active screen lands here: a summary of what was
  // just done, with a Done button, rather than dropping straight onto History.
  const { id, finished } = useLocalSearchParams<{ id: string; finished?: string }>();
  const router = useRouter();
  const { settings } = useSettings();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const justFinished = finished === '1';

  /** Edit mode doubles as rename: the title becomes a field, Done saves it. */
  async function toggleEditing() {
    if (!session) return;
    if (!editing) {
      setDraftName(session.name ?? '');
      setEditing(true);
      return;
    }
    const name = draftName.trim();
    if (name && name !== (session.name ?? '')) {
      try {
        setSession(await api.updateSession(session.id, { name }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That rename did not save');
      }
    }
    setEditing(false);
  }
  const [picking, setPicking] = useState<Picking>(null);
  const [busy, setBusy] = useState(false);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setSession(await api.session(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [id]);

  /** Apply a picked exercise as either a swap or an append, then re-read. */
  async function onPick(ex: Exercise) {
    if (!id || !picking || busy) return;
    setBusy(true);
    try {
      if (picking.mode === 'swap') {
        // The sets stay attached — only the movement they were for changes.
        await api.swapSessionExercise(id, picking.weId, ex.id);
      } else {
        await api.addSessionExercise(id, { exercise_id: ex.id });
      }
      setPicking(null);
      await fetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change did not save');
      setPicking(null);
    } finally {
      setBusy(false);
    }
  }

  async function removeExercise(weId: string) {
    if (!id) return;
    setBusy(true);
    try {
      await api.deleteSessionExercise(id, weId);
      await fetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change did not save');
    } finally {
      setBusy(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  const totalSets = session?.exercises.reduce((acc, e) => acc + e.sets.length, 0) ?? 0;
  const totalVolume =
    session?.exercises.reduce(
      (acc, e) => acc + e.sets.reduce((a, s) => a + (s.reps ?? 0) * (s.weight ?? 0), 0),
      0,
    ) ?? 0;

  return (
    <Screen scroll={false} padded={false} edges={['left', 'right']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Session',
          headerRight: () =>
            session ? (
              <View className="flex-row items-center">
                <Pressable
                  onPress={() => void toggleEditing()}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={editing ? 'Done editing' : 'Edit session'}
                  className="h-10 w-10 items-center justify-center active:opacity-60">
                  <Ionicons
                    name={editing ? 'checkmark' : 'create-outline'}
                    size={22}
                    color="#b6d69a"
                  />
                </Pressable>
                <Pressable
                  onPress={() =>
                    promptExport(
                      session.name || 'Session',
                      sessionToText(session, settings.units),
                      sessionToJson(session, settings.units),
                    )
                  }
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Export session"
                  className="h-10 w-10 items-center justify-center active:opacity-60">
                  <Ionicons name="share-outline" size={22} color="#b6d69a" />
                </Pressable>
              </View>
            ) : null,
        }}
      />
      {loading ? (
        <Loading />
      ) : error || !session ? (
        <ErrorState message={error ?? 'Not found'} onRetry={fetch} />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
          {justFinished ? (
            <Card elevated className="mb-4 border-brand/30 bg-brand/10 p-4">
              <View className="flex-row items-center">
                <View className="mr-3 h-11 w-11 items-center justify-center rounded-xl bg-brand">
                  <Ionicons name="checkmark" size={22} color="#121510" />
                </View>
                <View className="flex-1">
                  <Text variant="subheading">Nice work</Text>
                  <Text variant="caption" className="mt-0.5 text-iron-300">
                    {`${totalSets} ${totalSets === 1 ? 'set' : 'sets'} in ${formatDuration(
                      session.started_at,
                      session.finished_at,
                    )}. It's in your log.`}
                  </Text>
                </View>
              </View>
              <Button
                title="Done"
                icon="checkmark"
                className="mt-3"
                onPress={() => router.replace('/(tabs)/history')}
              />
            </Card>
          ) : null}
          {editing ? (
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Session name"
              placeholderTextColor="#929b89"
              selectionColor="#b6d69a"
              accessibilityLabel="Session name"
              className="rounded-lg border border-iron-700 bg-iron-900 px-3 py-2 text-2xl font-black text-iron-50"
            />
          ) : (
            <Text variant="title">{session.name ?? 'Session'}</Text>
          )}
          <Text variant="muted" className="mt-0.5">
            {formatDateTime(session.started_at)}
          </Text>

          <View className="flex-row justify-between my-4">
            <Stat label="Duration" value={formatDuration(session.started_at, session.finished_at)} />
            <Stat label="Exercises" value={String(session.exercises.length)} />
            <Stat label="Sets" value={String(totalSets)} />
            <Stat label="Volume" value={`${Math.round(totalVolume)} ${settings.units}`} />
          </View>

          {editing ? (
            <View className="mb-3 flex-row items-center rounded-lg border border-brand/40 bg-brand/10 px-3.5 py-2.5">
              <Ionicons name="information-circle-outline" size={16} color="#b6d69a" />
              <Text variant="caption" className="ml-2 flex-1 text-brand">
                Swapping keeps the sets — use it when you trained a different movement than
                you logged.
              </Text>
            </View>
          ) : null}

          {session.notes ? (
            <Card className="mb-3">
              <Text variant="label" className="mb-1">
                Notes
              </Text>
              <Text variant="body">{session.notes}</Text>
            </Card>
          ) : null}

          {session.exercises
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((we) => (
              <Card key={we.id} className="mb-3">
                <View className="flex-row items-start">
                  <View className="flex-1">
                    <Text variant="subheading">{we.exercise?.name ?? 'Exercise'}</Text>
                    {we.exercise?.primary_muscles?.length ? (
                      <Text variant="muted" numberOfLines={1}>
                        {we.exercise.primary_muscles.map(muscleLabel).join(', ')}
                      </Text>
                    ) : null}
                  </View>
                  {editing ? (
                    <View className="flex-row">
                      <Pressable
                        onPress={() =>
                          setPicking({
                            mode: 'swap',
                            weId: we.id,
                            name: we.exercise?.name ?? 'this exercise',
                          })
                        }
                        disabled={busy}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Swap exercise"
                        className="ml-2 h-9 w-9 items-center justify-center rounded-lg bg-brand/10 active:opacity-60">
                        <Ionicons name="swap-horizontal" size={17} color="#b6d69a" />
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          confirm(
                            'Remove exercise?',
                            'This removes the exercise and its sets from this session.',
                            () => void removeExercise(we.id),
                            true,
                          )
                        }
                        disabled={busy}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Remove exercise"
                        className="ml-2 h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 active:opacity-60">
                        <Ionicons name="trash-outline" size={17} color="#ef4444" />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
                <View className="mt-2 gap-1">
                  {we.sets.length === 0 ? (
                    <Text variant="muted">No sets logged.</Text>
                  ) : (
                    we.sets.map((s, i) => (
                      <View
                        key={s.id}
                        className="flex-row items-center rounded-md bg-iron-800 px-3 py-2">
                        <Text variant="label" className="w-10">
                          {i + 1}
                        </Text>
                        <Text variant="body" className="flex-1">
                          {formatLoad(s.weight, settings.units)} × {s.reps}
                        </Text>
                        {s.rpe ? <Text variant="muted">RPE {s.rpe}</Text> : null}
                      </View>
                    ))
                  )}
                </View>
                <ProgressionNudge show={we.cleared_rep_range} />
              </Card>
            ))}

          {editing ? (
            <Button
              title="Add exercise"
              variant="secondary"
              icon="add"
              disabled={busy}
              onPress={() => setPicking({ mode: 'add' })}
            />
          ) : null}
        </ScrollView>
      )}

      <Modal
        visible={picking !== null}
        animationType="slide"
        onRequestClose={() => setPicking(null)}>
        <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text variant="heading">
              {picking?.mode === 'swap' ? 'Swap exercise' : 'Add exercise'}
            </Text>
            <Pressable onPress={() => setPicking(null)} hitSlop={8}>
              <Text className="font-bold text-brand">Close</Text>
            </Pressable>
          </View>
          {picking?.mode === 'swap' ? (
            <Text variant="muted" className="px-4 pb-2">
              Pick what you did instead of {picking.name} — the logged sets stay.
            </Text>
          ) : null}
          <ExerciseBrowser
            onSelect={onPick}
            renderTrailing={() => (
              <Text className="text-xl font-black text-brand">
                {picking?.mode === 'swap' ? 'SWAP' : 'ADD'}
              </Text>
            )}
          />
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}
