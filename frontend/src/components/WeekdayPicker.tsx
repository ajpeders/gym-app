import React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/Text';

// Single-letter labels for Sun→Sat (index 0..6). Sunday is 0 to match
// JS getDay() and the API's weekday vocabulary.
const LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface WeekdayPickerProps {
  /** Selected weekdays, 0=Sun..6=Sat. */
  value: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
}

/** A controlled Sun→Sat row of 7 toggle chips. */
export function WeekdayPicker({ value, onChange, disabled = false }: WeekdayPickerProps) {
  function toggle(day: number) {
    const next = value.includes(day)
      ? value.filter((d) => d !== day)
      : [...value, day];
    next.sort((a, b) => a - b);
    onChange(next);
  }

  return (
    <View className="flex-row gap-2">
      {LABELS.map((label, day) => {
        const active = value.includes(day);
        return (
          <Pressable
            key={day}
            onPress={() => toggle(day)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`h-11 flex-1 items-center justify-center rounded-full border active:opacity-75 ${
              active ? 'border-brand bg-brand' : 'border-iron-700 bg-iron-900/90'
            } ${disabled ? 'opacity-50' : ''}`}>
            <Text
              className={`text-sm font-bold ${
                active ? 'text-iron-950' : 'text-iron-100'
              }`}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
