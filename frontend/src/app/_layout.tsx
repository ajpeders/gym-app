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
import { Logo } from '@/components/ui/Logo';

function Splash() {
  return (
    <View className="flex-1 items-center justify-center bg-iron-950">
      <View className="mb-4">
        <Logo size="md" />
      </View>
      <ActivityIndicator color="#f97316" />
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
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: '#080706' },
        headerTintColor: '#f5f5f4',
        headerTitleStyle: { fontWeight: '900' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#080706' },
      }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="exercise/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="workout/[id]" />
      <Stack.Screen name="workout/active/[id]" />
      <Stack.Screen name="workout/add-exercise" options={{ presentation: 'modal' }} />
      <Stack.Screen name="routine/[id]" />
      <Stack.Screen name="routine/new" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="coach" />
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
              <StatusBar style="light" />
              <RootNavigator />
            </ActiveWorkoutProvider>
          </SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
