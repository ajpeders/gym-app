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
};

function tabIcon(name: keyof typeof ICONS) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => {
    const [active, inactive] = ICONS[name];
    return (
      <View className="h-8 w-12 items-center justify-center">
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
          left: 0,
          right: 0,
          bottom: 0,
          maxWidth: 760,
          marginHorizontal: Platform.OS === 'web' ? 'auto' : 0,
          borderRadius: 0,
          backgroundColor: '#0d0c0b',
          borderColor: 'transparent',
          borderTopColor: '#292524',
          borderWidth: 0,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 78 : 66,
          paddingBottom: Platform.OS === 'ios' ? 16 : 8,
          paddingTop: 8,
        },
        tabBarItemStyle: {
          marginHorizontal: 2,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('index') }} />
      <Tabs.Screen
        name="workouts"
        options={{ title: 'Workouts', tabBarIcon: tabIcon('workouts') }}
      />
      <Tabs.Screen
        name="routines"
        options={{ title: 'Plans', tabBarIcon: tabIcon('routines') }}
      />
      <Tabs.Screen name="coach" options={{ title: 'Coach', tabBarIcon: tabIcon('coach') }} />

      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="exercises" options={{ href: null }} />
    </Tabs>
  );
}
