import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';

import { api } from '@/api/client';
import type { OneRepMax, PlateBreakdown, WarmupSet } from '@/api/types';
import { useSettings } from '@/state/settings';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * The three sums you'd otherwise do standing at the bar.
 *
 * Every answer comes from the API (`app/calculators.py`) rather than being
 * recomputed here: two implementations of plate maths is one too many, and the
 * one that drifts is always the one you're looking at.
 */

const INPUT =
  'rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-base text-iron-100';

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  return (
    <View className="flex-1">
      <Text variant="caption" className="mb-1 text-iron-400">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor="#64748b"
        selectionColor="#5eead4"
        className={INPUT}
      />
    </View>
  );
}

export default function CalculatorsScreen() {
  const { settings } = useSettings();
  const units = settings.units;

  const [plateTarget, setPlateTarget] = useState('100');
  const [plates, setPlates] = useState<PlateBreakdown | null>(null);
  const [warmupWeight, setWarmupWeight] = useState('100');
  const [warmup, setWarmup] = useState<WarmupSet[] | null>(null);
  const [maxWeight, setMaxWeight] = useState('100');
  const [maxReps, setMaxReps] = useState('5');
  const [max, setMax] = useState<OneRepMax | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>, set: (v: T) => void) {
    setError(null);
    try {
      set(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not work that out');
    }
  }

  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Calculators' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        {error ? <Text className="mb-3 text-sm text-red-400">{error}</Text> : null}

        <Card className="mb-4">
          <Text variant="heading">Plates</Text>
          <Text variant="muted" className="mb-3 mt-0.5">
            What goes on each side, heaviest first — the order you load them.
          </Text>
          <View className="flex-row items-end gap-2">
            <Field
              label={`Target (${units})`}
              value={plateTarget}
              onChangeText={setPlateTarget}
              placeholder="100"
            />
            <Button
              title="Work it out"
              className="flex-1"
              onPress={() => {
                const target = num(plateTarget);
                if (target) void run(() => api.plateBreakdown(target, units), setPlates);
              }}
            />
          </View>
          {plates ? (
            <View className="mt-3 rounded-lg border border-iron-800 bg-iron-950/60 p-3">
              {plates.below_bar ? (
                <Text variant="label">
                  That&apos;s under the bar ({plates.bar}
                  {units}) — nothing to load.
                </Text>
              ) : (
                <>
                  <Text variant="label">
                    {plates.per_side.length > 0
                      ? plates.per_side.join(' + ') + ' per side'
                      : 'Just the bar'}
                  </Text>
                  <Text variant="caption" className="mt-1 text-iron-400">
                    {plates.bar}
                    {units} bar · {plates.achievable}
                    {units} total
                    {plates.leftover > 0
                      ? ` — ${plates.leftover}${units} short of ${plates.target}${units}`
                      : ''}
                  </Text>
                </>
              )}
            </View>
          ) : null}
        </Card>

        <Card className="mb-4">
          <Text variant="heading">Warmup</Text>
          <Text variant="muted" className="mb-3 mt-0.5">
            A ramp from the empty bar to just under your working weight, on
            weights you can actually load.
          </Text>
          <View className="flex-row items-end gap-2">
            <Field
              label={`Working weight (${units})`}
              value={warmupWeight}
              onChangeText={setWarmupWeight}
              placeholder="100"
            />
            <Button
              title="Build ramp"
              className="flex-1"
              onPress={() => {
                const weight = num(warmupWeight);
                if (weight) void run(() => api.warmupSets(weight, units), setWarmup);
              }}
            />
          </View>
          {warmup ? (
            <View className="mt-3 rounded-lg border border-iron-800 bg-iron-950/60 p-3">
              {warmup.length === 0 ? (
                <Text variant="label">That&apos;s the bar — no ramp needed.</Text>
              ) : (
                warmup.map((s, i) => (
                  <Text key={i} variant="label" className="mb-1 last:mb-0">
                    {s.weight}
                    {units} x {s.reps}
                  </Text>
                ))
              )}
            </View>
          ) : null}
        </Card>

        <Card className="mb-4">
          <Text variant="heading">Estimated max</Text>
          <Text variant="muted" className="mb-3 mt-0.5">
            From a set you&apos;ve actually done. An estimate for planning, not a
            number to attempt.
          </Text>
          <View className="flex-row gap-2">
            <Field
              label={`Weight (${units})`}
              value={maxWeight}
              onChangeText={setMaxWeight}
              placeholder="100"
            />
            <Field label="Reps" value={maxReps} onChangeText={setMaxReps} placeholder="5" />
          </View>
          <Button
            title="Estimate"
            className="mt-3"
            onPress={() => {
              const weight = num(maxWeight);
              const reps = num(maxReps);
              if (weight && reps) void run(() => api.oneRepMax(weight, reps), setMax);
            }}
          />
          {max ? (
            <View className="mt-3 rounded-lg border border-iron-800 bg-iron-950/60 p-3">
              <Text variant="heading">
                ≈ {max.estimate}
                {units}
              </Text>
              <View className="mt-2 flex-row flex-wrap">
                {Object.entries(max.percentages).map(([pct, weight]) => (
                  <Text key={pct} variant="caption" className="mr-3 mb-1 text-iron-300">
                    {pct} · {weight}
                    {units}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}
