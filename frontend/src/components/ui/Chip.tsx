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
      className={`mr-2 mb-2 rounded-full border px-3.5 py-2 active:opacity-75 ${
        active
          ? 'border-brand bg-brand'
          : 'border-iron-700 bg-iron-900/90'
      } ${className ?? ''}`}>
      <Text
        className={`text-sm font-bold ${
          active ? 'text-iron-950' : 'text-iron-100'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}
