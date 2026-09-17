import React from 'react';
import { ActivityIndicator, Pressable, Text, View, type PressableProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: IoniconName;
  className?: string;
}

const container: Record<Variant, string> = {
  primary: 'bg-brand active:bg-brand-600',
  secondary: 'border border-iron-700 bg-iron-900/70 active:bg-iron-800',
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
  sm: 'min-h-[38px] px-3.5 py-2 rounded-xl',
  md: 'min-h-[48px] px-4 py-3 rounded-xl',
  lg: 'min-h-[54px] px-5 py-3.5 rounded-xl',
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
  icon,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const iconColor = variant === 'primary' ? '#030712' : variant === 'danger' ? '#ffffff' : '#5eead4';

  return (
    <Pressable
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      className={`flex-row items-center justify-center overflow-hidden ${sizing[size]} ${container[variant]} ${
        isDisabled ? 'opacity-50' : ''
      } ${className ?? ''}`}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? '#5eead4' : '#030712'} />
      ) : (
        <View className="flex-row items-center justify-center">
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={iconColor} /> : null}
          <Text className={`font-bold ${labelSize[size]} ${label[variant]} ${icon ? 'ml-2' : ''}`}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
