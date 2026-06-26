import React from 'react';
import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'title' | 'heading' | 'subheading' | 'body' | 'muted' | 'label' | 'caption';

const variants: Record<Variant, string> = {
  title: 'text-3xl font-bold text-neutral-900 dark:text-white',
  heading: 'text-xl font-bold text-neutral-900 dark:text-white',
  subheading: 'text-base font-semibold text-neutral-900 dark:text-white',
  body: 'text-base text-neutral-800 dark:text-neutral-100',
  muted: 'text-sm text-neutral-500 dark:text-neutral-400',
  label: 'text-sm font-semibold text-neutral-700 dark:text-neutral-300',
  caption: 'text-xs text-neutral-500 dark:text-neutral-400',
};

interface AppTextProps extends TextProps {
  variant?: Variant;
  className?: string;
}

export function Text({ variant = 'body', className, ...rest }: AppTextProps) {
  return <RNText className={`${variants[variant]} ${className ?? ''}`} {...rest} />;
}
