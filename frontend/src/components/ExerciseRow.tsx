import React from 'react';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import type { Exercise } from '@/api/types';
import { titleCase } from '@/lib/format';
import { Text } from '@/components/ui/Text';

interface ExerciseRowProps {
  exercise: Exercise;
  onPress: () => void;
  subtitle?: string;
  trailing?: React.ReactNode;
}

export function ExerciseRow({ exercise, onPress, subtitle, trailing }: ExerciseRowProps) {
  const thumb = exercise.images?.[0];
  const muscles = exercise.primary_muscles?.map(titleCase).join(', ');

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 py-2.5 active:opacity-60">
      <View className="h-14 w-14 overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-800 items-center justify-center">
        {thumb ? (
          <Image source={{ uri: thumb }} style={{ width: 56, height: 56 }} contentFit="cover" />
        ) : (
          <Text className="text-2xl">🏋️</Text>
        )}
      </View>
      <View className="flex-1">
        <Text variant="subheading" numberOfLines={1}>
          {exercise.name}
        </Text>
        <Text variant="muted" numberOfLines={1}>
          {subtitle ?? muscles ?? titleCase(exercise.equipment) ?? ''}
        </Text>
      </View>
      {trailing}
    </Pressable>
  );
}
