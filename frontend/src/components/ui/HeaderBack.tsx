import { Pressable } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Shared header back control. Wired as the stack's default `headerLeft` so every
 * pushed screen gets a consistent back chevron; renders nothing on a root screen
 * (nothing to go back to), so tab roots stay clean.
 */
export function HeaderBack() {
  const router = useRouter();
  const segments = useSegments();
  // Tab roots have nowhere to go. Every other screen does, even when the
  // browser landed on it directly and there is no history to pop — a URL
  // opened from a link or a reload had no arrow at all on web.
  const first: string | undefined = segments[0];
  const atRoot = first === undefined || first === '(tabs)' || first === '(auth)';
  if (atRoot && !router.canGoBack()) return null;
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="flex-row items-center pr-3 active:opacity-60">
      <Ionicons name="chevron-back" size={26} color="#5eead4" />
    </Pressable>
  );
}
