import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { ActionRow } from '@/components/ui/ActionRow';

/**
 * Everything the app can do that isn't logging a set.
 *
 * The bar carries the four screens a workout needs. The rest — tools, stats,
 * the Spotter, the athlete profile — lives here, in one list, so Home and
 * History stop growing rows of buttons for things they aren't about.
 */
export default function MoreScreen() {
  const router = useRouter();
  const { configured, loading } = useAiStatus();

  return (
    <Screen>
      <ScreenHeader title="More" subtitle="Tools, stats and settings." />

      <Card className="mb-4 rounded-lg p-2">
        <ActionRow
          icon="chatbubbles-outline"
          title="Spotter"
          subtitle={
            loading ? undefined : configured ? 'Log and read back your training by chat.' : 'Needs an AI provider. Set one up to use it.'
          }
          onPress={() => router.push('/(tabs)/coach')}
        />
        <ActionRow
          icon="stats-chart-outline"
          title="Insights"
          subtitle="Volume by muscle, balance, trends and milestones."
          onPress={() => router.push('/insights')}
        />
        <ActionRow
          icon="trending-up-outline"
          title="Progress"
          subtitle="Weigh-ins and progress photos."
          onPress={() => router.push('/progress')}
        />
        <ActionRow
          icon="calculator-outline"
          title="Calculators"
          subtitle="Plates, warm-up ramps and estimated max."
          onPress={() => router.push('/calculators')}
        />
        <ActionRow
          icon="nutrition-outline"
          title="Nutrition"
          subtitle="Calories and protein for today."
          onPress={() => router.push('/nutrition')}
        />
      </Card>

      <Card className="mb-4 rounded-lg p-2">
        <ActionRow
          icon="person-outline"
          title="Athlete profile"
          subtitle="Weight, goals, equipment and limitations."
          onPress={() => router.push('/profile')}
        />
        <ActionRow
          icon="settings-outline"
          title="Settings"
          subtitle="Units, training behaviour, AI provider, your data."
          onPress={() => router.push('/(tabs)/settings')}
        />
      </Card>
      <View className="h-6" />
    </Screen>
  );
}
