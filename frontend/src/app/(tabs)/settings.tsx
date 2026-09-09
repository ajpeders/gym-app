import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api, ApiError } from '@/api/client';
import type { AiModelCheckResult, AiModelsResult, AiProvider, AiProviders, Units } from '@/api/types';
import { useAuth } from '@/state/auth';
import { useSettings } from '@/state/settings';
import { Screen, ScreenHeader, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { shareText } from '@/lib/export';
import { modelSupportsTools } from '@/lib/ai-errors';
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
  const { user, logout } = useAuth();
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
        subtitle="Tune units, workout behavior, and your AI provider from one place."
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
            Goals, injuries, equipment, and everything your coach remembers.
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

      <SectionHeader
        title="AI setup"
        subtitle="Choose the provider used for imports, text logging, and Spotter."
      />
      <AiProviderControl patch={patch} />

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

      <Button title="Log out" variant="danger" onPress={() => void logout()} />

      <Text variant="caption" className="mt-6 text-center text-iron-500">
        Exercise data from wger.de (CC-BY-SA 4.0) and free-exercise-db (public
        domain).
      </Text>
    </Screen>
  );
}

type ConfigurableAiProvider = Exclude<AiProvider, 'on-device'>;

const PROVIDER_OPTIONS: { label: string; value: ConfigurableAiProvider }[] = [
  { label: 'Ollama', value: 'ollama' },
  { label: 'Claude', value: 'claude' },
  { label: 'ChatGPT', value: 'openai' },
];

