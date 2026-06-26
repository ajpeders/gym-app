import React from 'react';
import { ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

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
    <SafeAreaView edges={edges} className="flex-1 bg-iron-950">
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={`${pad} pb-24 pt-2 ${contentClassName ?? ''}`}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 ${pad} ${className ?? ''}`} {...rest}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}
