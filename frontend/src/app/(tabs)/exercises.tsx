import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { api } from '@/api/client';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { FormError } from '@/components/ui/Feedback';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { ExerciseBrowser } from '@/components/ExerciseBrowser';

export default function ExercisesScreen() {
  const router = useRouter();
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createCustomExercise() {
    const name = customName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createExercise({ name });
      setCustomOpen(false);
      setCustomName('');
      router.push(`/exercise/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create exercise');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen scroll={false} padded={false}>
      <View className="px-4 pt-4 pb-3">
        <ScreenHeader
          title="Exercises"
          subtitle="Find a movement or create your own."
          className="mb-0"
          action={
            <Button
              title="Custom"
              size="sm"
              variant="secondary"
              icon="add"
              onPress={() => setCustomOpen(true)}
            />
          }
        />
      </View>
      <ExerciseBrowser onSelect={(ex) => router.push(`/exercise/${ex.id}`)} />

      <ModalSheet
        visible={customOpen}
        title="New custom exercise"
        subtitle="Use your own movement, variation, or nickname."
        icon="add-circle-outline"
        onClose={() => {
          setCustomOpen(false);
          setError(null);
        }}>
        <FormField
          label="Exercise name"
          value={customName}
          onChangeText={setCustomName}
          placeholder="e.g. Half-kneeling cable press"
          autoFocus
          onSubmitEditing={() => void createCustomExercise()}
        />
        {error ? (
          <View className="mt-3">
            <FormError message={error} />
          </View>
        ) : null}
        <Button
          title="Create exercise"
          size="lg"
          icon="add"
          className="mt-4"
          disabled={!customName.trim()}
          loading={creating}
          onPress={() => void createCustomExercise()}
        />
      </ModalSheet>
    </Screen>
  );
}
