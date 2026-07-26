import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Exercise, SessionLogInput } from '@/api/types';
import { useSettings } from '@/state/settings';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { titleCase } from '@/lib/format';

interface DraftSet {
  reps: string;
  weight: string;
}

interface DraftLoggedExercise {
  exercise_id: string;
  name: string;
  image?: string | null;
  sets: DraftSet[];
}

const DATE_PRESETS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: 1 },
  { label: '2 days ago', days: 2 },
  { label: '3 days ago', days: 3 },
  { label: 'A week ago', days: 7 },
];

function isoForDaysBack(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

const smallInput =
  'rounded-md border border-iron-700 bg-iron-950 px-2 py-2 text-center text-base text-iron-50';

export default function LogSessionScreen() {
  const router = useRouter();
  const { settings } = useSettings();
  const [name, setName] = useState('');
  const [daysBack, setDaysBack] = useState(0);
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<DraftLoggedExercise[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addExercise(ex: Exercise) {
    setExercises((prev) => [
      ...prev,
      {
        exercise_id: ex.id,
        name: ex.name,
        image: ex.images?.[0] ?? null,
        sets: [{ reps: '', weight: '' }],
      },
    ]);
    setPicking(false);
  }

  function updateSet(exIdx: number, setIdx: number, patch: Partial<DraftSet>) {
    setExercises((prev) =>
      prev.map((e, i) =>
        i === exIdx
          ? { ...e, sets: e.sets.map((s, j) => (j === setIdx ? { ...s, ...patch } : s)) }
          : e,
      ),
    );
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((e, i) => {
        if (i !== exIdx) return e;
        // Pre-fill from the last set so repeated sets are one tap.
        const last = e.sets[e.sets.length - 1] ?? { reps: '', weight: '' };
        return { ...e, sets: [...e.sets, { ...last }] };
      }),
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((e, i) => (i === exIdx ? { ...e, sets: e.sets.filter((_, j) => j !== setIdx) } : e)),
    );
  }

  function removeExercise(exIdx: number) {
    setExercises((prev) => prev.filter((_, i) => i !== exIdx));
  }

  async function save() {
    setError(null);
    if (exercises.length === 0) {
      setError('Add at least one exercise.');
      return;
    }
    const payload: SessionLogInput = {
      name: name.trim() || null,
      started_at: isoForDaysBack(daysBack),
      notes: notes.trim() || null,
      exercises: exercises.map((e) => ({
        exercise_id: e.exercise_id,
        // Keep only sets with at least reps entered; drop blank trailing rows.
        sets: e.sets
          .filter((s) => s.reps.trim() !== '')
          .map((s) => ({
            reps: s.reps ? parseInt(s.reps, 10) : null,
            weight: s.weight ? parseFloat(s.weight) : null,
            set_type: 'working',
          })),
      })),
    };
    if (payload.exercises.every((e) => e.sets.length === 0)) {
      setError('Log at least one set (reps) for an exercise.');
      return;
    }
    setSaving(true);
    try {
      const w = await api.logSession(payload);
      router.replace(`/session/${w.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save session');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-iron-950">
      <Stack.Screen options={{ headerShown: true, title: 'Log a session' }} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-3 pb-28"
        keyboardShouldPersistTaps="handled">
        <Text variant="muted" className="mb-3">
          Record a session you already did — enter the sets, no live timer.
        </Text>

        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Leg day" />

        <Text variant="label" className="mb-1.5 mt-4 text-iron-300">
          When
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {DATE_PRESETS.map((p) => {
              const active = p.days === daysBack;
              return (
                <Pressable
                  key={p.days}
                  onPress={() => setDaysBack(p.days)}
                  className={`rounded-full border px-3.5 py-2 ${
                    active ? 'border-brand bg-brand/20' : 'border-iron-700 bg-iron-900'
                  }`}>
                  <Text variant="caption" className={active ? 'font-bold text-brand' : 'text-iron-200'}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <Text variant="heading" className="mb-2 mt-5">
          Exercises
        </Text>

        {exercises.length === 0 ? (
          <Card className="mb-3">
            <Text variant="muted">No exercises yet. Add some below.</Text>
          </Card>
        ) : (
          exercises.map((e, exIdx) => (
            <Card key={`${e.exercise_id}-${exIdx}`} className="mb-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 flex-row items-center">
                  <ExerciseThumb images={e.image ? [e.image] : null} size={32} radius={6} />
                  <Text variant="subheading" numberOfLines={1} className="ml-2 flex-1">
                    {titleCase(e.name)}
                  </Text>
                </View>
                <Pressable onPress={() => removeExercise(exIdx)} hitSlop={6}>
                  <Text className="text-sm font-bold text-red-500">Remove</Text>
                </Pressable>
              </View>

              <View className="mt-3 flex-row px-1">
                <Text variant="caption" className="w-8">
                  Set
                </Text>
                <Text variant="caption" className="flex-1 text-center">
                  Reps
                </Text>
                <Text variant="caption" className="flex-1 text-center">
                  Wt ({settings.units})
                </Text>
                <View className="w-8" />
              </View>

              {e.sets.map((s, setIdx) => (
                <View key={setIdx} className="mt-2 flex-row items-center">
                  <Text variant="body" className="w-8 text-iron-400">
                    {setIdx + 1}
                  </Text>
                  <View className="flex-1 px-1">
                    <TextInput
                      value={s.reps}
                      onChangeText={(v) => updateSet(exIdx, setIdx, { reps: v })}
                      keyboardType="number-pad"
                      placeholder="-"
                      placeholderTextColor="#64748b"
                      className={smallInput}
                    />
                  </View>
                  <View className="flex-1 px-1">
                    <TextInput
                      value={s.weight}
                      onChangeText={(v) => updateSet(exIdx, setIdx, { weight: v })}
                      keyboardType="decimal-pad"
                      placeholder="-"
                      placeholderTextColor="#64748b"
                      className={smallInput}
                    />
                  </View>
                  <Pressable onPress={() => removeSet(exIdx, setIdx)} hitSlop={6} className="w-8 items-center">
                    <Ionicons name="close-circle" size={20} color="#64748b" />
                  </Pressable>
                </View>
              ))}

              <Pressable
                onPress={() => addSet(exIdx)}
                className="mt-3 flex-row items-center justify-center rounded-md border border-iron-700 py-2 active:opacity-70">
                <Ionicons name="add" size={16} color="#818cf8" />
                <Text className="ml-1 font-semibold text-brand">Add set</Text>
              </Pressable>
            </Card>
          ))
        )}

        <Button
          title="Add exercise"
          variant="secondary"
          onPress={() => setPicking(true)}
          className="mt-1"
        />

        {error ? <Text className="mt-3 text-sm text-red-500">{error}</Text> : null}

        <Button title="Save session" size="lg" className="mt-4" loading={saving} onPress={save} />
      </ScrollView>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text variant="heading">Add exercise</Text>
            <Pressable onPress={() => setPicking(false)} hitSlop={8}>
              <Text className="font-bold text-brand">Close</Text>
            </Pressable>
          </View>
          <ExerciseBrowser
            onSelect={addExercise}
            renderTrailing={() => <Text className="text-xl font-black text-brand">ADD</Text>}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
