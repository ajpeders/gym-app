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
        <Text className="mb-1.5 text-sm font-bold text-iron-100">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor="#78716c"
        selectionColor="#f97316"
        className={`min-h-[48px] rounded-lg border bg-iron-900 px-4 py-3 text-base text-iron-50 ${
          error ? 'border-red-500' : 'border-iron-700'
        } ${className ?? ''}`}
        {...rest}
      />
      {error ? <Text className="mt-1 text-xs text-red-500">{error}</Text> : null}
    </View>
  );
}
