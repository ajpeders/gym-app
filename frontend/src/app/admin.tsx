import { useCallback, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import type { AdminOverview, AdminUser, AiHealth, ClientErrorReport } from '@/api/types';
import { useAuth } from '@/state/auth';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loading, ErrorState, EmptyState } from '@/components/ui/Feedback';
import { confirm } from '@/lib/confirm';
import { relativeTime } from '@/lib/format';

/**
 * The operator's view.
 *
 * Deliberately narrow: this is the first screen in the app that shows one
 * account anything about another, so it shows how much someone trains and when
 * they last did — never what they lifted. The server enforces that; this just
 * doesn't ask for more.
 */

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <View className="min-w-[86px] flex-1 rounded-lg border border-iron-800 bg-iron-950 px-3 py-2">
      <Text variant="heading" className={tone === 'warn' && value > 0 ? 'text-amber-300' : ''}>
        {value}
      </Text>
      <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function AdminScreen() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [errors, setErrors] = useState<ClientErrorReport[]>([]);
  const [ai, setAi] = useState<AiHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      const [o, u, e, a] = await Promise.all([
        api.adminOverview(),
        api.adminUsers(),
        api.adminErrors(),
        api.adminAiHealth(),
      ]);
      setOverview(o);
      setUsers(u);
      setErrors(e);
      setAi(a);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not load the admin view');
    } finally {
      setLoading(false);
    }
  }, []);

  const admin = user?.is_admin === true;
  useFocusEffect(
    useCallback(() => {
      if (admin) void fetchAll();
    }, [admin, fetchAll]),
  );

  async function resetPassword(target: AdminUser) {
    if (!newPassword.trim()) return;
    try {
      await api.adminResetPassword(target.id, newPassword.trim());
      setNotice(`Password reset for ${target.email}`);
      setResetting(null);
      setNewPassword('');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not reset that password');
    }
  }

  function removeUser(target: AdminUser) {
    confirm(
      `Delete ${target.email}?`,
      'Their splits, sessions, photos and everything else go with the account. This cannot be undone.',
      () => {
        void (async () => {
          try {
            await api.adminDeleteUser(target.id);
            setNotice(`Deleted ${target.email}`);
            await fetchAll();
          } catch (err) {
            setProblem(err instanceof Error ? err.message : 'Could not delete that account');
          }
        })();
      },
    );
  }

  // The server is the gate; this is so a non-admin who reaches the URL gets an
  // explanation rather than four failed requests.
  if (user && user.is_admin === false) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Admin' }} />
        <EmptyState title="Admin only" subtitle="This area is for the person who runs this server." />
      </Screen>
    );
  }

  if (loading && !overview) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Admin' }} />
        <Loading />
      </Screen>
    );
  }

  if (problem && !overview) {
    return (
      <Screen scroll={false} padded={false}>
        <Stack.Screen options={{ headerShown: true, title: 'Admin' }} />
        <ErrorState message={problem} onRetry={fetchAll} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Admin' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        {notice ? (
          <Card className="mb-3 border-brand/30 bg-brand/5">
            <Text variant="caption" className="text-brand">
              {notice}
            </Text>
          </Card>
        ) : null}
        {problem ? <Text className="mb-3 text-sm text-red-400">{problem}</Text> : null}

        {overview ? (
          <Card className="mb-4">
            <Text variant="heading" className="mb-3">
              This install
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Stat label="Accounts" value={overview.users} />
              <Stat label="Sessions" value={overview.sessions} />
              <Stat label="Exercises" value={overview.exercises} />
            </View>
            <View className="mt-2 flex-row flex-wrap gap-2">
              <Stat label="Custom" value={overview.custom_exercises} />
              <Stat label="No image" value={overview.exercises_without_images} tone="warn" />
              <Stat label="Crashes 7d" value={overview.client_errors_7d} tone="warn" />
            </View>
            <View className="mt-2 flex-row flex-wrap gap-2">
              <Stat label="AI calls 7d" value={overview.ai_calls_7d} />
              <Stat label="AI failures 7d" value={overview.ai_failures_7d} tone="warn" />
            </View>
          </Card>
        ) : null}

        <Card className="mb-4">
          <Text variant="heading">Accounts</Text>
          <Text variant="muted" className="mb-3 mt-0.5">
            How much someone trains and when they last did — never what they lifted.
          </Text>
          {users.map((row) => (
            <View key={row.id} className="mb-3 border-b border-iron-800 pb-3 last:mb-0 last:border-0 last:pb-0">
              <View className="flex-row items-center">
                <View className="min-w-0 flex-1">
                  <Text variant="label" numberOfLines={1}>
                    {row.display_name || row.email}
                    {row.role === 'admin' ? ' · admin' : ''}
                  </Text>
                  <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={1}>
                    {row.email}
                  </Text>
                  <Text variant="caption" className="mt-0.5 text-iron-500">
                    {row.session_count} sessions
                    {row.last_session_at ? ` · last ${relativeTime(row.last_session_at)}` : ''}
                  </Text>
                </View>
              </View>
              <View className="mt-2 flex-row gap-2">
                <Button
                  title="Reset password"
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onPress={() => {
                    setResetting(resetting === row.id ? null : row.id);
                    setNewPassword('');
                  }}
                />
                <Button
                  title="Delete"
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  onPress={() => removeUser(row)}
                />
              </View>
              {resetting === row.id ? (
                <View className="mt-2 flex-row items-center gap-2">
                  <TextInput
                    value={newPassword}
                    onChangeText={setNewPassword}
                    accessibilityLabel={`New password for ${row.email}`}
                    placeholder="New password"
                    placeholderTextColor="#929b89"
                    className="flex-1 rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-base text-iron-100"
                  />
                  <Button title="Save" size="sm" onPress={() => void resetPassword(row)} />
                </View>
              ) : null}
            </View>
          ))}
        </Card>

        <Card className="mb-4">
          <Text variant="heading">AI health</Text>
          <Text variant="muted" className="mb-3 mt-0.5">
            Every call to a provider, with what came back. One provider failing every
            call, instantly, is what a model without tool support looks like.
          </Text>
          {ai && ai.providers.length > 0 ? (
            ai.providers.map((p) => (
              <View key={p.provider} className="mb-2 flex-row items-center justify-between">
                <Text variant="label">{p.provider}</Text>
                <Text
                  variant="caption"
                  className={p.failures > 0 ? 'text-amber-300' : 'text-iron-400'}>
                  {p.calls} calls · {p.failures} failed · {p.avg_latency_ms}ms avg
                </Text>
              </View>
            ))
          ) : (
            <Text variant="muted">No AI calls recorded yet.</Text>
          )}
          {ai?.recent.slice(0, 8).map((call) => (
            <View key={call.id} className="mt-2 rounded-lg border border-iron-800 bg-iron-950/60 p-2">
              <View className="flex-row items-center">
                <Ionicons
                  name={call.ok ? 'checkmark-circle' : 'alert-circle'}
                  size={13}
                  color={call.ok ? '#b6d69a' : '#fbbf24'}
                />
                <Text variant="caption" className="ml-1.5 flex-1 text-iron-300" numberOfLines={1}>
                  {call.endpoint} · {call.provider}
                  {call.model ? ` (${call.model})` : ''} · {call.latency_ms ?? '-'}ms
                </Text>
              </View>
              {call.error ? (
                <Text variant="caption" className="mt-0.5 text-amber-300" numberOfLines={2}>
                  {call.error}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>

        <Card className="mb-4">
          <Text variant="heading">Crash reports</Text>
          <Text variant="muted" className="mb-3 mt-0.5">
            What the app caught and sent home. Reading these used to need shell access.
          </Text>
          {errors.length === 0 ? (
            <Text variant="muted">Nothing reported.</Text>
          ) : (
            errors.slice(0, 20).map((report) => (
              <View key={report.id} className="mb-2 rounded-lg border border-iron-800 bg-iron-950/60 p-2">
                <Text variant="label" numberOfLines={2}>
                  {report.message}
                </Text>
                <Text variant="caption" className="mt-0.5 text-iron-500" numberOfLines={1}>
                  {relativeTime(report.created_at)}
                  {report.platform ? ` · ${report.platform}` : ''}
                  {report.context ? ` · ${report.context}` : ''}
                  {report.user_id ? ` · user ${report.user_id}` : ' · signed out'}
                </Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
