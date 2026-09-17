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
  const contentWidth = 'w-full max-w-[760px] self-center';

  return (
    <SafeAreaView edges={edges} className={`flex-1 bg-iron-950 ${className ?? ''}`}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={`${contentWidth} ${pad} pb-24 pt-5 ${contentClassName ?? ''}`}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 ${contentWidth} ${pad}`} {...rest}>
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
    <View className={`mb-6 pb-2 pt-2 ${className ?? ''}`}>
      {eyebrow ? <Text variant="eyebrow">{eyebrow}</Text> : null}
      <View className={`${eyebrow ? 'mt-1' : ''} flex-row items-start justify-between gap-3`}>
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
        <Text variant="subheading" className="text-iron-100">
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
