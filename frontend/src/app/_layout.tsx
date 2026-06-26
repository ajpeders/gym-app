import '@/global.css';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/state/auth';
import { SettingsProvider } from '@/state/settings';
import { ActiveWorkoutProvider } from '@/state/active-workout';
import { Text } from '@/components/ui/Text';

function Splash() {
  return (
    <View className="flex-1 items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <Text className="text-5xl mb-4">🏋️</Text>
      <ActivityIndicator color="#3c87f7" />
    </View>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments, router]);

  if (loading) return <Splash />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="exercise/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="workout/[id]" />
      <Stack.Screen name="workout/active/[id]" />
      <Stack.Screen name="workout/add-exercise" options={{ presentation: 'modal' }} />
      <Stack.Screen name="routine/[id]" />
      <Stack.Screen name="routine/new" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SettingsProvider>
            <ActiveWorkoutProvider>
              <StatusBar style="auto" />
              <RootNavigator />
            </ActiveWorkoutProvider>
          </SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
