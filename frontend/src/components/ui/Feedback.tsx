import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from './Text';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const emptyIcons: Record<string, IoniconName> = {
  PLAN: 'calendar-outline',
  LOG: 'barbell-outline',
  FIND: 'search-outline',
};

export function Loading({ label }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center py-16">
      <View className="h-14 w-14 items-center justify-center rounded-2xl border border-iron-700 bg-iron-900">
        <ActivityIndicator color="#818cf8" />
      </View>
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
      <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl border border-iron-700 bg-iron-900">
        <Ionicons name={icon ? (emptyIcons[icon] ?? 'albums-outline') : 'albums-outline'} size={24} color="#818cf8" />
      </View>
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

/** Compact inline error banner for forms (e.g. auth screens). */
export function FormError({ message }: { message: string }) {
  return (
    <View className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5">
      <Text className="text-sm font-medium text-red-400">{message}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="items-center justify-center py-16 px-6">
      <View className="mb-3 h-14 w-14 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10">
        <Ionicons name="alert" size={24} color="#f87171" />
      </View>
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
