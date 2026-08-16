import React from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string;
  action?: React.ReactNode;
  containerClassName?: string;
  inputClassName?: string;
}

export function FormField({
  label,
  error,
  action,
  containerClassName,
  inputClassName,
  multiline,
  ...rest
}: FormFieldProps) {
  return (
    <View className={containerClassName}>
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text variant="caption" className="text-iron-400">
          {label}
        </Text>
        {action}
      </View>
      <TextInput
        placeholderTextColor="#64748b"
        selectionColor="#38bdf8"
        multiline={multiline}
        className={`rounded-lg border bg-iron-900 px-4 py-2.5 text-base text-iron-50 ${
          multiline ? 'min-h-[80px]' : 'min-h-[48px]'
        } ${error ? 'border-red-500' : 'border-iron-700'} ${inputClassName ?? ''}`}
        style={multiline ? { textAlignVertical: 'top' } : undefined}
        {...rest}
      />
      {error ? <Text className="mt-1 text-xs text-red-400">{error}</Text> : null}
    </View>
  );
}
