import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import { api, API_URL } from '@/api/client';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

/**
 * "Continue with…" — but only for providers this server can actually complete.
 *
 * The server owns that decision (`GET /auth/providers` lists the ones with a
 * client id configured), so an install with none shows nothing at all. A button
 * that fails on tap is worse than a login screen with one way in, and this app
 * is self-hosted: most installs will never configure any of these.
 *
 * The flow itself is the standard redirect: open the provider in a browser
 * session, come back to the app's deep link with a token, hand that to
 * `POST /auth/oauth/{provider}` which verifies it and returns our own session.
 */

const LABELS: Record<string, string> = {
  google: 'Continue with Google',
  apple: 'Continue with Apple',
  github: 'Continue with GitHub',
};

export function SocialSignIn({
  onToken,
}: {
  onToken: (provider: string, token: string) => void;
}) {
  const [providers, setProviders] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Failing quietly is right here: the password form works regardless, and
    // an error about social login on a server that has none is noise.
    void api
      .socialProviders()
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  if (providers.length === 0) return null;

  async function start(provider: string) {
    setBusy(provider);
    setError(null);
    try {
      const redirect = Linking.createURL('/oauth-callback');
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_URL}/api/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(redirect)}`,
        redirect,
      );
      if (result.type !== 'success') return; // cancelled — not an error
      const token = new URL(result.url).searchParams.get('token');
      if (!token) {
        setError('That sign-in came back without a token.');
        return;
      }
      onToken(provider, token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That sign-in did not complete.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="mt-4">
      <Text variant="caption" className="mb-2 text-center text-iron-500">
        or
      </Text>
      {providers.map((provider) => (
        <Button
          key={provider}
          title={LABELS[provider] ?? `Continue with ${provider}`}
          variant="secondary"
          className="mb-2"
          loading={busy === provider}
          onPress={() => void start(provider)}
        />
      ))}
      {error ? (
        <Text variant="caption" className="mt-1 text-center text-red-400">
          {error}
        </Text>
      ) : null}
      {Platform.OS === 'web' ? (
        <Text variant="caption" className="mt-1 text-center text-iron-500">
          Opens your provider in a new tab.
        </Text>
      ) : null}
    </View>
  );
}
