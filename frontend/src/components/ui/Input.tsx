import React, { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  className?: string;
  containerClassName?: string;
}

export function Input({
  label,
  error,
  className,
  containerClassName,
  secureTextEntry,
  ...rest
}: InputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <View className={containerClassName}>
      {label ? (
        <Text className="mb-1.5 text-sm font-bold text-iron-100">
          {label}
        </Text>
      ) : null}
      <View className="relative">
        <TextInput
          placeholderTextColor="#929b89"
          selectionColor="#b6d69a"
          secureTextEntry={secureTextEntry && !revealed}
          className={`min-h-[50px] w-full rounded-xl border bg-iron-900 px-4 py-3 text-base text-iron-50 ${
            secureTextEntry ? 'pr-12' : ''
          } ${error ? 'border-red-500' : 'border-iron-700'} ${className ?? ''}`}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            className="absolute bottom-0 right-3 top-0 w-8 items-center justify-center active:opacity-60">
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#b0b6a8"
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text className="mt-1 text-xs text-red-500">{error}</Text> : null}
    </View>
  );
}
