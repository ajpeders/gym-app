import { useCallback, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { AthleteProfile } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { useSettings } from '@/state/settings';

/**
 * Compact injuries + profile card for the Home screen so limitations are quick
 * to update mid-week. Injuries add/remove save immediately; the rest of the
 * profile (goals, equipment, level) is one tap away on the full profile screen.
 */
export function HomeProfileCard() {
  const router = useRouter();
  const { settings } = useSettings();
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [newInjury, setNewInjury] = useState('');
  const [busy, setBusy] = useState(false);

  const fetch = useCallback(async () => {
    try {
      setProfile(await api.getProfile());
    } catch {
      // Non-fatal: the card just stays hidden until profile loads.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  async function save(patch: Partial<AthleteProfile>) {
    setBusy(true);
    try {
      setProfile(await api.updateProfile(patch));
    } finally {
      setBusy(false);
    }
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

  if (!profile) return null;
  const weightUnit = settings.units;
  const heightUnit = settings.units === 'lb' ? 'in' : 'cm';
  const hasBodyStats =
    profile.current_weight != null || profile.goal_weight != null || profile.height != null;

  return (
    <Card elevated className="mb-4 rounded-lg p-5">
      <Pressable
        onPress={() => router.push('/profile')}
        accessibilityRole="button"
        className="mb-3 flex-row items-center active:opacity-70">
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-lg border border-brand/25 bg-brand/10">
          <Ionicons name="medkit-outline" size={19} color="#5eead4" />
        </View>
        <View className="flex-1">
          <Text variant="heading">Injuries & limitations</Text>
          <Text variant="caption" className="mt-0.5 text-iron-300">
            The coach works around these. Tap for goals, equipment & more.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#475569" />
      </Pressable>

      {hasBodyStats ? (
        <View className="mb-3 flex-row gap-2">
          <View className="flex-1 rounded-lg border border-iron-800 bg-iron-950 px-3 py-2.5">
            <Text variant="caption" className="text-iron-400">
              Weight
            </Text>
            <Text variant="label" className="mt-0.5">
              {profile.current_weight == null ? '—' : `${profile.current_weight} ${weightUnit}`}
            </Text>
          </View>
          <View className="flex-1 rounded-lg border border-iron-800 bg-iron-950 px-3 py-2.5">
            <Text variant="caption" className="text-iron-400">
              Goal
            </Text>
            <Text variant="label" className="mt-0.5">
              {profile.goal_weight == null ? '—' : `${profile.goal_weight} ${weightUnit}`}
            </Text>
          </View>
          <View className="flex-1 rounded-lg border border-iron-800 bg-iron-950 px-3 py-2.5">
            <Text variant="caption" className="text-iron-400">
              Height
            </Text>
            <Text variant="label" className="mt-0.5">
              {profile.height == null ? '—' : `${profile.height} ${heightUnit}`}
            </Text>
          </View>
        </View>
      ) : null}

      {profile.injuries.length === 0 ? (
        <Text variant="muted" className="mb-3">
          None flagged. Add anything tender so sessions steer around it.
        </Text>
      ) : (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {profile.injuries.map((inj) => (
            <Pressable
              key={inj}
              onPress={() => removeInjury(inj)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${inj}`}
              className="flex-row items-center rounded-full border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 active:opacity-70">
              <Text variant="caption" className="font-semibold text-yellow-300">
                {inj}
              </Text>
              <Ionicons name="close" size={13} color="#fde047" style={{ marginLeft: 6 }} />
            </Pressable>
          ))}
        </View>
      )}

      <View className="flex-row items-center">
        <TextInput
          value={newInjury}
          onChangeText={setNewInjury}
          onSubmitEditing={addInjury}
          returnKeyType="done"
          placeholder="e.g. left shoulder — tweaky overhead"
          placeholderTextColor="#64748b"
          className="mr-2 flex-1 rounded-lg border border-iron-700 bg-iron-900 px-3.5 py-2.5 text-base text-iron-50"
        />
        <Pressable
          onPress={addInjury}
          disabled={busy || newInjury.trim() === ''}
          accessibilityRole="button"
          className={`h-11 w-11 items-center justify-center rounded-lg ${
            newInjury.trim() ? 'bg-brand active:bg-brand-600' : 'bg-iron-800 opacity-50'
          }`}>
          <Ionicons name="add" size={22} color="#05070a" />
        </Pressable>
      </View>
    </Card>
  );
}
