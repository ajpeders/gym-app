import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api } from '@/api/client';
import type { AiProvider, AiProviders, Units } from '@/api/types';
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
  const router = useRouter();
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

      <Card className="mb-4" onPress={() => router.push('/profile')}>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text variant="subheading">Your profile</Text>
            <Text variant="muted" className="mt-0.5">
              Level, goals, injuries, equipment — what your coach remembers.
            </Text>
          </View>
          <Text className="text-xl text-brand">›</Text>
        </View>
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
      <AiProviderControl patch={patch} />

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

const PROVIDER_OPTIONS: { label: string; value: AiProvider; disabled?: boolean }[] = [
  { label: 'Ollama', value: 'ollama' },
  { label: 'Claude', value: 'claude' },
  { label: 'On-device', value: 'on-device', disabled: true },
];

function AiProviderControl({
  patch,
}: {
  patch: (fn: () => Promise<void>) => Promise<void>;
}) {
  const { settings, update } = useSettings();
  const [providers, setProviders] = useState<AiProviders | null>(null);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState(settings.ai_model ?? '');

  useEffect(() => {
    setModel(settings.ai_model ?? '');
  }, [settings.ai_model]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .aiProviders()
      .then((p) => {
        if (alive) setProviders(p);
      })
      .catch(() => {
        if (alive) setProviders(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = settings.ai_provider;
  const selectedInfo =
    selected === 'ollama'
      ? providers?.providers.ollama
      : selected === 'claude'
        ? providers?.providers.claude
        : undefined;
  const selectedUnconfigured = selectedInfo ? !selectedInfo.configured : false;
  const placeholderModel = selectedInfo?.model ?? 'server default';

  function commitModel() {
    const trimmed = model.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === (settings.ai_model ?? null)) return;
    void patch(() => update({ ai_model: next }));
  }

  function ProviderStatus({
    name,
    info,
  }: {
    name: string;
    info?: { configured: boolean; model: string };
  }) {
    return (
      <View className="flex-row items-center justify-between py-1">
        <View className="flex-1 pr-3">
          <Text variant="subheading">{name}</Text>
          <Text variant="caption" className="mt-0.5">
            {info ? `model: ${info.model}` : 'unavailable'}
          </Text>
        </View>
        {info ? (
          info.configured ? (
            <Text variant="caption" className="font-bold text-green-400">
              ● ready
            </Text>
          ) : (
            <Text variant="caption" className="font-bold text-iron-400">
              ○ not configured
            </Text>
          )
        ) : null}
      </View>
    );
  }

  return (
    <>
      <Card className="mb-3 gap-1">
        {loading ? (
          <View className="flex-row items-center py-1">
            <ActivityIndicator color="#f97316" />
            <Text variant="muted" className="ml-2">
              Checking providers…
            </Text>
          </View>
        ) : providers ? (
          <>
            <ProviderStatus name="Ollama" info={providers.providers.ollama} />
            <View className="h-px bg-iron-800" />
            <ProviderStatus name="Claude" info={providers.providers.claude} />
            {!providers.providers.claude.configured ? (
              <Text variant="caption" className="mt-0.5 text-iron-400">
                Claude needs GYM_CLAUDE_API_KEY set on the server.
              </Text>
            ) : null}
          </>
        ) : (
          <Text variant="muted">Couldn’t reach the AI service.</Text>
        )}
      </Card>

      <Card className="mb-1">
        <View className="flex-row rounded-lg border border-iron-700 bg-iron-950 p-1">
          {PROVIDER_OPTIONS.map((opt) => {
            const active = opt.value === selected;
            return (
              <Pressable
                key={opt.value}
                disabled={opt.disabled}
                onPress={() => patch(() => update({ ai_provider: opt.value }))}
                className={`flex-1 items-center rounded-md py-2 ${active ? 'bg-brand' : ''} ${
                  opt.disabled ? 'opacity-40' : ''
                }`}>
                <Text
                  className={`text-sm font-bold ${active ? 'text-iron-950' : 'text-iron-400'}`}>
                  {opt.label}
                </Text>
                {opt.disabled ? (
                  <Text className="text-[10px] text-iron-500">soon</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      {selectedUnconfigured ? (
        <View className="mb-1 mt-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
          <Text className="text-sm font-medium text-red-400">
            {selected === 'claude'
              ? 'Claude isn’t configured — set GYM_CLAUDE_API_KEY on the server.'
              : `${selected} isn’t configured on the server.`}
          </Text>
        </View>
      ) : null}

      <Text variant="caption" className="mb-2 mt-1">
        Parse sets from plain English on the active-workout screen.
      </Text>

      <Card className="mb-6">
        <Text className="mb-1.5 text-sm font-bold text-iron-100">Model override (optional)</Text>
        <TextInput
          value={model}
          onChangeText={setModel}
          onEndEditing={commitModel}
          onBlur={commitModel}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={placeholderModel}
          placeholderTextColor="#78716c"
          className="rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
        />
        <Text variant="caption" className="mt-1.5">
          Leave empty to use the server default for the selected provider.
        </Text>
      </Card>
    </>
  );
}
