import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';

export default function ExercisesScreen() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
      <View className="px-4 pt-2 pb-1">
        <Text variant="title">Exercises</Text>
      </View>
      <ExerciseBrowser onSelect={(ex) => router.push(`/exercise/${ex.id}`)} />
    </SafeAreaView>
  );
}
