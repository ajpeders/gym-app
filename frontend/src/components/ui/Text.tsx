import React from 'react';
import { Text as RNText, type TextProps } from 'react-native';

type Variant =
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'muted'
  | 'label'
  | 'caption'
  | 'eyebrow'
  | 'stat';

const variants: Record<Variant, string> = {
  title: 'text-[34px] leading-[40px] font-black tracking-normal text-iron-50',
  heading: 'text-xl leading-7 font-black tracking-normal text-iron-50',
  subheading: 'text-base leading-5 font-bold text-iron-50',
  body: 'text-base leading-6 text-iron-100',
  muted: 'text-sm leading-5 text-iron-300',
  label: 'text-sm leading-5 font-bold text-iron-100',
  caption: 'text-xs leading-4 text-iron-400',
  eyebrow: 'text-[11px] leading-4 font-black uppercase tracking-wider text-brand',
  stat: 'text-2xl leading-8 font-black text-iron-50',
};

interface AppTextProps extends TextProps {
  variant?: Variant;
  className?: string;
}

export function Text({ variant = 'body', className, ...rest }: AppTextProps) {
  return <RNText className={`${variants[variant]} ${className ?? ''}`} {...rest} />;
}
