import React from 'react';
import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'title' | 'heading' | 'subheading' | 'body' | 'muted' | 'label' | 'caption';

const variants: Record<Variant, string> = {
  title: 'text-3xl font-black text-iron-50',
  heading: 'text-xl font-black text-iron-50',
  subheading: 'text-base font-bold text-iron-50',
  body: 'text-base text-iron-100',
  muted: 'text-sm text-iron-300',
  label: 'text-sm font-bold text-iron-100',
  caption: 'text-xs text-iron-400',
};

interface AppTextProps extends TextProps {
  variant?: Variant;
  className?: string;
}

export function Text({ variant = 'body', className, ...rest }: AppTextProps) {
  return <RNText className={`${variants[variant]} ${className ?? ''}`} {...rest} />;
}
