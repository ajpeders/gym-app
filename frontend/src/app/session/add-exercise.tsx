import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import type { Exercise } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Text } from '@/components/ui/Text';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';

/**
 * Exercise picker for the live session.
 *
 * With a `swapId` param it repoints that logged row instead of appending a new
 * one — same picker, because "which exercise?" is the same question whether the
 * machine was free or taken.
 */
export default function AddExerciseScreen() {
  const router = useRouter();
  const { addExercise, swapExercise } = useActiveWorkout();
  const { swapId, swapName } = useLocalSearchParams<{ swapId?: string; swapName?: string }>();
  const [addingId, setAddingId] = useState<string | null>(null);

  const swapping = Boolean(swapId);

  async function onSelect(ex: Exercise) {
    if (addingId) return;
    setAddingId(ex.id);
    try {
      if (swapId) {
        await swapExercise(String(swapId), ex.id);
      } else {
        await addExercise(ex.id);
      }
      router.back();
    } finally {
      setAddingId(null);
    }
  }

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-iron-950">
      <Stack.Screen
        options={{ headerShown: true, title: swapping ? 'Swap exercise' : 'Add exercise' }}
      />
      <View className="px-4 pt-2 pb-1">
        <Text variant="muted">
          {swapping
            ? `Pick what you did instead${swapName ? ` of ${swapName}` : ''} — your logged sets stay.`
            : 'Tap an exercise to add it to your session.'}
        </Text>
      </View>
      <ExerciseBrowser
        onSelect={onSelect}
        renderTrailing={(ex) =>
          addingId === ex.id ? (
            <ActivityIndicator color="#b6d69a" />
          ) : (
            <View className="rounded-full bg-brand px-3 py-1">
              <Text variant="caption" className="font-black text-iron-950">
                {swapping ? 'Swap' : 'Add'}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}
