import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Metric } from '@/api/types';
import { useSettings } from '@/state/settings';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { FormField } from '@/components/ui/FormField';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { BottomAction } from '@/components/ui/BottomAction';
import { FormError } from '@/components/ui/Feedback';
import { confirm } from '@/lib/confirm';
import { formatDate, parseServerDate } from '@/lib/format';
import { toDateStr } from '@/lib/day-label';

/**
 * Weigh-ins.
 *
 * `BodyMetric` is the source of truth for weight over time — the nutrition
 * week summary reads it, and so does anything that wants a trend. Nothing in
 * the app wrote one until now, so that history was empty for everyone and the
 * profile's "current weight" was a single number you overwrote, with no past.
 *
 * A weigh-in can be dated, because the scale doesn't care whether you opened
 * the app: a history that only records the days you remembered is a record of
 * your memory, not your weight.
 */

const PRESETS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: 1 },
  { label: '2 days ago', days: 2 },
  { label: 'A week ago', days: 7 },
];

function dateDaysBack(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toDateStr(d);
}

/** Local noon, as the UTC instant the API stores — noon so no offset moves the day. */
function isoForDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

export function WeighIns() {
  const { settings } = useSettings();
  const unit = settings?.units ?? 'kg';

  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(() => dateDaysBack(0));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // A weight section that fails must not take the screen down with it.
    setMetrics(await api.metrics().catch(() => []));
  }, []);

  // Re-read on focus, so a weigh-in logged from somewhere else is here when
  // you come back. (Not useMemo — that's for values, and running an effect in
  // one is not something React promises to do once, or at all.)
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const weighed = useMemo(
    () => (metrics ?? []).filter((m) => m.weight != null),
    [metrics],
  );
  const latest = weighed[0] ?? null;
  // Newest first, so the one after the latest is the one before it in time.
  const previous = weighed[1] ?? null;
  const change =
    latest?.weight != null && previous?.weight != null
      ? Math.round((latest.weight - previous.weight) * 10) / 10
      : null;

  function openSheet() {
    setWeight(latest?.weight != null ? String(latest.weight) : '');
    setDate(dateDaysBack(0));
    setNotes('');
    setError(null);
    setOpen(true);
  }

  async function save() {
    const value = parseFloat(weight);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a weight.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Enter the date as YYYY-MM-DD.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createMetric({
        weight: value,
        notes: notes.trim() || null,
        recorded_at: isoForDate(date),
      });
      setOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that weigh-in');
    } finally {
      setBusy(false);
    }
  }

  function remove(metric: Metric) {
    confirm(
      'Delete weigh-in?',
      `${metric.weight} ${unit} on ${formatDate(metric.recorded_at)} will be removed.`,
      async () => {
        try {
          await api.deleteMetric(metric.id);
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not delete that weigh-in');
        }
      },
      true,
    );
  }

  return (
    <>
      <Card className="mb-4 rounded-[20px] p-4">
        <View className="mb-3 flex-row items-center">
          <Ionicons name="scale-outline" size={16} color="#5eead4" />
          <Text variant="label" className="ml-2 flex-1 text-brand">
            Weight
          </Text>
          <Pressable onPress={openSheet} hitSlop={8} className="active:opacity-60">
            <Text variant="caption" className="font-bold text-brand">
              Log weigh-in
            </Text>
          </Pressable>
        </View>

        {latest ? (
          <>
            <Text variant="stat">
              {latest.weight}
              <Text variant="caption" className="text-iron-500"> {unit}</Text>
              {change != null ? (
                // Neither direction is praised or scolded — which way is
                // progress depends on a goal this card doesn't know.
                <Text variant="caption" className="text-iron-400">
                  {'  '}
                  {change > 0 ? '+' : ''}
                  {change} since last
                </Text>
              ) : null}
            </Text>
            <Text variant="caption" className="mt-0.5 text-iron-400">
              {formatDate(latest.recorded_at)}
            </Text>

            {weighed.length > 1 ? (
              <View className="mt-3 border-t border-iron-800 pt-2">
                {weighed.slice(0, 6).map((m) => (
                  <View key={m.id} className="flex-row items-center py-1.5">
                    <Text variant="caption" className="flex-1 text-iron-300">
                      {formatDate(m.recorded_at)}
                    </Text>
                    <Text variant="caption" className="mr-3 text-iron-100">
                      {m.weight} {unit}
                    </Text>
                    <Pressable onPress={() => remove(m)} hitSlop={8} className="active:opacity-60">
                      <Ionicons name="trash-outline" size={15} color="#64748b" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Text variant="muted">
            No weigh-ins yet. Logging them is what puts a weight trend next to
            your training and your food.
          </Text>
        )}
        {error && !open ? (
          <View className="mt-2">
            <FormError message={error} />
          </View>
        ) : null}
      </Card>

      <ModalSheet
        visible={open}
        title="Log a weigh-in"
        icon="scale-outline"
        onClose={() => setOpen(false)}
        footer={
          <BottomAction>
            <Button title="Save" size="lg" loading={busy} onPress={() => void save()} />
          </BottomAction>
        }
      >
        <View className="gap-3">
          <FormField
            label={`Weight (${unit})`}
            value={weight}
            onChangeText={setWeight}
            keyboardType="numeric"
            placeholder="82"
            autoFocus
          />
          <View>
            <Text variant="caption" className="mb-1.5 text-iron-400">
              When
            </Text>
            <View className="flex-row flex-wrap">
              {PRESETS.map((p) => (
                <Chip
                  key={p.days}
                  label={p.label}
                  active={date === dateDaysBack(p.days)}
                  onPress={() => setDate(dateDaysBack(p.days))}
                />
              ))}
            </View>
            <FormField
              label="Or a date"
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </View>
          <FormField
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional"
            multiline
          />
          {error ? <FormError message={error} /> : null}
        </View>
      </ModalSheet>
    </>
  );
}
