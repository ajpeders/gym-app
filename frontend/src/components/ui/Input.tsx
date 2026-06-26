import React from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  className?: string;
  containerClassName?: string;
}

export function Input({ label, error, className, containerClassName, ...rest }: InputProps) {
  return (
    <View className={containerClassName}>
      {label ? (
        <Text className="mb-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor="#9ca3af"
        className={`rounded-xl border px-4 py-3 text-base text-neutral-900 dark:text-white bg-white dark:bg-neutral-900 ${
          error ? 'border-red-500' : 'border-neutral-300 dark:border-neutral-700'
        } ${className ?? ''}`}
        {...rest}
      />
      {error ? <Text className="mt-1 text-xs text-red-500">{error}</Text> : null}
    </View>
  );
}
