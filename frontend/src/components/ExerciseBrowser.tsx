import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Exercise } from '@/api/types';
import { titleCase } from '@/lib/format';
import { Text } from '@/components/ui/Text';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, ErrorState } from '@/components/ui/Feedback';
import { ExerciseRow } from '@/components/ExerciseRow';

const MUSCLES = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
  'calves',
  'abdominals',
];

const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'body only', 'kettlebells'];

const CATEGORIES = ['strength', 'cardio', 'stretching', 'powerlifting', 'olympic weightlifting'];

const PAGE_SIZE = 30;

interface ExerciseBrowserProps {
  onSelect: (exercise: Exercise) => void;
  renderTrailing?: (exercise: Exercise) => React.ReactNode;
}

export function ExerciseBrowser({ onSelect, renderTrailing }: ExerciseBrowserProps) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const [items, setItems] = useState<Exercise[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);

  const load = useCallback(
    async (reset: boolean) => {
      if (reset) {
        setLoading(true);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const res = await api.exercises({
          q: query || undefined,
          muscle: muscle ?? undefined,
          equipment: equipment ?? undefined,
          category: category ?? undefined,
          limit: PAGE_SIZE,
          offset: reset ? 0 : offsetRef.current,
        });
        setTotal(res.total);
        offsetRef.current = (reset ? 0 : offsetRef.current) + res.items.length;
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load exercises');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, muscle, equipment, category],
  );

  // Debounced reload on filter/query change.
  useEffect(() => {
    const t = setTimeout(() => {
      void load(true);
    }, 300);
    return () => clearTimeout(t);
  }, [load]);

  const canLoadMore = items.length < total && !loading && !loadingMore;
  const activeFilters = [muscle, equipment, category].filter(Boolean).length;

  function toggle(setter: (v: string | null) => void, current: string | null, value: string) {
    setter(current === value ? null : value);
  }

  function clearFilters() {
    setMuscle(null);
    setEquipment(null);
    setCategory(null);
  }

  return (
    <View className="flex-1">
      <View className="mx-4 flex-row items-center rounded-lg border border-iron-700 bg-iron-900 px-3">
        <Ionicons name="search" size={18} color="#64748b" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          placeholderTextColor="#64748b"
          selectionColor="#38bdf8"
          autoCapitalize="none"
          className="min-h-[48px] flex-1 px-3 text-base text-iron-50"
        />
      </View>

      <View className="mt-3 flex-row items-center justify-between px-4">
        <Text variant="caption" className="text-iron-400">
          Filter by muscle, equipment, or category
        </Text>
        {activeFilters > 0 ? (
          <Text
            variant="caption"
            accessibilityRole="button"
            onPress={clearFilters}
            className="font-bold text-brand">
            Clear {activeFilters}
          </Text>
        ) : null}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-2 max-h-11"
        contentContainerClassName="px-4">
        {MUSCLES.map((m) => (
          <Chip
            key={m}
            label={titleCase(m)}
            active={muscle === m}
            onPress={() => toggle(setMuscle, muscle, m)}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="max-h-11"
        contentContainerClassName="px-4">
        {EQUIPMENT.map((e) => (
          <Chip
            key={e}
            label={titleCase(e)}
            active={equipment === e}
            onPress={() => toggle(setEquipment, equipment, e)}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="max-h-11"
        contentContainerClassName="px-4">
        {CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={titleCase(c)}
            active={category === c}
            onPress={() => toggle(setCategory, category, c)}
          />
        ))}
      </ScrollView>

      {loading ? (
        <View className="flex-1 items-center justify-center py-16">
          <ActivityIndicator color="#38bdf8" />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(true)} />
      ) : items.length === 0 ? (
        <EmptyState icon="FIND" title="No exercises found" subtitle="Try a different search or filter." />
      ) : (
        <ScrollView
          className="flex-1 mt-1"
          contentContainerClassName="px-4 pb-28"
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
            const nearBottom =
              layoutMeasurement.height + contentOffset.y >= contentSize.height - 200;
            if (nearBottom && canLoadMore) void load(false);
          }}
          scrollEventThrottle={400}>
          <Text variant="caption" className="py-2 text-iron-400">
            {items.length} of {total} exercises
          </Text>
          {items.map((ex) => (
            <ExerciseRow
              key={ex.id}
              exercise={ex}
              onPress={() => onSelect(ex)}
              trailing={renderTrailing?.(ex)}
            />
          ))}
          {loadingMore ? (
            <View className="py-4">
              <ActivityIndicator color="#38bdf8" />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
