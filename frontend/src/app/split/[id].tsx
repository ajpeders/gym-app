import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Split, SplitEditProposal, SplitInput, TodayWorkout, Workout } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { SplitEditor } from '@/components/SplitEditor';
import { SplitAiEdit, type SplitAiWorking } from '@/components/SplitAiEdit';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function SplitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { start } = useActiveWorkout();
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

      for (const [index, day] of p.days.entries()) {
        const shape = {
          name: day.name,
          weekdays: day.floating ? [] : day.weekdays,
          floating: day.floating,
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

  if (loading || error || !split) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Split' }} />
        {loading ? <Loading /> : <ErrorState message={error ?? 'Not found'} onRetry={fetch} />}
      </Screen>
    );
  }

  const ordered = [...split.workouts].sort((a, b) => a.order - b.order);
  const floating = ordered.filter((w) => w.floating);
  // Workouts scheduled on a given weekday (0=Sun..6=Sat).
  const workoutsForDay = (day: number): Workout[] =>
    ordered.filter((w) => !w.floating && w.weekdays.includes(day));

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: split.name,
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
          {ordered.length} {ordered.length === 1 ? 'workout' : 'workouts'} · weekly split
        </Text>

        {actionError ? (
          <Text className="mt-2 text-sm text-red-400">{actionError}</Text>
        ) : null}

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
              <Pressable
                key={dayName}
                disabled={!primary}
                onPress={() => primary && router.push(`/workout/${primary.id}`)}
                className={`flex-row items-center rounded-2xl px-3 py-3 ${
                  isToday ? 'bg-brand/10' : ''
                } ${primary ? 'active:opacity-70' : ''}`}>
                <View className="w-32">
                  <Text
                    variant="subheading"
                    numberOfLines={1}
                    className={isToday ? 'text-brand' : undefined}>
                    {dayName}
                  </Text>
                  {isToday ? (
                    <Text variant="caption" className="text-brand">
                      Today
                    </Text>
                  ) : null}
                </View>
                <Text
                  variant="body"
                  numberOfLines={1}
                  className={`flex-1 ${isRest ? 'text-iron-500' : 'text-iron-100'}`}>
                  {isRest
                    ? 'Rest'
                    : dayWorkouts.map((w) => w.name).join(', ')}
                </Text>
                {isDone ? (
                  <View className="mr-2 flex-row items-center rounded-full bg-brand/15 px-2 py-1">
                    <Ionicons name="checkmark-circle" size={13} color="#5eead4" />
                    <Text variant="caption" className="ml-1 font-bold text-brand">
                      Done
                    </Text>
                  </View>
                ) : null}
                {primary ? (
                  <Ionicons name="chevron-forward" size={16} color="#475569" />
                ) : (
                  <Ionicons name="bed-outline" size={15} color="#475569" />
                )}
              </Pressable>
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
                <Pressable
                  key={w.id}
                  onPress={() => router.push(`/workout/${w.id}`)}
                  className="flex-row items-center rounded-2xl px-3 py-3 active:opacity-70">
                  <Text variant="body" numberOfLines={1} className="flex-1 text-iron-100">
                    {w.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#475569" />
                </Pressable>
              ))}
            </Card>
          </>
        ) : null}

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

        {/* Workout cards */}
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
              <Pressable
                onPress={async () => {
                  const s = await start({ workout_id: w.id, name: w.name });
                  router.push(`/session/active/${s.id}`);
                }}
                className="mr-2 flex-row items-center rounded-lg bg-brand px-3 py-2 active:bg-brand-600">
                <Ionicons name="play" size={13} color="#05070a" />
                <Text variant="caption" className="ml-1 font-bold text-iron-950">
                  Start
                </Text>
              </Pressable>
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
