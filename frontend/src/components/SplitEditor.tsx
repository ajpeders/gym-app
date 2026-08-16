import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Split, SplitInput, SplitMode } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { ModalSheet } from '@/components/ui/ModalSheet';

const MODES: {
  value: SplitMode;
  label: string;
  blurb: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: 'rigid',
    label: 'By weekday',
    blurb: 'Days sit on fixed weekdays and you get told when you slip.',
    icon: 'calendar-outline',
  },
  {
    value: 'rolling',
    label: 'Rotation',
    blurb: 'Days run in order, rest whenever — nothing is ever late.',
    icon: 'repeat-outline',
  },
];

interface Props {
  visible: boolean;
  split: Split;
  saving?: boolean;
  onSave: (input: SplitInput) => void;
  onClose: () => void;
}

/** Hand-editing for a split's own fields: name, notes, and progression rules.
 * The days inside it stay editable on their own screens. */
export function SplitEditor({ visible, split, saving = false, onSave, onClose }: Props) {
  const [name, setName] = useState(split.name);
  const [mode, setMode] = useState<SplitMode>(split.mode);
  const [notes, setNotes] = useState(split.notes ?? '');
  const [rules, setRules] = useState<string[]>(split.rules);

  // Re-seed from the saved split each time the sheet opens so a cancelled edit
  // never leaks into the next one.
  useEffect(() => {
    if (visible) {
      setName(split.name);
      setMode(split.mode);
      setNotes(split.notes ?? '');
      setRules(split.rules);
    }
  }, [visible, split]);

  const trimmedName = name.trim();

  function save() {
    onSave({
      name: trimmedName,
      mode,
      notes: notes.trim() ? notes.trim() : null,
      rules: rules.map((r) => r.trim()).filter(Boolean),
    });
  }

  return (
    <ModalSheet visible={visible} title="Edit split" onClose={onClose}>
      <FormField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Push / Pull / Legs"
      />

      {/* Scheduling mode. It changes what today, missed and done each mean, so
        * it's picked here rather than inferred from how the days are set up. */}
      <Text variant="caption" className="mb-1.5 mt-5 text-iron-400">
        Scheduling
      </Text>
      <View className="flex-row gap-2">
        {MODES.map((option) => {
          const selected = mode === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setMode(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`flex-1 rounded-lg border p-3 ${
                selected ? 'border-brand bg-brand/10' : 'border-iron-700 bg-iron-900'
              }`}>
              <View className="flex-row items-center">
                <Ionicons
                  name={option.icon}
                  size={15}
                  color={selected ? '#818cf8' : '#94a3b8'}
                />
                <Text
                  variant="caption"
                  className={`ml-1.5 font-bold ${selected ? 'text-brand' : 'text-iron-200'}`}>
                  {option.label}
                </Text>
              </View>
              <Text variant="caption" className="mt-1 text-iron-400">
                {option.blurb}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FormField
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="Anything to remember about this split"
        multiline
        containerClassName="mt-5"
      />

      <View className="mb-1.5 mt-5 flex-row items-center justify-between">
        <Text variant="caption" className="text-iron-400">
          Progression rules
        </Text>
        <Pressable
          onPress={() => setRules((prev) => [...prev, ''])}
          hitSlop={8}
          accessibilityRole="button"
          className="flex-row items-center active:opacity-70">
          <Ionicons name="add" size={16} color="#38bdf8" />
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
            <FormField
              label={`Rule ${i + 1}`}
              value={rule}
              onChangeText={(text) =>
                setRules((prev) => prev.map((r, j) => (j === i ? text : r)))
              }
              placeholder="e.g. add weight when you hit the top of the range"
              multiline
              containerClassName="flex-1"
            />
            <Pressable
              onPress={() => setRules((prev) => prev.filter((_, j) => j !== i))}
              hitSlop={8}
              accessibilityLabel={`Remove rule ${i + 1}`}
              className="ml-2 mt-6 h-9 w-9 items-center justify-center rounded-lg active:bg-iron-800">
              <Ionicons name="close" size={18} color="#94a3b8" />
            </Pressable>
          </View>
        ))
      )}

      <View className="mt-5 border-t border-iron-800 pt-4">
        <Button title="Save changes" onPress={save} loading={saving} disabled={!trimmedName} />
      </View>
    </ModalSheet>
  );
}
