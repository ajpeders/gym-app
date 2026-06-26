import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from './Text';

export function Loading({ label }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center py-16">
      <ActivityIndicator color="#3c87f7" />
      {label ? <Text variant="muted" className="mt-3">{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
}) {
  return (
    <View className="items-center justify-center py-16 px-6">
      {icon ? <Text className="text-5xl mb-3">{icon}</Text> : null}
      <Text variant="subheading" className="text-center">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="muted" className="mt-1 text-center">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="items-center justify-center py-16 px-6">
      <Text className="text-5xl mb-3">⚠️</Text>
      <Text variant="subheading" className="text-center">
        Something went wrong
      </Text>
      <Text variant="muted" className="mt-1 text-center">
        {message}
      </Text>
      {onRetry ? (
        <Text
          variant="label"
          className="mt-4 text-brand"
          onPress={onRetry}
          accessibilityRole="button">
          Tap to retry
        </Text>
      ) : null}
    </View>
  );
}
