import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';

import { api } from '@/api/client';
import type { AthleteProfile } from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Loading, ErrorState } from '@/components/ui/Feedback';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

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
        placeholderTextColor="#78716c"
        multiline
        className="min-h-[64px] rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
        style={{ textAlignVertical: 'top' }}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [newInjury, setNewInjury] = useState('');

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfile(await api.getProfile());
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
        Your coach reads and writes this. Edit it by hand, or just talk to your coach.
      </Text>

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
            placeholderTextColor="#78716c"
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
