import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from './Text';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ActionRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: IoniconName;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  trailing?: React.ReactNode;
}

export function ActionRow({
  title,
  subtitle,
  meta,
  icon,
  onPress,
  disabled,
  selected,
  trailing,
}: ActionRowProps) {
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={onPress ? 'button' : undefined}
      className={`flex-row items-center rounded-xl px-3 py-3 ${
        selected ? 'bg-brand/10' : ''
      } ${onPress && !disabled ? 'active:bg-brand/10' : ''} ${disabled ? 'opacity-60' : ''}`}>
      {icon ? (
        <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl border border-iron-700 bg-iron-850">
          <Ionicons name={icon} size={17} color={selected ? '#b6d69a' : '#b0b6a8'} />
        </View>
      ) : null}
      <View className="min-w-0 flex-1">
        <Text
          variant="subheading"
          numberOfLines={1}
          className={selected ? 'text-brand' : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={1} className="mt-0.5 text-iron-400">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {meta ? (
        <Text variant="caption" className="ml-3 max-w-[46%] text-right text-iron-400" numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={16} color="#929b89" /> : null)}
    </Wrapper>
  );
}
