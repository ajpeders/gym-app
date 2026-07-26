import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from './Text';

type Size = 'md' | 'lg';

const box: Record<Size, string> = {
  md: 'h-12 w-12 rounded-xl',
  lg: 'h-14 w-14 rounded-2xl',
};

const icon: Record<Size, number> = {
  md: 23,
  lg: 27,
};

/** Compact training mark used on auth and splash screens. */
export function Logo({ size = 'md' }: { size?: Size }) {
  return (
    <View className="flex-row items-center">
      <View className={`items-center justify-center bg-brand ${box[size]}`}>
        <Ionicons name="barbell" size={icon[size]} color="#070b12" />
      </View>
      <View className="ml-3">
        <Text
          className={`${
            size === 'lg' ? 'text-2xl' : 'text-xl'
          } font-black tracking-[-0.5px] text-iron-50`}>
          GYM
        </Text>
        <Text variant="eyebrow" className="text-iron-400">
          Training log
        </Text>
      </View>
    </View>
  );
}
