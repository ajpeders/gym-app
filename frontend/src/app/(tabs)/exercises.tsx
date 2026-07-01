import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { Screen } from '@/components/ui/Screen';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';

export default function ExercisesScreen() {
  const router = useRouter();

  return (
    <Screen scroll={false} padded={false}>
      <View className="px-4 pt-2 pb-3">
        <Text variant="eyebrow">Library</Text>
        <Text variant="title" className="mt-1">
          Exercises
        </Text>
      </View>
      <ExerciseBrowser onSelect={(ex) => router.push(`/exercise/${ex.id}`)} />
    </Screen>
  );
}
