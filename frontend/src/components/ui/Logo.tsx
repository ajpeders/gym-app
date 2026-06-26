import { View } from 'react-native';

import { Text } from './Text';

type Size = 'md' | 'lg';

const box: Record<Size, string> = {
  md: 'h-16 w-16 rounded-lg',
  lg: 'h-20 w-20 rounded-xl',
};

const mark: Record<Size, string> = {
  md: 'text-3xl',
  lg: 'text-4xl',
};

/** App brand mark — the boxed "GYM" lockup used on auth and splash screens. */
export function Logo({ size = 'md' }: { size?: Size }) {
  return (
    <View
      className={`items-center justify-center border-2 border-brand bg-iron-900 ${box[size]}`}>
      <Text className={`font-black text-brand ${mark[size]}`}>GYM</Text>
    </View>
  );
}
