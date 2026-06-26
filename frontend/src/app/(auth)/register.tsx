import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Link } from 'expo-router';

import { ApiError } from '@/api/client';
import { useAuth } from '@/state/auth';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function RegisterScreen() {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!displayName.trim() || !email.trim() || !password) {
      setError('Fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await register(email.trim().toLowerCase(), password, displayName.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed. Try again.');
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
          <Text className="text-6xl mb-3">💪</Text>
          <Text variant="title">Create account</Text>
          <Text variant="muted" className="mt-1">
            Start tracking your workouts
          </Text>
        </View>

        <View className="gap-4">
          <Input
            label="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Alex"
            autoCapitalize="words"
          />
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
            placeholder="At least 6 characters"
            onSubmitEditing={onSubmit}
          />

          {error ? <Text className="text-red-500 text-sm">{error}</Text> : null}

          <Button title="Sign up" size="lg" loading={submitting} onPress={onSubmit} />
        </View>

        <View className="mt-6 flex-row justify-center">
          <Text variant="muted">Already have an account? </Text>
          <Link href="/(auth)/login">
            <Text className="text-brand font-semibold">Log in</Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
