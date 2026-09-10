import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Exercise } from '@/api/types';
import { titleCase } from '@/lib/format';
import { Text } from '@/components/ui/Text';
import { ExerciseThumb } from '@/components/ExerciseThumb';

interface ExerciseRowProps {
  exercise: Exercise;
  onPress: () => void;
  subtitle?: string;
  trailing?: React.ReactNode;
}

export function ExerciseRow({ exercise, onPress, subtitle, trailing }: ExerciseRowProps) {
  const muscles = exercise.primary_muscles?.map(titleCase).join(', ');

  return (
    <Pressable
      onPress={onPress}
      className="mb-2 flex-row items-center gap-3 rounded-lg border border-iron-800 bg-iron-900/80 p-3 active:opacity-70">
      <ExerciseThumb images={exercise.images} size={56} radius={8} placeholder={false} />
      <View className="flex-1">
        <Text variant="subheading" numberOfLines={1}>
          {exercise.name}
        </Text>
        <Text variant="muted" numberOfLines={1}>
          {subtitle ?? muscles ?? titleCase(exercise.equipment) ?? ''}
        </Text>
      </View>
      {trailing ?? <Ionicons name="chevron-forward" size={18} color="#475569" />}
    </Pressable>
  );
}
