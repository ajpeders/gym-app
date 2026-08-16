import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { NutritionEntry } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { parseServerDate } from '@/lib/format';

/** Local calendar day key — the server stores UTC and has no user timezone. */
function dayKey(iso: string): string {
  const d = parseServerDate(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Metric({
  label,
  value,
  target,
  unit,
}: {
  label: string;
  value: number;
  target: number | null;
  unit: string;
}) {
  const pct = target && target > 0 ? Math.min(1, value / target) : null;
  return (
    <View className="flex-1">
      <Text variant="caption" className="text-iron-400">
        {label}
      </Text>
      <Text variant="subheading" className="mt-0.5 text-iron-50">
        {Math.round(value)}
        {target ? <Text className="text-iron-500"> / {Math.round(target)}</Text> : null}
        <Text variant="caption" className="text-iron-500"> {unit}</Text>
      </Text>
      {pct != null ? (
        <View className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-iron-800">
          <View
            style={{ width: `${pct * 100}%` }}
            className={`h-full rounded-full ${pct >= 1 ? 'bg-mint' : 'bg-brand'}`}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Today's calories and protein, tapping through to the full log. */
export function HomeNutritionCard() {
  const router = useRouter();
  const [today, setToday] = useState<NutritionEntry[]>([]);
  const [calorieTarget, setCalorieTarget] = useState<number | null>(null);
  const [proteinTarget, setProteinTarget] = useState<number | null>(null);

  const load = useCallback(async () => {
    // Nutrition is decoration on this screen — a failure must not break Home.
    const [rows, profile] = await Promise.all([
      api.nutrition(2).catch(() => [] as NutritionEntry[]),
      api.getProfile().catch(() => null),
    ]);
    const key = dayKey(new Date().toISOString());
    setToday(rows.filter((e) => dayKey(e.eaten_at) === key));
    setCalorieTarget(profile?.calorie_target ?? null);
    setProteinTarget(profile?.protein_target ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const calories = today.reduce((t, e) => t + (e.calories ?? 0), 0);
  const protein = today.reduce((t, e) => t + (e.protein ?? 0), 0);

  return (
    <Card className="mb-4 rounded-[20px] p-4" onPress={() => router.push('/nutrition')}>
      <View className="mb-3 flex-row items-center">
        <Ionicons name="restaurant-outline" size={16} color="#5eead4" />
        <Text variant="label" className="ml-2 flex-1 text-brand">
          Nutrition today
        </Text>
        <Text variant="caption" className="text-iron-500">
          {today.length} {today.length === 1 ? 'entry' : 'entries'}
        </Text>
        <Ionicons name="chevron-forward" size={16} color="#475569" />
      </View>
      <View className="flex-row gap-4">
        <Metric label="Calories" value={calories} target={calorieTarget} unit="cal" />
        <Metric label="Protein" value={protein} target={proteinTarget} unit="g" />
      </View>
    </Card>
  );
}
