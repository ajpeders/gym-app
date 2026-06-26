import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import type { AiProvider, Units } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useSettings } from '@/state/settings';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

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
    <View className="flex-row rounded-lg border border-iron-700 bg-iron-950 p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 items-center rounded-md py-2 ${
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
        trackColor={{ false: '#292524', true: '#f97316' }}
        thumbColor={value ? '#080706' : '#78716c'}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { settings, update } = useSettings();
  const [saving, setSaving] = useState(false);

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
      <Text variant="title" className="mt-2 mb-4">
        Settings
      </Text>

      <Card className="mb-4">
        <Text variant="muted">Signed in as</Text>
        <Text variant="subheading" className="mt-0.5">
          {user?.display_name}
        </Text>
        <Text variant="muted">{user?.email}</Text>
      </Card>

      <Text variant="label" className="mb-2">
        UNITS {saving ? '· saving…' : ''}
      </Text>
      <Card className="mb-4">
        <Segmented<Units>
          options={[
            { label: 'Kilograms (kg)', value: 'kg' },
            { label: 'Pounds (lb)', value: 'lb' },
          ]}
          value={settings.units}
          onChange={(units) => patch(() => update({ units }))}
        />
      </Card>

      <Text variant="label" className="mb-2">
        TRAINING
      </Text>
      <Card className="mb-4 gap-3">
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
        <Row
          title="In-set AI prompts"
          subtitle="Show AI coaching cards between sets (preview)."
          value={settings.feature_flags.in_set_prompts}
          onValueChange={(in_set_prompts) =>
            patch(() =>
              update({
                feature_flags: { ...settings.feature_flags, in_set_prompts },
              }),
            )
          }
        />
      </Card>

      <Text variant="label" className="mb-2">
        AI PROVIDER
      </Text>
      <Card className="mb-1">
        <Segmented<AiProvider>
          options={[
            { label: 'Ollama', value: 'ollama' },
            { label: 'Claude', value: 'claude' },
            { label: 'On-device', value: 'on-device' },
          ]}
          value={settings.ai_provider}
          onChange={(ai_provider) => patch(() => update({ ai_provider }))}
        />
      </Card>
      <Text variant="caption" className="mb-4">
        AI features are not active yet - this only stores your preference.
      </Text>

      <Text variant="label" className="mb-2">
        REST TIMER
      </Text>
      <Card className="mb-6">
        <Segmented<string>
          options={[
            { label: '60s', value: '60' },
            { label: '90s', value: '90' },
            { label: '120s', value: '120' },
            { label: '180s', value: '180' },
          ]}
          value={String(settings.rest_timer_default)}
          onChange={(v) => patch(() => update({ rest_timer_default: Number(v) }))}
        />
      </Card>

      <Button title="Log out" variant="danger" onPress={() => void logout()} />
    </Screen>
  );
}
