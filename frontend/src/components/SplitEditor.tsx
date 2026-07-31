import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import type { Split, SplitInput } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

interface Props {
  visible: boolean;
  split: Split;
  saving?: boolean;
  onSave: (input: SplitInput) => void;
  onClose: () => void;
}

const INPUT_CLASS =
  'rounded-lg border border-iron-700 bg-iron-900 px-4 py-2.5 text-base text-iron-50';

/** Hand-editing for a split's own fields: name, notes, and progression rules.
 * The days inside it stay editable on their own screens. */
export function SplitEditor({ visible, split, saving = false, onSave, onClose }: Props) {
  const [name, setName] = useState(split.name);
  const [notes, setNotes] = useState(split.notes ?? '');
  const [rules, setRules] = useState<string[]>(split.rules);

  // Re-seed from the saved split each time the sheet opens so a cancelled edit
  // never leaks into the next one.
  useEffect(() => {
    if (visible) {
      setName(split.name);
      setNotes(split.notes ?? '');
      setRules(split.rules);
    }
  }, [visible, split]);

  const trimmedName = name.trim();

  function save() {
    onSave({
      name: trimmedName,
      notes: notes.trim() ? notes.trim() : null,
      rules: rules.map((r) => r.trim()).filter(Boolean),
    });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-iron-950">
        <View className="flex-row items-center justify-between border-b border-iron-800 px-4 py-3">
          <Text variant="heading">Edit split</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text className="font-bold text-brand">Close</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
          <ScrollView
            className="flex-1"
            contentContainerClassName="px-4 pt-4 pb-6"
            keyboardShouldPersistTaps="handled">
            <Text variant="caption" className="mb-1.5 text-iron-400">
              Name
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Push / Pull / Legs"
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
              className={INPUT_CLASS}
            />

            <Text variant="caption" className="mb-1.5 mt-5 text-iron-400">
              Notes
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything to remember about this split"
              placeholderTextColor="#64748b"
              selectionColor="#5eead4"
              multiline
              className={`${INPUT_CLASS} min-h-[80px]`}
              style={{ textAlignVertical: 'top' }}
            />

            <View className="mb-1.5 mt-5 flex-row items-center justify-between">
              <Text variant="caption" className="text-iron-400">
                Progression rules
              </Text>
              <Pressable
                onPress={() => setRules((prev) => [...prev, ''])}
                hitSlop={8}
                className="flex-row items-center active:opacity-70">
                <Ionicons name="add" size={16} color="#5eead4" />
                <Text variant="caption" className="ml-0.5 font-bold text-brand">
                  Add rule
                </Text>
              </Pressable>
            </View>

            {rules.length === 0 ? (
              <Text variant="muted" className="mb-1">
                No rules yet — add how you want to progress this split.
              </Text>
            ) : (
              rules.map((rule, i) => (
                <View key={i} className="mb-2 flex-row items-center">
                  <TextInput
                    value={rule}
                    onChangeText={(text) =>
                      setRules((prev) => prev.map((r, j) => (j === i ? text : r)))
                    }
                    placeholder="e.g. add weight when you hit the top of the range"
                    placeholderTextColor="#64748b"
                    selectionColor="#5eead4"
                    multiline
                    className={`${INPUT_CLASS} flex-1`}
                    style={{ textAlignVertical: 'top' }}
                  />
                  <Pressable
                    onPress={() => setRules((prev) => prev.filter((_, j) => j !== i))}
                    hitSlop={8}
                    accessibilityLabel={`Remove rule ${i + 1}`}
                    className="ml-2 h-9 w-9 items-center justify-center rounded-lg active:bg-iron-800">
                    <Ionicons name="close" size={18} color="#94a3b8" />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>

          <View className="border-t border-iron-800 px-4 pb-6 pt-3">
            <Button
              title="Save changes"
              onPress={save}
              loading={saving}
              disabled={!trimmedName}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
