import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Routine, Split } from '@/api/types';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, EmptyState } from '@/components/ui/Feedback';

export default function SplitsScreen() {
  const router = useRouter();
  const [splits, setSplits] = useState<Split[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api.splits().catch(() => [] as Split[]),
        api.routines().catch(() => [] as Routine[]),
      ]);
      setSplits(s);
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

  // Routines not part of any split — standalone days.
  const standalone = routines.filter((r) => r.split_id == null);

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
          subtitle="Your weekly plans — a split holds each training day."
          action={
            <View className="ml-3 flex-row gap-2">
              <Button
                title="Import"
                variant="secondary"
                size="sm"
                icon="document-text-outline"
                onPress={() => router.push('/routine-import')}
              />
              <Button title="Day" size="sm" icon="add" onPress={() => router.push('/routine/new')} />
            </View>
          }
        />

        {loading ? (
          <Loading />
        ) : splits.length === 0 && standalone.length === 0 ? (
          <EmptyState
            icon="PLAN"
            title="No splits yet"
            subtitle="Import your weekly plan or create a day to get started."
          />
        ) : (
          <>
            {splits.map((s) => {
              const trainingDays = s.routines.length;
              return (
                <Card
                  key={s.id}
                  onPress={() => router.push(`/split/${s.id}`)}
                  className="mb-3 rounded-[22px] p-5">
                  <View className="flex-row items-center">
                    <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
                      <Ionicons name="calendar" size={22} color="#f97316" />
                    </View>
                    <View className="flex-1">
                      <Text variant="subheading" numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text variant="caption" className="mt-0.5 text-iron-400">
                        {trainingDays} training days · weekly plan
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#57534e" />
                  </View>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {s.is_active ? (
                      <View className="rounded-full border border-brand/40 bg-brand/15 px-2.5 py-1">
                        <Text variant="caption" className="font-bold text-brand">
                          Active
                        </Text>
                      </View>
                    ) : null}
                    {s.rules.length > 0 ? (
                      <View className="rounded-full border border-iron-700 bg-iron-850 px-2.5 py-1">
                        <Text variant="caption" className="font-bold text-iron-300">
                          {s.rules.length} rules
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Card>
              );
            })}

            {standalone.length > 0 ? (
              <>
                <SectionHeader title="Standalone days" subtitle="Day-routines not tied to a split." />
                <View className="gap-2">
                  {standalone.map((r) => (
                    <Card
                      key={r.id}
                      onPress={() => router.push(`/routine/${r.id}`)}
                      className="rounded-[20px] p-4">
                      <View className="flex-row items-center">
                        <View className="flex-1">
                          <Text variant="subheading" numberOfLines={1}>
                            {r.name}
                          </Text>
                          <Text variant="caption" className="mt-0.5 text-iron-400">
                            {r.exercises.length} exercises
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#57534e" />
                      </View>
                    </Card>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
