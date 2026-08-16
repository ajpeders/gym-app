import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from './Text';

export interface WeekCalendarItem {
  key: string;
  label: string;
  value: string;
  isToday?: boolean;
  isRest?: boolean;
  hasPhoto?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
}

interface WeekCalendarProps {
  monthLabel?: string;
  items: WeekCalendarItem[];
  trainLabel?: string;
  restLabel?: string;
}

export function WeekCalendar({
  monthLabel,
  items,
  trainLabel = 'Train',
  restLabel = 'Rest',
}: WeekCalendarProps) {
  return (
    <View>
      {monthLabel ? (
        <View className="mb-3 flex-row items-center justify-between px-1">
          <Text variant="subheading">{monthLabel}</Text>
          <View className="flex-row items-center gap-3">
            <View className="flex-row items-center">
              <View className="mr-1.5 h-2 w-2 rounded-full bg-brand" />
              <Text variant="caption" className="text-iron-400">
                {trainLabel}
              </Text>
            </View>
            <View className="flex-row items-center">
              <View className="mr-1.5 h-2 w-2 rounded-full bg-iron-700" />
              <Text variant="caption" className="text-iron-400">
                {restLabel}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
      <View className="flex-row gap-1">
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole={item.onPress ? 'button' : undefined}
            accessibilityLabel={item.accessibilityLabel}
            disabled={item.disabled || !item.onPress}
            onPress={item.onPress}
            className={`min-w-0 flex-1 items-center rounded-lg border px-0.5 py-2.5 ${
              item.isToday ? 'border-brand/50 bg-brand/10' : 'border-transparent'
            } ${item.onPress && !item.disabled ? 'active:bg-brand/15' : ''}`}>
            <Text
              variant="caption"
              className={`font-bold ${item.isToday ? 'text-brand' : 'text-iron-400'}`}>
              {item.label}
            </Text>
            <Text
              variant="subheading"
              numberOfLines={1}
              className={`mt-1 ${item.isToday ? 'text-brand' : 'text-iron-100'}`}>
              {item.value}
            </Text>
            {item.hasPhoto ? (
              <Ionicons name="camera" size={11} color="#34d399" style={{ marginTop: 6 }} />
            ) : (
              <View
                className={`mt-2 h-2 w-2 rounded-full ${
                  item.isRest ? 'bg-iron-700' : 'bg-brand'
                }`}
              />
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
