import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { cachePlans } from '@/lib/offline';
import type { Split, SplitEditProposal, SplitInput, TodayWorkout, Workout } from '@/api/types';
import { useStartSession } from '@/hooks/use-start-session';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { ActionRow } from '@/components/ui/ActionRow';
import { SplitEditor } from '@/components/SplitEditor';
import { SplitAiEdit, type SplitAiWorking } from '@/components/SplitAiEdit';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function SplitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { startSession } = useStartSession();
  const [split, setSplit] = useState<Split | null>(null);
  const [today, setToday] = useState<TodayWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { configured: aiConfigured } = useAiStatus();

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [s, t] = await Promise.all([
        api.split(id),
        api.splitToday().catch(() => [] as TodayWorkout[]),
      ]);
      setSplit(s);
      setToday(t);
      void cachePlans(s.workouts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load split');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  async function persist(input: SplitInput) {
    if (!id) return;
    setSaving(true);
    setActionError(null);
    try {
      setSplit(await api.updateSplit(id, input));
      setEditing(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save the split');
    } finally {
      setSaving(false);
    }
  }

  function aiWorking(current: Split): SplitAiWorking {
    return {
      name: current.name,
      notes: current.notes,
      rules: current.rules,
      days: [...current.workouts]
        .sort((a, b) => a.order - b.order)
        .map((w) => ({
          id: Number(w.id),
          name: w.name,
          weekdays: w.weekdays,
          floating: w.floating,
        })),
    };
  }

  /** Persist an AI proposal: split fields, then each day's name/schedule.
   * Days the proposal dropped are detached from the split rather than deleted,
   * so a bad suggestion can't destroy a workout's exercises. New days are
   * created empty for the user to fill in. */
  async function applyProposal(p: SplitEditProposal) {
    if (!id || !split) return;
    setSaving(true);
    setActionError(null);
    try {
      await api.updateSplit(id, { name: p.name, notes: p.notes, rules: p.rules });
      const keptIds = new Set(p.days.filter((d) => d.id != null).map((d) => d.id));

      // A rolling split schedules by rotation order alone, so a proposal's
      // weekdays are dropped rather than written back as dead data.
      const isRolling = split.mode === 'rolling';
      for (const [index, day] of p.days.entries()) {
        const shape = {
          name: day.name,
          weekdays: isRolling || day.floating ? [] : day.weekdays,
          floating: isRolling ? false : day.floating,
          order: index,
        };
        if (day.id == null) {
          await api.createWorkout({ ...shape, split_id: Number(id), exercises: [] });
        } else {
          await api.updateWorkout(String(day.id), shape);
        }
      }

      for (const existing of split.workouts) {
        if (!keptIds.has(Number(existing.id))) {
          await api.updateWorkout(String(existing.id), { split_id: null });
        }
      }

      setAiOpen(false);
      await fetch();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : 'Could not apply the changes — nothing may have saved',
      );
    } finally {
      setSaving(false);
    }
  }

  /** Move a day up or down the rotation. Order is what a rolling split
   * schedules by, so it has to be editable somewhere — and a day's own screen
   * can't do it, since reordering is a statement about its neighbours. Every
   * position is rewritten rather than the two swapped: existing splits often
   * have several days sharing order 0, where a swap is a no-op. */
  async function moveDay(days: Workout[], index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= days.length) return;
    const next = [...days];
    [next[index], next[target]] = [next[target], next[index]];
    setSaving(true);
    setActionError(null);
    try {
      await Promise.all(
        next.map((w, i) => (w.order === i ? null : api.updateWorkout(String(w.id), { order: i }))),
      );
      await fetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reorder the rotation');
    } finally {
      setSaving(false);
    }
  }

  function onDelete() {
    if (!id) return;
    const doDelete = async () => {
      setActionError(null);
      try {
        await api.deleteSplit(id);
        router.replace('/(tabs)/workouts');
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not delete the split');
      }
    };
    const message = 'Its workouts are kept as standalone days.';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete this split? ${message}`)) {
        void doDelete();
      }
      return;
    }
    Alert.alert('Delete split?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
    ]);
  }

  const todayDow = new Date().getDay();
  // Ids of today's workouts already logged this week (from GET /splits/today).
  const doneToday = new Set(today.filter((w) => w.done_this_week).map((w) => w.id));
  // Rolling splits get their position from the log instead of the calendar.
  const doneThisCycle = new Set(today.filter((w) => w.done_this_cycle).map((w) => String(w.id)));
  const upNextId = today.find((w) => w.up_next)?.id;

  if (loading || error || !split) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Split' }} />
        {loading ? <Loading /> : <ErrorState message={error ?? 'Not found'} onRetry={fetch} />}
      </Screen>
    );
  }

  const ordered = [...split.workouts].sort((a, b) => a.order - b.order);
  const rolling = split.mode === 'rolling';
  // `floating` is a rigid-mode escape hatch ("do this one whenever"). In a
  // rolling split every day is already unpinned, so the distinction is noise.
  const floating = rolling ? [] : ordered.filter((w) => w.floating);
  // Workouts scheduled on a given weekday (0=Sun..6=Sat).
  const workoutsForDay = (day: number): Workout[] =>
    ordered.filter((w) => !w.floating && w.weekdays.includes(day));
  // What today is for: the rotation's next day, or the first of today's
  // scheduled days that isn't done yet. Nothing on a rest day.
  const due: Workout | undefined = rolling
    ? ordered.find((w) => String(w.id) === String(upNextId))
    : workoutsForDay(todayDow).find((w) => !doneToday.has(w.id));

  return (
    <Screen scroll={false} padded={false} edges={['left', 'right']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Split',
          headerRight: () => (
            <Pressable onPress={() => setEditing(true)} hitSlop={8} className="active:opacity-70">
              <Text className="font-bold text-brand">Edit</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        <View className="flex-row items-center">
          <Text variant="title" className="flex-1">
            {split.name}
          </Text>
          {split.is_active ? (
            <View className="ml-2 rounded-full bg-brand/15 px-2.5 py-1">
              <Text variant="caption" className="font-bold text-brand">
                Active
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="muted" className="mt-0.5">
          {ordered.length} {ordered.length === 1 ? 'workout' : 'workouts'} ·{' '}
          {rolling ? 'rotation' : 'weekly split'}
        </Text>

        {actionError ? (
          <Text className="mt-2 text-sm text-red-400">{actionError}</Text>
        ) : null}

        {/* A rolling split has no weekdays to lay out, so the week grid is
          * replaced by the rotation itself, in order, with the cycle's current
          * position marked. */}
        {rolling ? (
          <>
            <Text variant="heading" className="mb-2 mt-5">
              Rotation
            </Text>
            <Card className="mb-1 rounded-lg p-2">
              {ordered.map((w, index) => {
                const isNext = String(w.id) === String(upNextId);
                const isDone = doneThisCycle.has(String(w.id));
                return (
                  <ActionRow
                    key={w.id}
                    onPress={() => router.push(`/workout/${w.id}`)}
                    selected={isNext}
                    title={`${index + 1}. ${w.name}`}
                    subtitle={isNext ? 'Up next' : undefined}
                    meta={`${w.exercises.length} exercises`}
                    trailing={
                      <View className="ml-1 flex-row items-center">
                        {isDone ? (
                          <View className="mr-1 flex-row items-center rounded-full bg-brand/15 px-2 py-1">
                            <Ionicons name="checkmark-circle" size={13} color="#5eead4" />
                            <Text variant="caption" className="ml-1 font-bold text-brand">
                              Done
                            </Text>
                          </View>
                        ) : null}
                        <Pressable
                          onPress={() => void moveDay(ordered, index, -1)}
                          disabled={index === 0 || saving}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${w.name} earlier in the rotation`}
                          className="h-8 w-7 items-center justify-center rounded-md active:bg-iron-800">
                          <Ionicons
                            name="chevron-up"
                            size={16}
                            color={index === 0 ? '#334155' : '#94a3b8'}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => void moveDay(ordered, index, 1)}
                          disabled={index === ordered.length - 1 || saving}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${w.name} later in the rotation`}
                          className="h-8 w-7 items-center justify-center rounded-md active:bg-iron-800">
                          <Ionicons
                            name="chevron-down"
                            size={16}
                            color={index === ordered.length - 1 ? '#334155' : '#94a3b8'}
                          />
                        </Pressable>
                      </View>
                    }
                  />
                );
              })}
            </Card>
            <Text variant="muted" className="mt-1">
              Train them in order and rest whenever you need to — nothing here can be missed.
            </Text>
          </>
        ) : (
          <>
            {/* Weekly schedule */}
            <Text variant="heading" className="mb-2 mt-5">
              Weekly schedule
            </Text>
            <Card className="mb-1 rounded-lg p-2">
              {DOW.map((dayName, day) => {
                const dayWorkouts = workoutsForDay(day);
                const isToday = day === todayDow;
                const isRest = dayWorkouts.length === 0;
                const primary = dayWorkouts[0];
                const isDone = isToday && dayWorkouts.some((w) => doneToday.has(w.id));
                return (
                  <ActionRow
                    key={dayName}
                    disabled={!primary}
                    onPress={() => primary && router.push(`/workout/${primary.id}`)}
                    selected={isToday}
                    title={dayName}
                    subtitle={isToday ? 'Today' : undefined}
                    meta={isRest ? 'Rest' : dayWorkouts.map((w) => w.name).join(', ')}
                    trailing={
                      isDone ? (
                        <View className="ml-2 flex-row items-center rounded-full bg-brand/15 px-2 py-1">
                          <Ionicons name="checkmark-circle" size={13} color="#5eead4" />
                          <Text variant="caption" className="ml-1 font-bold text-brand">
                            Done
                          </Text>
                        </View>
                      ) : primary ? (
                        <Ionicons name="chevron-forward" size={16} color="#475569" />
                      ) : (
                        <Ionicons name="bed-outline" size={15} color="#475569" />
                      )
                    }
                  />
                );
              })}
            </Card>

            {/* Floating workouts (not pinned to a weekday) */}
            {floating.length > 0 ? (
              <>
                <Text variant="heading" className="mb-2 mt-6">
                  Anytime
                </Text>
                <Card className="mb-1 rounded-lg p-2">
                  {floating.map((w) => (
                    <ActionRow
                      key={w.id}
                      onPress={() => router.push(`/workout/${w.id}`)}
                      title={w.name}
                      subtitle={`${w.exercises.length} exercises`}
                      meta="Anytime"
                    />
                  ))}
                </Card>
              </>
            ) : null}
          </>
        )}

        {/* Progression rules */}
        {split.rules.length > 0 ? (
          <>
            <Text variant="heading" className="mb-2 mt-6">
              Progression rules
            </Text>
            <Card className="mb-1 rounded-lg p-4">
              {split.rules.map((rule, i) => (
                <View key={i} className="mb-2.5 flex-row last:mb-0">
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color="#5eead4"
                    style={{ marginTop: 2 }}
                  />
                  <Text variant="body" className="ml-2 flex-1 text-iron-200">
                    {rule}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {/* One Start, for the day that is due. A Start on every row sat where
          * a thumb lands when opening a workout, and started one instead. */}
        {due ? (
          <Button
            title={`Start ${due.name}`}
            icon="play"
            className="mt-6"
            onPress={() => void startSession({ workout_id: due.id, name: due.name })}
          />
        ) : null}

        {/* Workout cards: tap to open. Starting any other day lives on its page. */}
        <Text variant="heading" className="mb-2 mt-6">
          Workouts
        </Text>
        {ordered.map((w) => (
          <Card key={w.id} className="mb-3 rounded-lg p-4" onPress={() => router.push(`/workout/${w.id}`)}>
            <View className="flex-row items-center">
              <View className="flex-1">
                <Text variant="subheading" numberOfLines={1}>
                  {w.name}
                </Text>
                <Text variant="caption" className="mt-0.5 text-iron-400">
                  {w.exercises.length} exercises
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#475569" />
            </View>
          </Card>
        ))}

        {/* Split-level management */}
        <Text variant="heading" className="mb-2 mt-6">
          Manage
        </Text>
        {!split.is_active ? (
          <Button
            title="Make this my active split"
            variant="secondary"
            icon="checkmark-circle-outline"
            loading={saving}
            onPress={() => void persist({ is_active: true })}
            className="mb-3"
          />
        ) : null}
        {aiConfigured ? (
          <Button
            title="Edit with AI"
            variant="secondary"
            icon="sparkles"
            onPress={() => setAiOpen(true)}
            className="mb-3"
          />
        ) : null}
        <Button title="Delete split" variant="danger" icon="trash-outline" onPress={onDelete} />
      </ScrollView>

      <SplitEditor
        visible={editing}
        split={split}
        saving={saving}
        onSave={persist}
        onClose={() => setEditing(false)}
      />

      <SplitAiEdit
        visible={aiOpen}
        initialWorking={aiWorking(split)}
        onApply={applyProposal}
        onClose={() => setAiOpen(false)}
      />
    </Screen>
  );
}
