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
      className={`mr-2 mb-2 rounded-md px-3 py-1.5 border ${
        active
          ? 'bg-brand border-brand'
          : 'bg-iron-900 border-iron-700'
      } ${className ?? ''}`}>
      <Text
        className={`text-sm font-medium ${
          active ? 'text-iron-950' : 'text-iron-100'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}
