import React from 'react';
import { View } from 'react-native';

interface BottomActionProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function BottomAction({ children, className, contentClassName }: BottomActionProps) {
  return (
    <View className={`border-t border-iron-800 bg-iron-950/95 px-4 pb-6 pt-3 ${className ?? ''}`}>
      <View className={`w-full max-w-[760px] self-center ${contentClassName ?? ''}`}>
        {children}
      </View>
    </View>
  );
}
