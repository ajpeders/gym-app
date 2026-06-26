import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Link } from 'expo-router';

import { ApiError } from '@/api/client';
import { useAuth } from '@/state/auth';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

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
        className="flex-1 justify-center px-6">
        <View className="mb-10 items-center">
          <Text className="text-6xl mb-3">🏋️</Text>
          <Text variant="title">Welcome back</Text>
          <Text variant="muted" className="mt-1">
            Log in to your gym tracker
          </Text>
        </View>

        <View className="gap-4">
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
            onSubmitEditing={onSubmit}
          />

          {error ? <Text className="text-red-500 text-sm">{error}</Text> : null}

          <Button title="Log in" size="lg" loading={submitting} onPress={onSubmit} />
        </View>

        <View className="mt-6 flex-row justify-center">
          <Text variant="muted">No account? </Text>
          <Link href="/(auth)/register">
            <Text className="text-brand font-semibold">Sign up</Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
