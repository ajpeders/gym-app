import React from 'react';
import { Pressable, View, type ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  onPress?: () => void;
  elevated?: boolean;
  className?: string;
}

export function Card({ children, onPress, elevated = false, className, ...rest }: CardProps) {
  const base = `overflow-hidden rounded-2xl border p-4 ${
    elevated ? 'border-iron-700 bg-iron-900' : 'border-iron-800 bg-iron-900/80'
  }`;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className={`${base} active:opacity-75 ${className ?? ''}`}
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
