import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// [filled (active), outline (inactive)]
const ICONS: Record<string, [IoniconName, IoniconName]> = {
  index: ['home', 'home-outline'],
  workouts: ['calendar', 'calendar-outline'],
  exercises: ['search', 'search-outline'],
  history: ['time', 'time-outline'],
  coach: ['chatbubbles', 'chatbubbles-outline'],
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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: '#030712' },
        headerTintColor: '#f8fafc',
        headerTitleStyle: { fontWeight: '900' },
        headerShadowVisible: false,
        tabBarActiveTintColor: '#5eead4',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarActiveBackgroundColor: '#121a2a',
        tabBarShowLabel: true,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          alignSelf: 'center',
          width: '100%',
          maxWidth: 760,
          height: 70,
          backgroundColor: '#090e18',
          borderColor: 'transparent',
          borderTopColor: '#223047',
          borderWidth: 0,
          borderTopWidth: 1,
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarItemStyle: {
          marginHorizontal: 2,
          borderRadius: 12,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '800', marginTop: 0 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('index') }} />
      <Tabs.Screen
        name="workouts"
        options={{ title: 'Splits', tabBarIcon: tabIcon('workouts') }}
      />
      <Tabs.Screen
        name="exercises"
        options={{ title: 'Library', tabBarIcon: tabIcon('exercises') }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: 'History', tabBarIcon: tabIcon('history') }}
      />
      <Tabs.Screen name="coach" options={{ title: 'Spotter', tabBarIcon: tabIcon('coach') }} />

      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
