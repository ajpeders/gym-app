import { useCallback, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { Units } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useSettings } from '@/state/settings';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { shareText } from '@/lib/export';
import { confirm } from '@/lib/confirm';
import { cancelReminders, ensurePermission, scheduleWorkoutReminder } from '@/lib/notifications';

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row rounded-xl border border-iron-700 bg-iron-950 p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 items-center rounded-lg py-2.5 ${
              active ? 'bg-brand' : ''
            }`}>
            <Text
              className={`text-sm font-bold ${
                active ? 'text-iron-950' : 'text-iron-400'
              }`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Row({
  title,
  subtitle,
  value,
  onValueChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <View className="flex-1 pr-3">
        <Text variant="subheading">{title}</Text>
        {subtitle ? (
          <Text variant="muted" className="mt-0.5">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        // The title is a sibling Text, so without this a screen reader
        // announces "switch, on" with no idea what it controls.
        accessibilityLabel={title}
        trackColor={{ false: '#223047', true: '#5eead4' }}
        thumbColor={value ? '#030712' : '#64748b'}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { user, logout, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { settings, update } = useSettings();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Shared as text through the native sheet, the same way a split or a session
  // already exports — no new file-handling to maintain, and it lands wherever
  // the user keeps things (Files, mail, a note).
  const onExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const data = await api.exportAccount();
      await shareText('gym-app export', JSON.stringify(data, null, 2));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, []);

  async function patch(fn: () => Promise<void>) {
    setSaving(true);
    try {
      await fn();
    } catch {
      // Optimistic update keeps UI responsive.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Settings"
        subtitle="Units, training behaviour, your data and your account."
      />

      <Card className="mb-4 rounded-lg p-5" onPress={() => router.push('/profile')}>
        <View className="flex-row items-center justify-between">
          <View className="mr-3 h-12 w-12 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
            <Ionicons name="person-outline" size={21} color="#5eead4" />
          </View>
          <View className="flex-1 pr-3">
            <Text variant="subheading">{user?.display_name ?? 'Your profile'}</Text>
            <Text variant="caption" className="mt-0.5 text-iron-300">{user?.email}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#475569" />
        </View>
        <View className="mt-4 border-t border-iron-800 pt-3">
          <Text variant="caption" className="text-iron-300">
            Weight, goals, equipment and limitations.
          </Text>
        </View>
      </Card>

      <SectionHeader title={`Units${saving ? ' · saving…' : ''}`} className="mt-0" />
      <Card className="mb-4 rounded-lg p-5">
        <Segmented<Units>
          options={[
            { label: 'Kilograms (kg)', value: 'kg' },
            { label: 'Pounds (lb)', value: 'lb' },
          ]}
          value={settings.units}
          onChange={(units) => patch(() => update({ units }))}
        />
      </Card>

      <SectionHeader title="Training" />
      <Card className="mb-4 gap-3 rounded-lg p-5">
        <Row
          title="Quick-add buttons"
          subtitle="Show one-tap set buttons during a workout."
          value={settings.feature_flags.quick_buttons}
          onValueChange={(quick_buttons) =>
            patch(() =>
              update({
                feature_flags: { ...settings.feature_flags, quick_buttons },
              }),
            )
          }
        />
        <View className="h-px bg-iron-800" />
        {/* Local notifications, not push: the phone already knows when the rest
          * timer is up, and a server round-trip to say so needs a push token,
          * a service worker and something awake in the homelab. */}
        <Row
          title="Rest timer alerts"
          subtitle="Tell me when the planned rest is up, even with the screen off."
          value={!!settings.feature_flags.rest_alerts}
          onValueChange={(rest_alerts) => {
            if (rest_alerts) void ensurePermission();
            patch(() =>
              update({ feature_flags: { ...settings.feature_flags, rest_alerts } }),
            );
          }}
        />
        <View className="h-px bg-iron-800" />
        <Row
          title="Training reminders"
          subtitle="A nudge at 6pm on the days your split trains."
          value={!!settings.feature_flags.training_reminders}
          onValueChange={(training_reminders) => {
            void (async () => {
              if (training_reminders && (await ensurePermission())) {
                await scheduleWorkoutReminder({ hour: 18, minute: 0, weekdays: [] });
              } else {
                await cancelReminders();
              }
            })();
            patch(() =>
              update({ feature_flags: { ...settings.feature_flags, training_reminders } }),
            );
          }}
        />
      </Card>

      <SectionHeader title="Spotter" />
      <Card className="mb-4 rounded-lg p-5" onPress={() => router.push('/(tabs)/coach?setup=1')}>
        <View className="flex-row items-center">
          <View className="flex-1 pr-3">
            <Text variant="subheading">AI provider</Text>
            <Text variant="muted" className="mt-0.5">
              Ollama, Claude or OpenAI. Set up on the Spotter screen; nothing else needs it.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#475569" />
        </View>
      </Card>

      <SectionHeader title="Your data" />
      <Card className="mb-3">
        <Text variant="body">
          Take everything with you: splits, every logged session and set, body
          metrics, your athlete profile and your custom exercises, as one JSON
          file.
        </Text>
        <Button
          title="Export my data"
          variant="secondary"
          className="mt-3"
          loading={exporting}
          onPress={onExport}
        />
        {exportError ? (
          <Text variant="caption" className="mt-2 text-red-400">
            {exportError}
          </Text>
        ) : null}
      </Card>

      {/* Only for whoever runs the server; the API enforces it either way. */}
      {user?.is_admin ? (
        <Button
          title="Admin"
          variant="secondary"
          icon="server-outline"
          className="mb-3"
          onPress={() => router.push('/admin')}
        />
      ) : null}

      <Button
        title="Log out"
        variant="danger"
        onPress={() =>
          confirm('Log out?', 'Anything saved on this device and not yet synced will wait for your next sign-in.', () => void logout())
        }
      />

      {/* Promised on the onboarding screen: export or delete all of it here. */}
      <Card className="mb-3 mt-6 border-red-500/30">
        <Text variant="subheading">Delete account</Text>
        <Text variant="muted" className="mt-1">
          Your splits, every session and set, weigh-ins, photos and profile go with it. Export
          first if you want a copy. This cannot be undone.
        </Text>
        {deleteError ? (
          <Text variant="caption" className="mt-2 text-red-400">
            {deleteError}
          </Text>
        ) : null}
        <Button
          title="Delete my account"
          variant="danger"
          icon="trash-outline"
          className="mt-3"
          loading={deleting}
          onPress={() =>
            confirm(
              'Delete your account?',
              'Everything this account owns is deleted permanently. There is no undo.',
              () => {
                setDeleting(true);
                setDeleteError(null);
                void deleteAccount()
                  .catch((err) => setDeleteError(err instanceof Error ? err.message : 'Could not delete the account'))
                  .finally(() => setDeleting(false));
              },
              true,
            )
          }
        />
      </Card>

      <Text variant="caption" className="mt-6 text-center text-iron-500">
        Exercise data from wger.de (CC-BY-SA 4.0) and free-exercise-db (public
        domain).
      </Text>
    </Screen>
  );
}

