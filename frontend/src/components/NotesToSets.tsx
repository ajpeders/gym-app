import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { aiParseErrorMessage } from '@/api/errors';
import type { ParsedItem } from '@/api/types';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
// Type-only import: erased at compile time, so this does not create a runtime
// import cycle with the screen that renders this component.
import type { DraftLoggedExercise } from '@/app/session/log';

const PLACEHOLDER = `Paste a day from your notes, e.g.

Push
Bench press — 95 10, 90 11, 85 12
Incline DB press 3x10 @ 30
Lateral raises 3x15 @ 12.5`;

/** Only matched items carrying sets can become draft rows. */
function usable(item: ParsedItem): boolean {
  return item.exercise_id != null && item.sets.length > 0;
}

/**
 * Turn pasted training notes into draft exercise rows.
 *
 * Deliberately has no preview of its own: the rows land in the screen's normal
 * editable table, which is a better review surface than a read-only card —
 * anything the parser got wrong is fixed in place before saving.
 */
export function NotesToSets({ onAdd }: { onAdd: (rows: DraftLoggedExercise[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function read() {
    const notes = text.trim();
    if (!notes || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parsed = await api.parseSets({ text: notes });
      // Items with no sets are parser commentary ("felt strong today"), not
      // something to log.
      const withSets = parsed.items.filter((i) => i.sets.length > 0);
      const matched = withSets.filter(usable);
      const unmatched = withSets.length - matched.length;

      // exercise_id is typed as number here but the rest of the app keys
      // exercises by string — normalise once, at the boundary.
      const rows = await Promise.all(
        matched.map(async (item) => {
          const id = String(item.exercise_id);
          // The thumbnail is cosmetic; a failed lookup must not lose the sets.
          const ex = await api.exercise(id).catch(() => null);
          return {
            exercise_id: id,
            name: ex?.name ?? item.matched_name ?? item.exercise_name,
            image: ex?.images?.[0] ?? null,
            sets: item.sets.map((s) => ({
              reps: s.reps != null ? String(s.reps) : '',
              weight: s.weight != null ? String(s.weight) : '',
            })),
          };
        }),
      );

      if (rows.length === 0) {
        setError(
          unmatched > 0
            ? "None of those matched exercises in your catalog — add them by hand below."
            : "I couldn't find any sets in that.",
        );
        return;
      }
      onAdd(rows);
      setText('');
      setOpen(false);
      const added = `Added ${rows.length} exercise${rows.length === 1 ? '' : 's'} — check the numbers below.`;
      setResult(
        unmatched > 0
          ? `${added} ${unmatched} weren't in your catalog and were skipped.`
          : added,
      );
    } catch (e) {
      setError(aiParseErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <View className="mb-3">
        <Pressable
          onPress={() => {
            setOpen(true);
            setResult(null);
          }}
          className="flex-row items-center rounded-lg border border-brand/40 bg-brand/10 px-3.5 py-3 active:opacity-70">
          <Ionicons name="sparkles" size={16} color="#818cf8" />
          <Text variant="body" className="ml-2 flex-1 text-brand">
            Read my notes
          </Text>
          <Ionicons name="chevron-down" size={16} color="#818cf8" />
        </Pressable>
        {result ? (
          <Text variant="caption" className="mt-1.5 text-mint">
            {result}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="mb-3 rounded-lg border border-brand/40 bg-brand/5 p-3.5">
      <View className="mb-2 flex-row items-center">
        <Ionicons name="sparkles" size={16} color="#818cf8" />
        <Text variant="label" className="ml-2 flex-1 text-brand">
          Read my notes
        </Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={8}>
          <Ionicons name="close" size={18} color="#94a3b8" />
        </Pressable>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={PLACEHOLDER}
        placeholderTextColor="#64748b"
        selectionColor="#818cf8"
        multiline
        editable={!busy}
        className="min-h-[120px] rounded-lg border border-iron-700 bg-iron-950 px-3.5 py-2.5 text-base text-iron-50"
        style={{ textAlignVertical: 'top' }}
      />
      <Text variant="caption" className="mt-1.5 text-iron-400">
        Nothing is saved until you tap Save session.
      </Text>
      {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}
      <Button
        title="Read notes"
        onPress={() => void read()}
        loading={busy}
        disabled={!text.trim()}
        className="mt-3"
      />
    </View>
  );
}
