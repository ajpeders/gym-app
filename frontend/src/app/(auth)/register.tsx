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

export default function RegisterScreen() {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
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
        className="w-full max-w-[440px] flex-1 self-center justify-center px-6">
        <View className="mb-10 items-start">
          <Logo size="lg" />
          <Text variant="title" className="mt-6">
            Create account
          </Text>
          <Text variant="muted" className="mt-1">
            Build the habit. Keep the record.
          </Text>
        </View>

        <AuthForm onSubmit={onSubmit} className="gap-4">
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
            // new-password is what tells a manager to *offer to generate*, and
            // to save the pair rather than trying to autofill an old one.
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="At least 6 characters"
          />
          <Input
            label="Confirm password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="Re-enter your password"
            onSubmitEditing={onSubmit}
          />

          {error ? <FormError message={error} /> : null}

          <Button title="Sign up" size="lg" loading={submitting} onPress={onSubmit} />
        </AuthForm>

        <View className="mt-6 flex-row justify-center">
          <Text variant="muted">Already have an account? </Text>
          <Link href="/login">
            <Text className="text-brand font-bold">Log in</Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
