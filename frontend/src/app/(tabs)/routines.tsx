import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { api } from '@/api/client';
import type { Routine } from '@/api/types';
import { Screen } from '@/components/ui/Screen';
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
        contentContainerClassName="px-4 pt-2 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void fetchData();
            }}
          />
        }>
        <View className="flex-row items-center justify-between mt-2 mb-3">
          <Text variant="title">Routines</Text>
          <Button title="＋ New" size="sm" onPress={() => router.push('/routine/new')} />
        </View>

        {loading ? (
          <Loading />
        ) : routines.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No routines yet"
            subtitle="Create a routine to plan your sessions and start workouts faster."
          />
        ) : (
          <View className="gap-2">
            {routines.map((r) => (
              <Card key={r.id} onPress={() => router.push(`/routine/${r.id}`)}>
                <Text variant="subheading">{r.name}</Text>
                {r.notes ? (
                  <Text variant="muted" numberOfLines={1} className="mt-0.5">
                    {r.notes}
                  </Text>
                ) : null}
                <Text variant="muted" className="mt-1">
                  {r.exercises.length} exercises
                </Text>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
