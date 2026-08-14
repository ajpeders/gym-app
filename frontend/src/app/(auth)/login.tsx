import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Link } from 'expo-router';

import { ApiError } from '@/api/client';
import { useAuth } from '@/state/auth';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { AuthForm } from '@/components/ui/AuthForm';
import { FormError } from '@/components/ui/Feedback';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // Redirect handled by the root navigator.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll={false} padded={false} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="w-full max-w-[440px] flex-1 self-center justify-center px-6">
        <View className="mb-10 items-start">
          <Logo size="lg" />
          <Text variant="title" className="mt-6">
            Welcome back
          </Text>
          <Text variant="muted" className="mt-1">
            Pick up where you left off.
          </Text>
        </View>

        <AuthForm onSubmit={onSubmit} className="gap-4">
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="username"
            textContentType="username"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            // "password" is not a valid HTML autocomplete value, so browsers
            // ignored it outright and never offered to fill or save anything.
            autoComplete="current-password"
            textContentType="password"
            placeholder="••••••••"
            onSubmitEditing={onSubmit}
          />

          {error ? <FormError message={error} /> : null}

          <Button title="Log in" size="lg" loading={submitting} onPress={onSubmit} />
        </AuthForm>

        <View className="mt-6 flex-row justify-center">
          <Text variant="muted">No account? </Text>
          <Link href="/register">
            <Text className="text-brand font-bold">Sign up</Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
