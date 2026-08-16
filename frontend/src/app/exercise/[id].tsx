import { useCallback, useState } from 'react';
import { Dimensions, ScrollView, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { api } from '@/api/client';
import type { Exercise } from '@/api/types';
import { useActiveWorkout } from '@/state/active-workout';
import { useAiStatus } from '@/hooks/use-ai-status';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ExerciseThumb } from '@/components/ExerciseThumb';
import { Loading, ErrorState } from '@/components/ui/Feedback';
import { titleCase } from '@/lib/format';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { activeId, addExercise, start, load } = useActiveWorkout();
  const { configured: aiConfigured } = useAiStatus();

  const [exercise, setExercise] = useState<Exercise | null>(null);
  // Asking about the movement you're looking at.
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [grounded, setGrounded] = useState(true);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setExercise(await api.exercise(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exercise');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  async function onPickImage() {
    if (!exercise) return;
    setImageError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setImageError('Allow photo access to add an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      mediaTypes: ['images'],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    setUploading(true);
    try {
      setExercise(
        await api.uploadExerciseImage(exercise.id, {
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName ?? undefined,
        }),
      );
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onRemoveImage() {
    if (!exercise) return;
    setImageError(null);
    try {
      setExercise(await api.deleteExerciseImage(exercise.id));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not remove the image');
    }
  }

  async function onAddToWorkout() {
    if (!exercise) return;
    setAdding(true);
    try {
      await addExercise(exercise.id);
      router.back();
    } finally {
      setAdding(false);
    }
  }

  async function onStartWithExercise() {
    if (!exercise) return;
    setAdding(true);
    try {
      const session = await start({ name: exercise.name });
      await api.addSessionExercise(session.id, { exercise_id: exercise.id });
      await load(session.id);
      router.push(`/session/active/${session.id}`);
    } finally {
      setAdding(false);
    }
  }

  const imgWidth = Math.min(Dimensions.get('window').width - 32, 480);

  async function ask() {
    const text = question.trim();
    if (!text || !id) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const result = await api.exerciseQa(id, text);
      setAnswer(result.answer);
      setGrounded(result.grounded);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : 'Could not answer that right now');
    } finally {
      setAsking(false);
    }
  }

  return (
    <Screen scroll={false} padded={false} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: true, title: 'Exercise' }} />
      {loading ? (
        <Loading />
      ) : error || !exercise ? (
        <ErrorState message={error ?? 'Not found'} onRetry={fetch} />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
          <Text variant="title">{exercise.name}</Text>
          <View className="flex-row flex-wrap mt-2">
            {exercise.category ? <Chip label={titleCase(exercise.category)} /> : null}
            {exercise.equipment ? <Chip label={titleCase(exercise.equipment)} /> : null}
            {exercise.level ? <Chip label={titleCase(exercise.level)} /> : null}
            {exercise.is_custom ? <Chip label="Custom" active /> : null}
          </View>

          {exercise.images?.length ? (
            <View className="my-3">
              <ExerciseThumb
                images={exercise.images}
                width={imgWidth}
                height={imgWidth * 0.66}
                animate={exercise.images.length > 1}
                fit="contain"
                radius={8}
                intervalMs={900}
              />
              {exercise.images.length > 1 ? (
                <Text variant="caption" className="mt-1.5">
                  Animated demo of the movement
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Only your own exercises — the shared catalog stays as imported.
              Most likely to be blank: movements the importer created for you. */}
          {exercise.is_custom ? (
            <View className="mb-3 flex-row gap-2">
              <Button
                title={exercise.images?.length ? 'Replace photo' : 'Add a photo'}
                variant="secondary"
                onPress={onPickImage}
                loading={uploading}
              />
              {exercise.images?.length ? (
                <Button title="Remove" variant="ghost" onPress={onRemoveImage} />
              ) : null}
            </View>
          ) : null}

          {imageError ? (
            <Text variant="caption" className="mb-3 text-red-400">
              {imageError}
            </Text>
          ) : null}

          {exercise.primary_muscles?.length ? (
            <Card className="mt-2 mb-3">
              <Text variant="label">Primary muscles</Text>
              <Text variant="body" className="mt-1">
                {exercise.primary_muscles.map(titleCase).join(', ')}
              </Text>
              {exercise.secondary_muscles?.length ? (
                <>
                  <Text variant="label" className="mt-3">
                    Secondary muscles
                  </Text>
                  <Text variant="body" className="mt-1">
                    {exercise.secondary_muscles.map(titleCase).join(', ')}
                  </Text>
                </>
              ) : null}
            </Card>
          ) : null}

          {exercise.instructions?.length ? (
            <Card className="mb-3">
              <Text variant="label" className="mb-2">
                Instructions
              </Text>
              <View className="gap-2">
                {exercise.instructions.map((step, i) => (
                  <View key={i} className="flex-row gap-2">
                    <Text variant="label" className="text-brand">
                      {i + 1}.
                    </Text>
                    <Text variant="body" className="flex-1">
                      {step}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {/* Ask about the movement. Grounded in the entry above — the model is
            * given that and told to say when it doesn't cover the question. */}
          {aiConfigured ? (
            <Card className="mb-3">
              <Text variant="label" className="mb-2">
                Ask about this movement
              </Text>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                accessibilityLabel="Question about this exercise"
                placeholder="e.g. where should the bar touch?"
                placeholderTextColor="#64748b"
                className="rounded-lg border border-iron-700 bg-iron-950 px-3 py-2.5 text-base text-iron-100"
              />
              <Button
                title="Ask"
                variant="secondary"
                icon="help-circle-outline"
                className="mt-2"
                loading={asking}
                disabled={!question.trim()}
                onPress={() => void ask()}
              />
              {answer ? (
                <View className="mt-3 rounded-lg border border-iron-800 bg-iron-950/60 p-3">
                  <Text variant="body">{answer}</Text>
                  {!grounded ? (
                    <Text variant="caption" className="mt-2 text-amber-300">
                      This exercise has no instructions in the catalog, so that answer isn&apos;t
                      grounded in anything the app knows.
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {askError ? (
                <Text variant="caption" className="mt-2 text-red-400">
                  {askError}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {activeId ? (
            <Button
              title="Add to active session"
              size="lg"
              loading={adding}
              onPress={onAddToWorkout}
            />
          ) : (
            <Button
              title="Start with this exercise"
              size="lg"
              icon="play"
              loading={adding}
              onPress={onStartWithExercise}
            />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
