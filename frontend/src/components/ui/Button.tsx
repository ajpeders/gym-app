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
    'bg-neutral-200 dark:bg-neutral-800 active:bg-neutral-300 dark:active:bg-neutral-700',
  ghost: 'bg-transparent active:bg-neutral-100 dark:active:bg-neutral-900',
  danger: 'bg-red-600 active:bg-red-700',
};

const label: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-neutral-900 dark:text-white',
  ghost: 'text-brand',
  danger: 'text-white',
};

const sizing: Record<Size, string> = {
  sm: 'px-3 py-2 rounded-lg',
  md: 'px-4 py-3 rounded-xl',
  lg: 'px-5 py-4 rounded-2xl',
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
        <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? '#3c87f7' : '#fff'} />
      ) : (
        <Text className={`font-semibold ${labelSize[size]} ${label[variant]}`}>{title}</Text>
      )}
    </Pressable>
  );
}
