import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';

/**
 * The first screen a signed-out visitor sees. Two doors, equal weight: a new
 * user needs Register and used to be handed a login form with a small link
 * under it.
 */
export default function LandingScreen() {
  const router = useRouter();
  return (
    <Screen scroll={false} padded={false} edges={['top', 'bottom', 'left', 'right']}>
      <View className="w-full max-w-[440px] flex-1 justify-center self-center px-6 py-8">
        <View className="mb-12 items-start">
          <Logo size="lg" />
          <Text variant="title" className="mt-6">
            Log the set you just did.
          </Text>
          <Text variant="muted" className="mt-2">
            A training log that knows your plan. Works offline, no AI required.
          </Text>
        </View>
        <View className="gap-3">
          <Button title="Register" size="lg" onPress={() => router.push('/(auth)/register')} />
          <Button
            title="Log in"
            size="lg"
            variant="secondary"
            onPress={() => router.push('/(auth)/login')}
          />
        </View>
      </View>
    </Screen>
  );
}
