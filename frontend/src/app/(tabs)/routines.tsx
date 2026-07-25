import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Routine } from '@/api/types';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, EmptyState } from '@/components/ui/Feedback';

export default function RoutinesScreen() {
  const router = useRouter();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const r = await api.routines();
      setRoutines(r);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
    }, [fetchData]),
  );

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-4 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchData();
            }}
          />
        }>
        <ScreenHeader
          eyebrow="Plans"
          title="Splits"
          subtitle="Build, import, and refine the plans you actually train from."
          action={
            <View className="ml-3 flex-row gap-2">
              <Button
                title="Import"
                variant="secondary"
                size="sm"
                icon="document-text-outline"
                onPress={() => router.push('/routine-import')}
              />
              <Button title="New" size="sm" icon="add" onPress={() => router.push('/routine/new')} />
            </View>
          }
        />

        {loading ? (
          <Loading />
        ) : routines.length === 0 ? (
          <EmptyState
            icon="PLAN"
            title="No splits yet"
            subtitle="Create a split to plan your sessions and start workouts faster."
          />
        ) : (
          <View className="gap-2">
            {routines.map((r) => (
              <Card key={r.id} onPress={() => router.push(`/routine/${r.id}`)} className="rounded-[22px] p-5">
                <View className="flex-row items-center">
                  <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
                    <Ionicons name="clipboard-outline" size={22} color="#f97316" />
                  </View>
                  <View className="flex-1">
                    <Text variant="subheading" numberOfLines={1}>
                      {r.name}
                    </Text>
                    {r.notes ? (
                      <Text variant="caption" numberOfLines={1} className="mt-0.5">
                        {r.notes}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#57534e" />
                </View>
                <View className="mt-3 flex-row gap-2">
                  <View className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1">
                    <Text variant="caption" className="font-bold text-brand">
                      {r.exercises.length} exercises
                    </Text>
                  </View>
                  <View className="rounded-full border border-iron-700 bg-iron-850 px-2.5 py-1">
                    <Text variant="caption" className="font-bold text-iron-300">
                      Planned
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
