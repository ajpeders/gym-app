import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// [filled (active), outline (inactive)]
const ICONS: Record<string, [IoniconName, IoniconName]> = {
  index: ['home', 'home-outline'],
  workouts: ['barbell', 'barbell-outline'],
  routines: ['calendar', 'calendar-outline'],
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
          borderRadius: 22,
          backgroundColor: '#100f0d',
          borderColor: '#2a2521',
          borderWidth: 1,
          height: Platform.OS === 'ios' ? 78 : 68,
          paddingBottom: Platform.OS === 'ios' ? 14 : 8,
          paddingTop: 8,
        },
        tabBarItemStyle: {
          borderRadius: 12,
          marginHorizontal: 4,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800', marginTop: 1 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('index') }} />
      <Tabs.Screen
        name="workouts"
        options={{ title: 'Workouts', tabBarIcon: tabIcon('workouts') }}
      />
      <Tabs.Screen
        name="routines"
        options={{ title: 'Splits', tabBarIcon: tabIcon('routines') }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: tabIcon('settings') }} />

      <Tabs.Screen name="coach" options={{ href: null, headerShown: true }} />
      <Tabs.Screen name="exercises" options={{ href: null }} />
    </Tabs>
  );
}
