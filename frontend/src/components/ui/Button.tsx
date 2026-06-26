import React from 'react';
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  className?: string;
}

const container: Record<Variant, string> = {
  primary: 'bg-brand active:bg-brand-600',
  secondary:
    'bg-iron-800 border border-iron-700 active:bg-iron-700',
  ghost: 'bg-transparent active:bg-iron-900',
  danger: 'bg-red-700 active:bg-red-800',
};

const label: Record<Variant, string> = {
  primary: 'text-iron-950',
  secondary: 'text-iron-50',
  ghost: 'text-brand',
  danger: 'text-white',
};

const sizing: Record<Size, string> = {
  sm: 'px-3 py-2 rounded-md',
  md: 'px-4 py-3 rounded-lg',
  lg: 'px-5 py-4 rounded-lg',
};

const labelSize: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      disabled={isDisabled}
      accessibilityRole="button"
      className={`flex-row items-center justify-center ${sizing[size]} ${container[variant]} ${
        isDisabled ? 'opacity-50' : ''
      } ${className ?? ''}`}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? '#f97316' : '#080706'} />
      ) : (
        <Text className={`font-semibold ${labelSize[size]} ${label[variant]}`}>{title}</Text>
      )}
    </Pressable>
  );
}
