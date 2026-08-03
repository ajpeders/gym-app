import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Text } from './Text';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ModalSheetProps {
  visible: boolean;
  title: string;
  icon?: IoniconName;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  scroll?: boolean;
  scrollRef?: React.Ref<ScrollView>;
  onContentSizeChange?: () => void;
  contentClassName?: string;
}

export function ModalSheet({
  visible,
  title,
  icon,
  subtitle,
  footer,
  children,
  onClose,
  scroll = true,
  scrollRef,
  onContentSizeChange,
  contentClassName,
}: ModalSheetProps) {
  const content = `w-full max-w-[760px] self-center px-4 pt-4 ${footer ? 'pb-4' : 'pb-10'} ${
    contentClassName ?? ''
  }`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} className="flex-1 bg-iron-950">
        <View className="border-b border-iron-800">
          <View className="w-full max-w-[760px] self-center flex-row items-center justify-between px-4 py-3">
            <View className="min-w-0 flex-1 pr-3">
              <View className="flex-row items-center">
                {icon ? <Ionicons name={icon} size={18} color="#818cf8" /> : null}
                <Text variant="heading" className={icon ? 'ml-2' : undefined} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              {subtitle ? (
                <Text variant="caption" className="mt-0.5 text-iron-400" numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text className="font-bold text-brand">Close</Text>
            </Pressable>
          </View>
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
          {scroll ? (
            <ScrollView
              ref={scrollRef}
              className="flex-1"
              contentContainerClassName={content}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={onContentSizeChange}>
              {children}
            </ScrollView>
          ) : (
            <View className={`flex-1 ${content}`}>{children}</View>
          )}
          {footer}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
