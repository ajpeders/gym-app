import React from 'react';
import { Pressable, Text } from 'react-native';

interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  className?: string;
}

export function Chip({ label, active = false, onPress, className }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`mr-2 mb-2 rounded-full px-3 py-1.5 border ${
        active
          ? 'bg-brand border-brand'
          : 'bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700'
      } ${className ?? ''}`}>
      <Text
        className={`text-sm font-medium ${
          active ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}
