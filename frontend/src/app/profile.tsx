import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { AthleteProfile, StatsSummary } from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { useSettings } from '@/state/settings';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  return (
    <View className="flex-1 rounded-lg border border-iron-800 bg-iron-900 px-3 py-3">
      <Ionicons name={icon} size={17} color="#818cf8" />
      <Text variant="heading" className="mt-2" numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Multiline text field that commits to the server on blur / end-editing. */
function ProfileField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');

  // Keep the local draft in sync when the canonical value changes elsewhere.
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === (value ?? null)) return;
    onCommit(next);
  }

  return (
    <View className="mb-4">
      <Text variant="label" className="mb-1.5">
        {label}
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onEndEditing={commit}
        onBlur={commit}
        placeholder={placeholder}
        placeholderTextColor="#64748b"
        multiline
        className="min-h-[64px] rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
        style={{ textAlignVertical: 'top' }}
      />
    </View>
  );
}

function NumericProfileField({
  label,
  value,
  unit,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | null;
  unit: string;
  placeholder: string;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));

  useEffect(() => {
    setDraft(value == null ? '' : String(value));
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(value == null ? '' : String(value));
      return;
    }
    if (parsed === value) return;
    onCommit(parsed);
  }

  return (
    <View className="flex-1 rounded-lg border border-iron-800 bg-iron-900 px-3 py-3">
      <Text variant="caption" className="font-bold uppercase tracking-wider text-iron-400">
        {label}
      </Text>
      <View className="mt-2 flex-row items-baseline">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor="#64748b"
          className="min-h-[40px] flex-1 p-0 text-2xl font-black text-iron-50"
        />
        <Text variant="caption" className="ml-1 text-iron-400">
          {unit}
        </Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { settings } = useSettings();
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [newInjury, setNewInjury] = useState('');

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProfile, nextStats] = await Promise.all([
        api.getProfile(),
        api.statsSummary().catch(() => null),
      ]);
      setProfile(nextProfile);
      setStats(nextStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, [load]);

  const save = useCallback(async (patch: Partial<AthleteProfile>) => {
    setSaveState('saving');
    try {
      const updated = await api.updateProfile(patch);
      setProfile(updated);
      setSaveState('saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState('idle'), 1800);
    } catch {
      setSaveState('error');
    }
  }, []);

  function setLevel(level: string) {
    if (!profile) return;
    // Tapping the active level clears it (nullable).
    const next = profile.experience_level === level ? null : level;
    void save({ experience_level: next });
  }

  function addInjury() {
    const trimmed = newInjury.trim();
    if (!trimmed || !profile) return;
    if (profile.injuries.some((i) => i.toLowerCase() === trimmed.toLowerCase())) {
      setNewInjury('');
      return;
    }
    setNewInjury('');
    void save({ injuries: [...profile.injuries, trimmed] });
  }

  function removeInjury(inj: string) {
    if (!profile) return;
    void save({ injuries: profile.injuries.filter((i) => i !== inj) });
  }

  if (loading) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Your profile' }} />
        <Loading label="Loading your profile…" />
      </Screen>
    );
  }

  if (error || !profile) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Your profile' }} />
        <ErrorState message={error ?? 'Profile unavailable'} onRetry={() => void load()} />
      </Screen>
    );
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Save failed'
          : '';
  const weightUnit = settings.units;
  const heightUnit = settings.units === 'lb' ? 'in' : 'cm';

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Your profile' }} />

      <View className="mb-4 mt-2 flex-row items-center justify-between">
        <Text variant="title">About you</Text>
        <Text
          variant="caption"
          className={saveState === 'error' ? 'text-red-400' : 'text-iron-400'}>
          {saveLabel}
        </Text>
      </View>

      <Text variant="muted" className="mb-5">
        Your spotter reads and writes this. Edit it by hand, or just talk to it.
      </Text>

      <Text variant="label" className="mb-2">
        BODY & GOAL
      </Text>
      <Card className="mb-5">
        <View className="flex-row gap-2">
          <NumericProfileField
            label="Weight"
            value={profile.current_weight}
            unit={weightUnit}
            placeholder="—"
            onCommit={(current_weight) => void save({ current_weight })}
          />
          <NumericProfileField
            label="Goal"
            value={profile.goal_weight}
            unit={weightUnit}
            placeholder="—"
            onCommit={(goal_weight) => void save({ goal_weight })}
          />
          <NumericProfileField
            label="Height"
            value={profile.height}
            unit={heightUnit}
            placeholder="—"
            onCommit={(height) => void save({ height })}
          />
        </View>
        <View className="mt-3 flex-row gap-2">
          <NumericProfileField
            label="Daily calories"
            value={profile.calorie_target}
            unit="cal"
            placeholder="—"
            onCommit={(calorie_target) => void save({ calorie_target })}
          />
          <NumericProfileField
            label="Daily protein"
            value={profile.protein_target}
            unit="g"
            placeholder="—"
            onCommit={(protein_target) => void save({ protein_target })}
          />
        </View>
        <Text variant="caption" className="mt-3 text-iron-400">
          These are coach context fields. Weigh-ins and progress photos can still track changes over
          time. Daily calorie and protein targets drive the nutrition screen.
        </Text>
      </Card>

      {/* Today / session note */}
      <Text variant="label" className="mb-2">
        TODAY
      </Text>
      <Card className="mb-5">
        {profile.session_note ? (
          <>
            <View className="flex-row items-start justify-between">
              <Text variant="body" className="flex-1 pr-3">
                {profile.session_note}
              </Text>
              <Pressable
                onPress={() => void save({ session_note: null })}
                hitSlop={8}
                accessibilityRole="button"
                className="active:opacity-60">
                <Text variant="label" className="text-brand">
                  Clear
                </Text>
              </Pressable>
            </View>
            <Text variant="caption" className="mt-2">
              A transient note for today’s session — clears when no longer relevant.
            </Text>
          </>
        ) : (
          <Text variant="muted">
            No note for today. Check in with your coach to set one.
          </Text>
        )}
      </Card>

      {/* Training stats */}
      {stats ? (
        <>
          <Text variant="label" className="mb-2">
            TRAINING STATS
          </Text>
          <Card className="mb-5">
            <View className="flex-row gap-2">
              <StatTile
                icon="barbell-outline"
                label="Sessions"
                value={String(stats.total_workouts)}
              />
              <StatTile
                icon="flame-outline"
                label="Streak"
                value={`${stats.streak ?? 0}d`}
              />
              <StatTile
                icon="calendar-outline"
                label="7 days"
                value={String(stats.this_week)}
              />
            </View>
            {stats.volume_by_week.length > 0 ? (
              <View className="mt-3 rounded-lg border border-iron-800 bg-iron-950 px-3 py-3">
                <Text variant="caption" className="font-bold uppercase tracking-wider text-iron-400">
                  Latest weekly volume
                </Text>
                <Text variant="heading" className="mt-1">
                  {Math.round(stats.volume_by_week.at(-1)?.volume ?? 0).toLocaleString()}
                </Text>
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* Experience level */}
      <Text variant="label" className="mb-2">
        EXPERIENCE LEVEL
      </Text>
      <View className="mb-5 flex-row">
        {LEVELS.map((level) => {
          const active = profile.experience_level === level;
          return (
            <Pressable
              key={level}
              onPress={() => setLevel(level)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={`mr-2 rounded-md border px-3 py-2 ${
                active ? 'border-brand bg-brand' : 'border-iron-700 bg-iron-900'
              }`}>
              <Text
                className={`text-sm font-bold capitalize ${
                  active ? 'text-iron-950' : 'text-iron-100'
                }`}>
                {level}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Injuries — safety-relevant */}
      <Text variant="label" className="mb-2 text-red-400">
        INJURIES & LIMITATIONS
      </Text>
      <Card className="mb-5 border-red-500/30">
        {profile.injuries.length === 0 ? (
          <Text variant="muted">None recorded.</Text>
        ) : (
          <View className="flex-row flex-wrap">
            {profile.injuries.map((inj) => (
              <Pressable
                key={inj}
                onPress={() => removeInjury(inj)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${inj}`}
                className="mb-2 mr-2 flex-row items-center rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 active:opacity-60">
                <Text variant="body" className="text-red-200">
                  {inj}
                </Text>
                <Text className="ml-2 text-sm font-bold text-red-400">✕</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View className="mt-2 flex-row items-center">
          <TextInput
            value={newInjury}
            onChangeText={setNewInjury}
            onSubmitEditing={addInjury}
            returnKeyType="done"
            placeholder="add injury (e.g. left shoulder)"
            placeholderTextColor="#64748b"
            className="flex-1 rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
          />
          <Pressable
            onPress={addInjury}
            disabled={!newInjury.trim()}
            accessibilityRole="button"
            className={`ml-2 rounded-lg px-4 py-3 ${
              newInjury.trim() ? 'bg-brand active:bg-brand-600' : 'bg-iron-800 opacity-50'
            }`}>
            <Text className="text-sm font-bold text-iron-950">Add</Text>
          </Pressable>
        </View>
      </Card>

      {/* Free-text fields */}
      <ProfileField
        label="GOALS"
        value={profile.goals}
        placeholder="e.g. build strength, run a 10k, stay healthy"
        onCommit={(goals) => void save({ goals })}
      />
      <ProfileField
        label="EQUIPMENT"
        value={profile.equipment}
        placeholder="e.g. full gym, or dumbbells + bands at home"
        onCommit={(equipment) => void save({ equipment })}
      />
      <ProfileField
        label="PREFERENCES"
        value={profile.preferences}
        placeholder="e.g. prefer free weights, dislike running, train mornings"
        onCommit={(preferences) => void save({ preferences })}
      />
      <ProfileField
        label="NOTES"
        value={profile.notes}
        placeholder="anything durable your coach should remember"
        onCommit={(notes) => void save({ notes })}
      />
    </Screen>
  );
}
