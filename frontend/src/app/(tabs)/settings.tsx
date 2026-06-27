import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, ApiError } from '@/api/client';
import type { AiModelsResult, AiProvider, AiProviders, Units } from '@/api/types';
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
  const [urlInput, setUrlInput] = useState(settings.ollama_url ?? '');

  const selected = settings.ai_provider;
  const isOllama = selected === 'ollama';

  // Discovered local (Ollama) models.
  const [models, setModels] = useState<AiModelsResult | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // True when the models lookup failed only because no Ollama URL is set yet
  // (a gentle setup prompt, not a red "unreachable" error).
  const [modelsNeedsUrl, setModelsNeedsUrl] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState<string | null>(null);

  // Test-connection result.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    setModelsNeedsUrl(false);
    try {
      const res = await api.aiModels();
      setModels(res);
      setOllamaUrl(res.url);
    } catch (err) {
      setModels(null);
      // A 502 mentioning setup means "no URL configured yet" — handle gently.
      const needsUrl =
        err instanceof ApiError &&
        err.status === 502 &&
        /set up|add your ollama|server url/i.test(err.message);
      setModelsNeedsUrl(needsUrl);
      setModelsError(err instanceof ApiError ? err.message : 'Failed to load models.');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    setModel(settings.ai_model ?? '');
  }, [settings.ai_model]);

  useEffect(() => {
    setUrlInput(settings.ollama_url ?? '');
  }, [settings.ollama_url]);

  async function commitOllamaUrl() {
    const trimmed = urlInput.trim();
    if (trimmed === (settings.ollama_url ?? '')) return;
    await patch(() => update({ ollama_url: trimmed }));
    // Re-resolve models/Test against the (possibly new) server.
    await loadModels();
  }

  useEffect(() => {
    if (isOllama) void loadModels();
  }, [isOllama, loadModels]);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.aiTest();
      setTestResult({
        ok: true,
        text: `${res.model} responded in ${res.latency_ms} ms`,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Test failed.';
      setTestResult({ ok: false, text: message });
    } finally {
      setTesting(false);
    }
  }

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

  const selectedInfo =
    selected === 'ollama'
      ? providers?.providers.ollama
      : selected === 'claude'
        ? providers?.providers.claude
        : undefined;
  const selectedUnconfigured = selectedInfo ? !selectedInfo.configured : false;
  const placeholderModel = selectedInfo?.model ?? 'server default';
  // A hint URL to prefill / suggest for Ollama (there is no auto-applied default).
  const suggestedUrl = providers?.suggested_ollama_url ?? '';
  const urlPlaceholder = suggestedUrl || 'http://localhost:11434';

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
        selected === 'claude' ? (
          <View className="mb-1 mt-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
            <Text className="text-sm font-medium text-red-400">
              Claude isn’t configured — set GYM_CLAUDE_API_KEY on the server.
            </Text>
          </View>
        ) : (
          <View className="mb-1 mt-1 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2">
            <Text className="text-sm font-medium text-brand">
              Enter your Ollama server URL below to get started.
            </Text>
          </View>
        )
      ) : null}

      <Text variant="caption" className="mb-2 mt-1">
        Parse sets from plain English on the active-workout screen.
      </Text>

      {isOllama ? (
        <>
        <Card className="mb-3">
          <Text className="mb-1.5 text-sm font-bold text-iron-100">Ollama server URL</Text>
          <TextInput
            value={urlInput}
            onChangeText={setUrlInput}
            onEndEditing={() => void commitOllamaUrl()}
            onBlur={() => void commitOllamaUrl()}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={urlPlaceholder}
            placeholderTextColor="#78716c"
            className="rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
          />
          {urlInput.trim() === '' ? (
            <View className="mt-1.5">
              <Text variant="caption" className="text-iron-400">
                Enter your Ollama server URL to get started.
              </Text>
              {suggestedUrl ? (
                <Pressable
                  onPress={() => setUrlInput(suggestedUrl)}
                  accessibilityRole="button"
                  className="mt-1 self-start">
                  <Text variant="caption" className="font-bold text-brand">
                    {`Try ${suggestedUrl}`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Text variant="caption" className="mt-1.5">
              Saved on blur. This is the server your coach and parsing use.
            </Text>
          )}
        </Card>
        <Card className="mb-3">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-sm font-bold text-iron-100">Local model</Text>
            {ollamaUrl ? (
              <Text variant="caption" className="text-iron-500">
                {ollamaUrl}
              </Text>
            ) : null}
          </View>

          {modelsLoading ? (
            <View className="flex-row items-center py-2">
              <ActivityIndicator color="#f97316" />
              <Text variant="muted" className="ml-2">
                Finding installed models…
              </Text>
            </View>
          ) : modelsNeedsUrl ? (
            <View className="rounded-lg border border-iron-700 bg-iron-900 px-3 py-2">
              <Text variant="caption" className="text-iron-300">
                Add your Ollama server URL above, then save to discover models.
              </Text>
            </View>
          ) : modelsError ? (
            <View className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
              <Text className="text-sm font-medium text-red-400">
                {`Can't reach your local AI${
                  ollamaUrl ? ` at ${ollamaUrl}` : ''
                } — is Ollama running?`}
              </Text>
              <Pressable onPress={() => void loadModels()} className="mt-2 self-start">
                <Text className="text-sm font-bold text-brand">Retry</Text>
              </Pressable>
            </View>
          ) : models && models.models.length > 0 ? (
            <View className="gap-1.5">
              {models.models.map((m) => {
                const activeModel = settings.ai_model ?? models.current;
                const active = m.name === activeModel;
                return (
                  <Pressable
                    key={m.name}
                    onPress={() => patch(() => update({ ai_model: m.name }))}
                    className={`flex-row items-center justify-between rounded-lg border px-3 py-2.5 ${
                      active ? 'border-brand bg-brand/10' : 'border-iron-700 bg-iron-900'
                    }`}>
                    <View className="flex-1 pr-2">
                      <Text
                        className={`text-sm font-bold ${active ? 'text-brand' : 'text-iron-100'}`}>
                        {m.name}
                        {m.size ? (
                          <Text className="font-normal text-iron-500">{` · ${m.size}`}</Text>
                        ) : null}
                      </Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={18} color="#f97316" />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text variant="muted" className="py-1">
              No models installed. Pull one with `ollama pull` on the server.
            </Text>
          )}
        </Card>
        </>
      ) : (
        <Card className="mb-3">
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
      )}

      <Card className="mb-6">
        <Pressable
          onPress={() => void runTest()}
          disabled={testing}
          className={`flex-row items-center justify-center rounded-lg border border-iron-700 bg-iron-800 px-4 py-3 active:bg-iron-700 ${
            testing ? 'opacity-60' : ''
          }`}>
          {testing ? (
            <ActivityIndicator color="#f97316" />
          ) : (
            <>
              <Ionicons name="flash-outline" size={16} color="#f97316" />
              <Text className="ml-1.5 text-base font-semibold text-iron-50">Test connection</Text>
            </>
          )}
        </Pressable>
        {testResult ? (
          <Text
            className={`mt-2 text-sm font-medium ${
              testResult.ok ? 'text-green-400' : 'text-red-400'
            }`}>
            {testResult.ok ? `✓ ${testResult.text}` : `✗ ${testResult.text}`}
          </Text>
        ) : (
          <Text variant="caption" className="mt-2">
            Runs a quick round-trip against your active provider and model.
          </Text>
        )}
      </Card>
    </>
  );
}
