import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
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
  const [filtersOpen, setFiltersOpen] = useState(false);

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
      <View className="mx-4 flex-row gap-2">
        <View className="min-w-0 flex-1 flex-row items-center rounded-xl border border-iron-700 bg-iron-900 px-3">
          <Ionicons name="search" size={18} color="#64748b" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={total ? `Search ${total} exercises` : 'Search exercises'}
            placeholderTextColor="#64748b"
            selectionColor="#5eead4"
            autoCapitalize="none"
            className="min-h-[48px] flex-1 px-3 text-base text-iron-50"
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color="#64748b" />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setFiltersOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          accessibilityLabel={activeFilters ? `Filters, ${activeFilters} active` : 'Filters'}
          className={`h-12 min-w-12 flex-row items-center justify-center rounded-xl border px-3 active:opacity-75 ${
            filtersOpen || activeFilters > 0
              ? 'border-brand/50 bg-brand/10'
              : 'border-iron-700 bg-iron-900'
          }`}>
          <Ionicons name="options-outline" size={19} color={filtersOpen || activeFilters ? '#5eead4' : '#94a3b8'} />
          {activeFilters > 0 ? (
            <View className="ml-1.5 h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1">
              <Text variant="caption" className="font-black text-iron-950">
                {activeFilters}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {filtersOpen ? (
        <View className="mx-4 mt-3 rounded-2xl border border-iron-800 bg-iron-900/90 p-3">
          <View className="mb-2 flex-row items-center justify-between">
            <Text variant="subheading">Filters</Text>
            {activeFilters > 0 ? (
              <Pressable onPress={clearFilters} hitSlop={8} accessibilityRole="button">
                <Text variant="label" className="text-brand">
                  Clear all
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Text variant="caption" className="mb-2 text-iron-400">
            Muscle
          </Text>
          <View className="flex-row flex-wrap">
            {MUSCLES.map((m) => (
              <Chip
                key={m}
                label={titleCase(m)}
                active={muscle === m}
                onPress={() => toggle(setMuscle, muscle, m)}
              />
            ))}
          </View>

          <Text variant="caption" className="mb-2 mt-1 text-iron-400">
            Equipment
          </Text>
          <View className="flex-row flex-wrap">
            {EQUIPMENT.map((e) => (
              <Chip
                key={e}
                label={titleCase(e)}
                active={equipment === e}
                onPress={() => toggle(setEquipment, equipment, e)}
              />
            ))}
          </View>

          <Text variant="caption" className="mb-2 mt-1 text-iron-400">
            Category
          </Text>
          <View className="flex-row flex-wrap">
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={titleCase(c)}
                active={category === c}
                onPress={() => toggle(setCategory, category, c)}
              />
            ))}
          </View>
        </View>
      ) : activeFilters > 0 ? (
        <View className="mt-2 flex-row items-center justify-between px-4">
          <Text variant="caption" className="text-brand">
            {activeFilters} {activeFilters === 1 ? 'filter' : 'filters'} active
          </Text>
          <Pressable onPress={clearFilters} hitSlop={8} accessibilityRole="button">
            <Text variant="caption" className="font-bold text-brand">
              Clear
            </Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center py-16">
          <ActivityIndicator color="#5eead4" />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(true)} />
      ) : items.length === 0 ? (
        <EmptyState icon="FIND" title="No exercises found" subtitle="Try a different search or filter." />
      ) : (
        <ScrollView
          className="mt-1 flex-1"
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
              <ActivityIndicator color="#5eead4" />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