function AiProviderControl({
  patch,
}: {
  patch: (fn: () => Promise<void>) => Promise<void>;
}) {
  const { settings, update } = useSettings();
  const [providers, setProviders] = useState<AiProviders | null>(null);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState('');
  const [urlInput, setUrlInput] = useState(settings.ollama_url ?? '');
  // Guards for the Ollama URL field so it commits at most once per edit
  // (onEndEditing + onBlur both fire) and never double-saves.
  const committedUrlRef = useRef(settings.ollama_url ?? '');
  const savingUrlRef = useRef(false);

  const selected = settings.ai_provider;
  const isOllama = selected === 'ollama';
  const isClaude = selected === 'claude';
  const isOpenAI = selected === 'openai';
  const isCloud = isClaude || isOpenAI;

  // Discovered local (Ollama) models.
  const [models, setModels] = useState<AiModelsResult | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // True when the models lookup failed only because no Ollama URL is set yet
  // (a gentle setup prompt, not a red "unreachable" error).
  const [modelsNeedsUrl, setModelsNeedsUrl] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState<string | null>(null);

  // Active model capability probe.
  const [checkingModel, setCheckingModel] = useState(false);
  const [modelCheck, setModelCheck] = useState<AiModelCheckResult | null>(null);
  const [modelCheckError, setModelCheckError] = useState<string | null>(null);

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
    setModel(isOpenAI ? settings.openai_model ?? '' : settings.claude_model ?? '');
  }, [isOpenAI, settings.claude_model, settings.openai_model]);

  useEffect(() => {
    setUrlInput(settings.ollama_url ?? '');
    committedUrlRef.current = settings.ollama_url ?? '';
  }, [settings.ollama_url]);

  // Provider/model switches must not show a stale probe result.
  useEffect(() => {
    setModelCheck(null);
    setModelCheckError(null);
  }, [selected, settings.ollama_model, settings.claude_model, settings.openai_model]);

  async function commitOllamaUrl() {
    const trimmed = urlInput.trim();
    // Skip if a save is already in flight or the value hasn't changed since the
    // last commit — onEndEditing + onBlur both fire, so this must be idempotent.
    if (savingUrlRef.current) return;
    if (trimmed === committedUrlRef.current) return;
    savingUrlRef.current = true;
    committedUrlRef.current = trimmed;
    try {
      await patch(() => update({ ollama_url: trimmed }));
      // Re-resolve models/Test against the (possibly new) server.
      await loadModels();
    } finally {
      savingUrlRef.current = false;
    }
  }

  useEffect(() => {
    if (!isOllama) return;
    // Nothing to probe until a server URL is saved — asking anyway logged a
    // 502 every time Settings opened on a fresh account.
    if (!settings.ollama_url) {
      setModels(null);
      setModelsError(null);
      setModelsNeedsUrl(true);
      return;
    }
    void loadModels();
  }, [isOllama, settings.ollama_url, loadModels]);

  async function runModelCheck() {
    setCheckingModel(true);
    setModelCheck(null);
    setModelCheckError(null);
    try {
      setModelCheck(await api.aiCheckModel());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Test failed.';
      setModelCheckError(message);
    } finally {
      setCheckingModel(false);
    }
  }

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.aiProviders();
      setProviders(p);
    } catch {
      setProviders(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  // ---- Cloud API key (per-user, write-only) ----
  // Optional all the way down: an API older than a provider simply omits it,
  // and a missing key must read as "not configured" rather than white-screening
  // the only place the provider can be configured from.
  const claudeConfigured = providers?.providers.claude?.configured ?? false;
  const openaiConfigured = providers?.providers.openai?.configured ?? false;
  const cloudConfigured = isOpenAI ? openaiConfigured : claudeConfigured;
  const cloudLabel = isOpenAI ? 'ChatGPT / OpenAI' : 'Claude';
  const cloudKeyName = isOpenAI ? 'OpenAI API key' : 'Claude API key';
  const cloudKeyPlaceholder = isOpenAI ? 'sk-proj-…' : 'sk-ant-…';
  const cloudKeyHelp = isOpenAI
    ? 'Paste your OpenAI API key. This uses the OpenAI API, not your ChatGPT login.'
    : 'Paste your Anthropic API key (sk-ant-…)';
  const cloudKeyWhere = isOpenAI ? 'Get one at platform.openai.com' : 'Get one at console.anthropic.com';
  const [keyInput, setKeyInput] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyReplacing, setKeyReplacing] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  async function saveCloudKey() {
    const trimmed = keyInput.trim();
    if (trimmed === '') return; // empty Save is a no-op; use Remove to clear.
    setKeySaving(true);
    setKeyError(null);
    try {
      await update(isOpenAI ? { openai_api_key: trimmed } : { claude_api_key: trimmed });
      setKeyInput('');
      setKeyReplacing(false);
      // Re-fetch so `configured` flips and gates (Coach/Home) update.
      await loadProviders();
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : 'Failed to save key.');
    } finally {
      setKeySaving(false);
    }
  }

  async function removeCloudKey() {
    setKeySaving(true);
    setKeyError(null);
    try {
      await update(isOpenAI ? { openai_api_key: '' } : { claude_api_key: '' });
      setKeyInput('');
      setKeyReplacing(false);
      await loadProviders();
    } catch (err) {
      setKeyError(err instanceof ApiError ? err.message : 'Failed to remove key.');
    } finally {
      setKeySaving(false);
    }
  }

  const selectedInfo =
    selected === 'ollama'
      ? providers?.providers.ollama
      : selected === 'claude'
        ? providers?.providers.claude
        : selected === 'openai'
          ? providers?.providers.openai
          : undefined;
  const selectedUnconfigured = selectedInfo ? !selectedInfo.configured : false;
  const placeholderModel = selectedInfo?.model ?? 'server default';
  // A hint URL to prefill / suggest for Ollama (there is no auto-applied default).
  const suggestedUrl = providers?.suggested_ollama_url ?? '';
  const urlPlaceholder = suggestedUrl || 'http://localhost:11434';

  function commitModel() {
    const trimmed = model.trim();
    const next = trimmed === '' ? null : trimmed;
    if (isOpenAI) {
      if (next === (settings.openai_model ?? null)) return;
      void patch(() => update({ openai_model: next }));
      return;
    }
    if (next === (settings.claude_model ?? null)) return;
    void patch(() => update({ claude_model: next }));
  }

  return (
    <>
      <Card className="mb-3">
        <View className="flex-row rounded-xl border border-iron-700 bg-iron-950 p-1">
          {PROVIDER_OPTIONS.map((opt) => {
            const active = opt.value === selected;
            const info = providers?.providers[opt.value];
            return (
              <Pressable
                key={opt.value}
                onPress={() => patch(() => update({ ai_provider: opt.value }))}
                className={`flex-1 items-center rounded-lg py-2.5 ${active ? 'bg-brand' : ''}`}>
                <Text
                  className={`text-sm font-bold ${active ? 'text-iron-950' : 'text-iron-400'}`}>
                  {opt.label}
                </Text>
                {!loading && info ? (
                  <View className="mt-1 flex-row items-center">
                    <View
                      className={`mr-1 h-1.5 w-1.5 rounded-full ${
                        info.configured
                          ? active
                            ? 'bg-iron-950'
                            : 'bg-green-400'
                          : active
                            ? 'bg-iron-700'
                            : 'bg-iron-600'
                      }`}
                    />
                    <Text
                      className={`text-[10px] font-semibold ${
                        active ? 'text-iron-800' : 'text-iron-500'
                      }`}>
                      {info.configured ? 'Ready' : 'Set up'}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <View className="mt-3 flex-row items-center">
          {loading ? (
            <ActivityIndicator size="small" color="#5eead4" />
          ) : (
            <Ionicons
              name={selectedInfo?.configured ? 'checkmark-circle' : 'alert-circle-outline'}
              size={17}
              color={selectedInfo?.configured ? '#22c55e' : '#94a3b8'}
            />
          )}
          <Text variant="caption" className="ml-2 flex-1 text-iron-300">
            {loading
              ? 'Checking the selected provider…'
              : selectedInfo
                ? `${selectedInfo.configured ? 'Ready' : 'Not set up'} · ${selectedInfo.model}`
                : 'Provider status unavailable'}
          </Text>
        </View>
      </Card>

      {selectedUnconfigured ? (
        selected === 'claude' ? (
          <View className="mb-1 mt-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
            <Text className="text-sm font-medium text-red-400">
              Claude isn’t set up yet — add your API key below.
            </Text>
          </View>
        ) : selected === 'openai' ? (
          <View className="mb-1 mt-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
            <Text className="text-sm font-medium text-red-400">
              ChatGPT isn’t set up yet — add your OpenAI API key below.
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

      {isOpenAI ? (
        <Card className="mb-3 border-brand/20 bg-brand/5">
          <View className="flex-row items-start">
            <View className="mr-3 h-10 w-10 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10">
              <Ionicons name="sparkles" size={18} color="#5eead4" />
            </View>
            <View className="flex-1">
              <Text variant="subheading">ChatGPT uses the OpenAI API</Text>
              <Text variant="caption" className="mt-1 text-iron-300">
                Paste an OpenAI platform API key below. The app stores it on the
                server, never returns it in Settings, and uses it only for your
                account’s AI requests.
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

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
            placeholderTextColor="#64748b"
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
              <ActivityIndicator color="#5eead4" />
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
                const activeModel =
                  settings.ollama_model ?? providers?.providers.ollama.model ?? models.current;
                const active = m.name === activeModel;
                return (
                  <Pressable
                    key={m.name}
                    onPress={() => patch(() => update({ ollama_model: m.name }))}
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
                      {/* Say it here, not after the coach fails with a bare
                          "ollama returned HTTP 400" that names nothing. */}
                      {!modelSupportsTools(m.name) ? (
                        <Text variant="caption" className="mt-0.5 text-amber-400">
                          No tool calling — parsing only, the coach won't work
                        </Text>
                      ) : null}
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={18} color="#5eead4" />
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
        <>
        {isCloud ? (
          <Card className="mb-3">
            <Text className="mb-1.5 text-sm font-bold text-iron-100">{cloudKeyName}</Text>
            {cloudConfigured && !keyReplacing ? (
              <>
                <Text className="text-sm font-bold text-brand">✓ API key saved</Text>
                <Text variant="caption" className="mt-1 text-iron-400">
                  Stored securely on the server — it can’t be displayed again.
                </Text>
                <View className="mt-2.5 flex-row items-center gap-5">
                  <Pressable
                    onPress={() => {
                      setKeyError(null);
                      setKeyReplacing(true);
                    }}
                    disabled={keySaving}>
                    <Text className="text-sm font-bold text-brand">Replace key</Text>
                  </Pressable>
                  <Pressable onPress={() => void removeCloudKey()} disabled={keySaving}>
                    <Text className="text-sm font-bold text-red-400">Remove</Text>
                  </Pressable>
                </View>
                {keyError ? (
                  <Text className="mt-2 text-sm font-medium text-red-400">{keyError}</Text>
                ) : null}
              </>
            ) : (
              <>
                <TextInput
                  value={keyInput}
                  onChangeText={setKeyInput}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={cloudKeyPlaceholder}
                  placeholderTextColor="#64748b"
                  className="rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
                />
                <Text variant="caption" className="mt-1.5 text-iron-400">
                  {cloudKeyHelp}
                </Text>
                <Text variant="caption" className="mt-0.5 text-iron-500">
                  {cloudKeyWhere}
                </Text>
                <View className="mt-2.5 flex-row items-center gap-3">
                  <Button
                    title="Save"
                    size="sm"
                    loading={keySaving}
                    disabled={keyInput.trim() === ''}
                    onPress={() => void saveCloudKey()}
                  />
                  {cloudConfigured ? (
                    <Pressable
                      onPress={() => {
                        setKeyInput('');
                        setKeyError(null);
                        setKeyReplacing(false);
                      }}
                      disabled={keySaving}>
                      <Text className="text-sm font-bold text-iron-400">Cancel</Text>
                    </Pressable>
                  ) : null}
                </View>
                {keyError ? (
                  <Text className="mt-2 text-sm font-medium text-red-400">{keyError}</Text>
                ) : null}
              </>
            )}
          </Card>
        ) : null}
        <Card className="mb-3">
          <Text className="mb-1.5 text-sm font-bold text-iron-100">
            {cloudLabel} model override (optional)
          </Text>
          <TextInput
            value={model}
            onChangeText={setModel}
            onEndEditing={commitModel}
            onBlur={commitModel}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={placeholderModel}
            placeholderTextColor="#64748b"
            className="rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
          />
          <Text variant="caption" className="mt-1.5">
            Leave empty to use the server default for the selected provider.
          </Text>
        </Card>
        </>
      )}

      <Card className="mb-6">
        <Pressable
          onPress={() => void runModelCheck()}
          disabled={checkingModel}
          className={`flex-row items-center justify-center rounded-lg border border-iron-700 bg-iron-800 px-4 py-3 active:bg-iron-700 ${
            checkingModel ? 'opacity-60' : ''
          }`}>
          {checkingModel ? (
            <ActivityIndicator color="#5eead4" />
          ) : (
            <>
              <Ionicons name="flash-outline" size={16} color="#5eead4" />
              <Text className="ml-1.5 text-base font-semibold text-iron-50">Check this model</Text>
            </>
          )}
        </Pressable>
        {modelCheck ? (
          <View className="mt-3 rounded-lg border border-iron-800 bg-iron-950 p-3">
            <Text
              className={`text-sm font-black ${
                modelCheck.verdict === 'recommended'
                  ? 'text-green-400'
                  : modelCheck.verdict === 'parsing_only'
                    ? 'text-amber-400'
                    : 'text-red-400'
              }`}>
              {modelCheck.verdict === 'recommended'
                ? 'Recommended'
                : modelCheck.verdict === 'parsing_only'
                  ? 'Parsing only'
                  : 'Not suitable'}
            </Text>
            <Text variant="caption" className="mt-1 text-iron-300">
              {modelCheck.model} · {modelCheck.latency_ms} ms · {modelCheck.summary}
            </Text>
            <View className="mt-2 gap-1.5">
              {modelCheck.checks.map((check) => (
                <View key={check.key} className="flex-row items-start">
                  <Ionicons
                    name={check.passed ? 'checkmark-circle' : 'alert-circle-outline'}
                    size={15}
                    color={check.passed ? '#22c55e' : '#f59e0b'}
                    style={{ marginTop: 1 }}
                  />
                  <View className="ml-2 flex-1">
                    <Text variant="caption" className="font-bold text-iron-100">
                      {check.label}
                    </Text>
                    <Text variant="caption" className="text-iron-400">
                      {check.detail}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : modelCheckError ? (
          <Text className="mt-2 text-sm font-medium text-red-400">✗ {modelCheckError}</Text>
        ) : (
          <Text variant="caption" className="mt-2">
            Runs a safe fake-tool probe against the active provider. It does not write your data.
          </Text>
        )}
      </Card>
    </>
  );
}
