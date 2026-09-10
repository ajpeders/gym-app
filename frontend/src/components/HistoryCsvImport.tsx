import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api } from '@/api/client';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

/**
 * A logged history from another app, pasted as its CSV export.
 *
 * Lives on History because it creates sessions, not workouts: it sat on the
 * plan-import page as a second box for a different job. Deterministic — no
 * model reads a CSV.
 */
export function HistoryCsvImport({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function importCsv() {
    const csv = csvText.trim();
    if (!csv) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.importCsv(csv);
      const missed = res.unmatched.length
        ? ` ${res.unmatched.length} movement(s) weren't in the library: ${res.unmatched
            .slice(0, 3)
            .join(', ')}.`
        : '';
      setResult(
        `Imported ${res.sessions_created} sessions and ${res.sets_imported} sets from your ${res.format} export.${missed}`,
      );
      setCsvText('');
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="mt-2 flex-row items-center rounded-lg border border-iron-800 bg-iron-900/60 px-3.5 py-3 active:opacity-70">
        <Ionicons name="download-outline" size={16} color="#5eead4" />
        <Text variant="body" className="ml-2 flex-1 text-iron-100">
          Coming from Hevy or Strong?
        </Text>
        <Ionicons name="chevron-down" size={16} color="#94a3b8" />
        {result ? (
          <Text variant="caption" className="ml-2 text-brand">
            Imported
          </Text>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View className="mt-2 rounded-lg border border-iron-800 bg-iron-900/60 p-4">
      <View className="flex-row items-center">
        <Text variant="subheading" className="flex-1">
          Import a logged history
        </Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={18} color="#94a3b8" />
        </Pressable>
      </View>
      <Text variant="muted" className="mb-3 mt-0.5">
        Paste your CSV export and your whole logged history comes with you — dates, sets and all.
      </Text>
      <TextInput
        value={csvText}
        onChangeText={setCsvText}
        accessibilityLabel="CSV export"
        placeholder="Date,Workout Name,Exercise Name,..."
        placeholderTextColor="#64748b"
        multiline
        className="h-24 rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-sm text-iron-100"
        style={{ textAlignVertical: 'top' }}
      />
      {result ? (
        <Text variant="caption" className="mt-2 text-brand">
          {result}
        </Text>
      ) : null}
      {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}
      <Button
        title="Import history"
        variant="secondary"
        icon="download-outline"
        className="mt-3"
        loading={busy}
        disabled={!csvText.trim()}
        onPress={() => void importCsv()}
      />
    </View>
  );
}
