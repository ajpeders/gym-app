import React from 'react';
import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Text } from './Text';

interface ScreenProps extends ViewProps {
  /** Wrap children in a ScrollView. Default true. */
  scroll?: boolean;
  /** Add horizontal padding. Default true. */
  padded?: boolean;
  edges?: readonly Edge[];
  contentClassName?: string;
}

/**
 * App-wide screen wrapper: safe-area aware, dark-mode background,
 * optional scroll + padding.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['top', 'left', 'right'],
  contentClassName,
  className,
  ...rest
}: ScreenProps) {
  const pad = padded ? 'px-4' : '';

  return (
    <SafeAreaView edges={edges} className={`flex-1 bg-iron-950 ${className ?? ''}`}>
      <View
        pointerEvents="none"
        className="absolute inset-x-0 top-0 h-48 border-b border-iron-900 bg-iron-900/70"
      />
      <View
        pointerEvents="none"
        className="absolute -left-8 top-0 h-32 w-48 rounded-full bg-brand/12"
      />
      <View
        pointerEvents="none"
        className="absolute right-0 top-12 h-28 w-32 rounded-full bg-steel/10"
      />
      <View pointerEvents="none" className="absolute left-0 right-0 top-0 h-px bg-brand/80" />
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={`${pad} pb-28 pt-4 ${contentClassName ?? ''}`}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 ${pad}`} {...rest}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`mb-5 ${className ?? ''}`}>
      {eyebrow ? <Text variant="eyebrow">{eyebrow}</Text> : null}
      <View className="mt-1 flex-row items-end justify-between gap-3">
        <View className="flex-1">
          <Text variant="title">{title}</Text>
          {subtitle ? (
            <Text variant="muted" className="mt-1">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ? <View>{action}</View> : null}
      </View>
    </View>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={`mb-3 mt-6 flex-row items-end justify-between gap-3 ${className ?? ''}`}>
      <View className="flex-1">
        <Text variant="label" className="uppercase text-iron-200">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" className="mt-1 text-iron-400">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? <View>{action}</View> : null}
    </View>
  );
}
