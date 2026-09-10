import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { AthleteProfile, Metric } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { useSettings } from '@/state/settings';

/** A glanceable athlete summary. Editing stays on Profile so Home remains fast. */
export function HomeProfileCard() {
  const router = useRouter();
  const { settings } = useSettings();
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [weighIn, setWeighIn] = useState<Metric | null>(null);

  const fetch = useCallback(async () => {
    try {
      const [p, metrics] = await Promise.all([api.getProfile(), api.metrics().catch(() => [] as Metric[])]);
      setProfile(p);
      setWeighIn(metrics.find((m) => m.weight != null) ?? null);
    } catch {
      // Non-fatal: the card just stays hidden until profile loads.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  if (!profile) return null;
  const weightUnit = settings.units;
  const heightUnit = settings.units === 'lb' ? 'in' : 'cm';
  const hasBodyStats = weighIn != null || profile.goal_weight != null || profile.height != null;

  return (
    <Card className="mb-4 p-4">
      <Pressable
        onPress={() => router.push('/profile')}
        accessibilityRole="button"
        className="flex-row items-center active:opacity-70">
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl border border-brand/25 bg-brand/10">
          <Ionicons name="person-outline" size={19} color="#5eead4" />
        </View>
        <View className="flex-1">
          <Text variant="subheading">Athlete profile</Text>
          <Text variant="caption" className="mt-0.5 text-iron-400">
            Weight, goals, equipment, and limitations
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#475569" />
      </Pressable>

      {hasBodyStats ? (
        <View className="mt-3 flex-row gap-2">
          <View className="flex-1 rounded-xl bg-iron-950 px-3 py-2.5">
            <Text variant="caption" className="text-iron-400">
              Weight
            </Text>
            <Text variant="label" className="mt-0.5">
              {weighIn?.weight == null ? '—' : `${weighIn.weight} ${weightUnit}`}
            </Text>
          </View>
          <View className="flex-1 rounded-xl bg-iron-950 px-3 py-2.5">
            <Text variant="caption" className="text-iron-400">
              Goal
            </Text>
            <Text variant="label" className="mt-0.5">
              {profile.goal_weight == null ? '—' : `${profile.goal_weight} ${weightUnit}`}
            </Text>
          </View>
          <View className="flex-1 rounded-xl bg-iron-950 px-3 py-2.5">
            <Text variant="caption" className="text-iron-400">
              Height
            </Text>
            <Text variant="label" className="mt-0.5">
              {profile.height == null ? '—' : `${profile.height} ${heightUnit}`}
            </Text>
          </View>
        </View>
      ) : null}

      {profile.injuries.length > 0 ? (
        <View className="mt-3 flex-row items-center rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
          <Ionicons name="shield-outline" size={15} color="#fcd34d" />
          <Text variant="caption" className="ml-2 flex-1 text-amber-200" numberOfLines={1}>
            {profile.injuries.join(' · ')}
          </Text>
          <Text variant="caption" className="font-bold text-amber-300">
            Edit
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
