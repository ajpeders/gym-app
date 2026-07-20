import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Shared header back control. Wired as the stack's default `headerLeft` so every
 * pushed screen gets a consistent back chevron; renders nothing on a root screen
 * (nothing to go back to), so tab roots stay clean.
 */
export function HeaderBack() {
  const router = useRouter();
  if (!router.canGoBack()) return null;
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="flex-row items-center pr-3 active:opacity-60">
      <Ionicons name="chevron-back" size={26} color="#f97316" />
    </Pressable>
  );
}
