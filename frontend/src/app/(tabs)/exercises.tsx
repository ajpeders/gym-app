import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';

export default function ExercisesScreen() {
  const router = useRouter();

  return (
    <Screen scroll={false} padded={false}>
      <View className="px-4 pt-4 pb-3">
        <ScreenHeader
          eyebrow="Library"
          title="Exercises"
          subtitle="Search movements, filter by equipment, and inspect details before adding them."
          className="mb-0"
        />
      </View>
      <ExerciseBrowser onSelect={(ex) => router.push(`/exercise/${ex.id}`)} />
    </Screen>
  );
}
