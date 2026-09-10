import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Link, useRouter } from 'expo-router';

import { api, ApiError } from '@/api/client';
import { useAuth } from '@/state/auth';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { AuthForm } from '@/components/ui/AuthForm';
import { FormError } from '@/components/ui/Feedback';

/**
 * Forgotten password.
 *
 * Two steps on one screen: the address, then the mailed code with a new
 * password. A self-hosted server may have no mail relay at all, and then it
 * says so and names who can reset it, rather than promising an email that
 * never comes.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { loginWithToken } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState<{ delivered: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setError(null);
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    setBusy(true);
    try {
      setSent(await api.forgotPassword(email.trim().toLowerCase()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start a reset. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setError(null);
    if (!code.trim() || password.length < 6) {
      setError('Enter the code and a password of at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.resetPassword(email.trim().toLowerCase(), code.trim(), password);
      await loginWithToken(res.token, res.user);
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That reset did not go through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll={false} padded={false} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          contentContainerClassName="w-full max-w-[440px] flex-grow self-center justify-center px-6 py-8"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View className="mb-8 items-start">
            <Logo size="lg" />
            <Text variant="title" className="mt-6">
              Forgot your password?
            </Text>
            <Text variant="muted" className="mt-1">
              {sent?.delivered
                ? 'Enter the code from the email and choose a new password.'
                : 'Enter your email and we will send a code to reset it.'}
            </Text>
          </View>

          {sent && !sent.delivered ? (
            <View className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3">
              <Text variant="body" className="text-amber-200">
                {sent.message}
              </Text>
            </View>
          ) : null}

          {sent?.delivered ? (
            <AuthForm onSubmit={() => void reset()} className="gap-4">
              <Text variant="caption" className="text-iron-400">
                {sent.message}
              </Text>
              <Input
                label="Code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                placeholder="123456"
              />
              <Input
                label="New password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="At least 6 characters"
                onSubmitEditing={() => void reset()}
              />
              {error ? <FormError message={error} /> : null}
              <Button title="Set new password" size="lg" loading={busy} onPress={() => void reset()} />
            </AuthForm>
          ) : (
            <AuthForm onSubmit={() => void requestCode()} className="gap-4">
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="username"
                textContentType="username"
                keyboardType="email-address"
                placeholder="you@example.com"
                onSubmitEditing={() => void requestCode()}
              />
              {error ? <FormError message={error} /> : null}
              <Button title="Send code" size="lg" loading={busy} onPress={() => void requestCode()} />
            </AuthForm>
          )}

          <View className="mt-6 flex-row justify-center">
            <Text variant="muted">Remembered it? </Text>
            <Link href="/login">
              <Text className="text-brand font-bold">Log in</Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
