import React from 'react';
import { Pressable, View, type ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  onPress?: () => void;
  className?: string;
}

export function Card({ children, onPress, className, ...rest }: CardProps) {
  const base =
    'rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4';

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={`${base} active:opacity-70 ${className ?? ''}`}
        {...rest}>
        {children}
      </Pressable>
    );
  }

  return (
    <View className={`${base} ${className ?? ''}`} {...rest}>
      {children}
    </View>
  );
}
