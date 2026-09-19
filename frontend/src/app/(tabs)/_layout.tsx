import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { usePendingCount } from '@/lib/use-offline-banner';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// [filled (active), outline (inactive)]
const ICONS: Record<string, [IoniconName, IoniconName]> = {
  index: ['home', 'home-outline'],
  workouts: ['calendar', 'calendar-outline'],
  exercises: ['search', 'search-outline'],
  history: ['time', 'time-outline'],
  more: ['grid', 'grid-outline'],
};

function tabIcon(name: keyof typeof ICONS) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => {
    const [active, inactive] = ICONS[name];
    return (
      <View className="h-8 w-10 items-center justify-center">
        <Ionicons name={focused ? active : inactive} size={size ?? 22} color={color} />
      </View>
    );
  };
}

export default function TabsLayout() {
  const pending = usePendingCount();

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: '#121510' },
          headerTintColor: '#f2f3ed',
          headerTitleStyle: { fontWeight: '900' },
          headerShadowVisible: false,
          tabBarActiveTintColor: '#b6d69a',
          tabBarInactiveTintColor: '#b0b6a8',
          tabBarActiveBackgroundColor: 'transparent',
          tabBarShowLabel: true,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            alignSelf: 'center',
            width: '100%',
            maxWidth: 760,
            height: 70,
            backgroundColor: '#181c15',
            borderColor: 'transparent',
            borderTopColor: '#343c2e',
            borderWidth: 0,
            borderTopWidth: 1,
            paddingTop: 6,
            paddingBottom: 6,
          },
          tabBarItemStyle: {
            marginHorizontal: 2,
            borderRadius: 12,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 0 },
        }}>
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('index') }} />
        <Tabs.Screen
          name="workouts"
          options={{ title: 'Splits', tabBarIcon: tabIcon('workouts') }}
        />
        <Tabs.Screen
          name="exercises"
          options={{ title: 'Exercises', tabBarIcon: tabIcon('exercises') }}
        />
        <Tabs.Screen
          name="history"
          options={{ title: 'History', tabBarIcon: tabIcon('history') }}
        />
        <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: tabIcon('more') }} />

        {/* Reachable from More rather than the bar: the Spotter is a dead end
          * until an AI provider is configured, and most accounts never do. */}
        <Tabs.Screen name="coach" options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>

      {/* Offline banner: absolute overlay so it renders above the navigator,
        * only when the offline queue has unflushed writes. */}
      {pending > 0 ? (
        <View
          className="absolute left-4 right-4 top-2 z-50 rounded-lg bg-amber-500/10 border border-amber-500/40 px-3 py-2.5"
          pointerEvents="none">
          <View className="flex-row items-center justify-center">
            <Ionicons name="cloud-offline-outline" size={16} color="#fbbf24" />
            <Text className="ml-2 text-xs font-semibold text-amber-300">
              Offline — {pending} {pending === 1 ? 'write' : 'writes'} queued, will sync when back online
            </Text>
          </View>
        </View>
      ) : null}
    </>
  );
}
