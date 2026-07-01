import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// [filled (active), outline (inactive)]
const ICONS: Record<string, [IoniconName, IoniconName]> = {
  index: ['home', 'home-outline'],
  coach: ['chatbubbles', 'chatbubbles-outline'],
  settings: ['settings', 'settings-outline'],
};

function tabIcon(name: keyof typeof ICONS) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => {
    const [active, inactive] = ICONS[name];
    return (
      <View
        className={`h-9 w-12 items-center justify-center rounded-lg ${
          focused ? 'bg-brand/15' : 'bg-transparent'
        }`}>
        <Ionicons name={focused ? active : inactive} size={size ?? 22} color={color} />
      </View>
    );
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: '#080706' },
        headerTintColor: '#f5f5f4',
        headerTitleStyle: { fontWeight: '900' },
        headerShadowVisible: false,
        tabBarActiveTintColor: '#f97316',
        tabBarInactiveTintColor: '#a8a29e',
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: Platform.OS === 'ios' ? 12 : 10,
          borderRadius: 18,
          backgroundColor: '#12100e',
          borderColor: '#292524',
          borderWidth: 1,
          height: Platform.OS === 'ios' ? 74 : 64,
          paddingBottom: Platform.OS === 'ios' ? 14 : 8,
          paddingTop: 7,
        },
        tabBarItemStyle: {
          borderRadius: 8,
          marginHorizontal: 4,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', marginTop: 2 },
      }}>
      {/* Visible tabs */}
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('index') }} />
      <Tabs.Screen
        name="coach"
        options={{ title: 'Coach', headerShown: true, tabBarIcon: tabIcon('coach') }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings') }} />

      {/* Scope trimmed for now — kept as routes (reachable from Home), hidden from the
          tab bar. Roadmap: bring back as dedicated tabs. */}
      <Tabs.Screen name="workouts" options={{ href: null }} />
      <Tabs.Screen name="exercises" options={{ href: null }} />
      <Tabs.Screen name="routines" options={{ href: null }} />
    </Tabs>
  );
}
