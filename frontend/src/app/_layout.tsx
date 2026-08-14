import '@/global.css';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/state/auth';
import { SettingsProvider, useSettings } from '@/state/settings';
import { ActiveWorkoutProvider } from '@/state/active-workout';
import { Logo } from '@/components/ui/Logo';
import { HeaderBack } from '@/components/ui/HeaderBack';
import { installGlobalErrorReporting } from '@/lib/report-error';

// Before anything renders: a crash during startup is still a crash worth
// knowing about, and this is the only place guaranteed to run first.
installGlobalErrorReporting();

function Splash() {
  return (
    <View className="flex-1 items-center justify-center bg-iron-950">
      <View className="mb-4">
        <Logo size="md" />
      </View>
      <ActivityIndicator color="#818cf8" />
    </View>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const { settings, loading: settingsLoading } = useSettings();
  const segments = useSegments();
  const router = useRouter();

  // Strictly `=== false`. Registration writes the flag as false; accounts that
  // predate onboarding have no flag at all, and an existing user must not be
  // shown a welcome tour for an app they already use.
  const needsOnboarding =
    !!user && !settingsLoading && settings.feature_flags.onboarded === false;

  const inAuthGroup = segments[0] === '(auth)';
  const onOnboarding = segments[0] === 'onboarding';
  // Where we are is not yet where we belong. `router.replace` only takes effect
  // after this render, so without holding the screen the tab screens mount for
  // a frame and every one of them fires its fetch — four guaranteed 401s in the
  // console on any signed-out load, from requests whose answers get thrown away.
  const redirecting =
    !loading &&
    ((!user && !inAuthGroup) ||
      (!!user && needsOnboarding && !onOnboarding) ||
      (!!user && inAuthGroup && !needsOnboarding));

  useEffect(() => {
    if (!redirecting) return;
    if (!user) {
      router.replace('/(auth)/login');
    } else if (needsOnboarding) {
      router.replace('/onboarding');
    } else {
      router.replace('/(tabs)');
    }
  }, [redirecting, user, needsOnboarding, router]);

  if (loading || redirecting) return <Splash />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: '#070b12' },
        headerTintColor: '#f8fafc',
        headerTitleStyle: { fontWeight: '900' },
        headerShadowVisible: false,
        // Consistent back control on every pushed screen (renders null at a
        // root, so tab screens stay clean). headerBackVisible:false stops the
        // native default from doubling up beside it.
        headerBackVisible: false,
        headerLeft: () => <HeaderBack />,
        contentStyle: { backgroundColor: '#070b12' },
      }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen name="exercise/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="session/[id]" />
      <Stack.Screen name="session/log" />
      <Stack.Screen name="session/active/[id]" />
      <Stack.Screen name="session/add-exercise" options={{ presentation: 'modal' }} />
      <Stack.Screen name="workout/[id]" />
      <Stack.Screen name="workout/new" />
      <Stack.Screen name="split/[id]" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="workout-import" />
      <Stack.Screen name="log-chat" />
      <Stack.Screen name="catch-up" />
      <Stack.Screen name="catch-up-paste" />
      <Stack.Screen name="nutrition" />
      <Stack.Screen name="progress" />
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
