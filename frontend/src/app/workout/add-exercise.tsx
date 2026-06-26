import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

import type { Exercise } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { Text } from '@/components/ui/Text';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';

export default function AddExerciseScreen() {
  const router = useRouter();
  const { addExercise } = useActiveWorkout();
  const [addingId, setAddingId] = useState<string | null>(null);

  async function onSelect(ex: Exercise) {
    if (addingId) return;
    setAddingId(ex.id);
    try {
      await addExercise(ex.id);
      router.back();
    } finally {
      setAddingId(null);
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
      <Stack.Screen options={{ headerShown: true, title: 'Add exercise' }} />
      <View className="px-4 pt-2 pb-1">
        <Text variant="muted">Tap an exercise to add it to your workout</Text>
      </View>
      <ExerciseBrowser
        onSelect={onSelect}
        renderTrailing={(ex) =>
          addingId === ex.id ? (
            <ActivityIndicator color="#f97316" />
          ) : (
            <Text className="text-xl font-black text-brand">ADD</Text>
          )
        }
      />
    </SafeAreaView>
  );
}
