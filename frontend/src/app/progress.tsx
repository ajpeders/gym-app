import { useCallback, useEffect, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { api } from '@/api/client';
import type { ProgressPhoto } from '@/api/types';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Loading, EmptyState } from '@/components/ui/Feedback';
import { formatDate } from '@/lib/format';

const GAP = 8;
const COLS = 3;

const DATE_PRESETS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: 1 },
  { label: '2 days ago', days: 2 },
  { label: 'A week ago', days: 7 },
];

/**
 * Capture time from EXIF. Cameras write "YYYY:MM:DD HH:MM:SS" (colons in the
 * date part), which Date can't parse directly.
 */
function exifTakenAt(asset: ImagePicker.ImagePickerAsset): string | null {
  const exif = asset.exif as Record<string, unknown> | undefined;
  const raw =
    (exif?.DateTimeOriginal as string | undefined) ??
    (exif?.DateTimeDigitized as string | undefined) ??
    (exif?.DateTime as string | undefined);
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  if (Number.isNaN(dt.getTime()) || dt.getTime() > Date.now() + 86400000) return null;
  return dt.toISOString();
}

function isoForDaysBack(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function isoForDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString();
}

/** A progress photo whose auth'd image source is resolved lazily. */
function ProgressImage({ id, size, radius = 8 }: { id: number; size: number; radius?: number }) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let active = true;
    api.progressPhotoImageSource(id).then((s) => active && setSource(s));
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <View style={{ width: size, height: size, borderRadius: radius }} className="overflow-hidden bg-iron-800">
      {source ? (
        <Image source={source} style={{ width: size, height: size }} contentFit="cover" transition={150} />
      ) : null}
    </View>
  );
}

export default function ProgressScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const selectedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add sheet: a picked image awaiting date + notes before upload.
  const [pending, setPending] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [daysBack, setDaysBack] = useState(0);
  const [notes, setNotes] = useState('');
  // Capture date read from the image's EXIF, when it has one.
  const [exifDate, setExifDate] = useState<string | null>(null);
  // Set when the user overrides the EXIF date with a preset.
  const [overrideDate, setOverrideDate] = useState(false);

  // Full-screen viewer.
  const [viewing, setViewing] = useState<ProgressPhoto | null>(null);

  const width = Dimensions.get('window').width;
  const cell = Math.floor((width - 32 - GAP * (COLS - 1)) / COLS);

  const fetch = useCallback(async () => {
    setError(null);
    try {
      setPhotos(await api.progressPhotos());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetch();
    }, [fetch]),
  );

  async function pick(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', `Allow ${fromCamera ? 'camera' : 'photo'} access to add a progress photo.`);
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false, exif: true })
      : await ImagePicker.launchImageLibraryAsync({
          quality: 0.7,
          mediaTypes: ['images'],
          exif: true,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPending(asset);
    // Prefer the date the photo was actually taken — picking an old gym photo
    // from the library should date it then, not today.
    setExifDate(exifTakenAt(asset));
    setDaysBack(0);
    setNotes('');
    setOverrideDate(Boolean(selectedDate));
  }

  function addPhoto() {
    Alert.alert('Add progress photo', undefined, [
      { text: 'Take photo', onPress: () => void pick(true) },
      { text: 'Choose from library', onPress: () => void pick(false) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function confirmUpload() {
    if (!pending) return;
    setUploading(true);
    setError(null);
    try {
      await api.uploadProgressPhoto({
        uri: pending.uri,
        mimeType: pending.mimeType,
        fileName: pending.fileName,
        takenAt:
          !overrideDate && exifDate
            ? exifDate
            : selectedDate
              ? isoForDate(selectedDate)
              : isoForDaysBack(daysBack),
        notes: notes.trim() || undefined,
      });
      setPending(null);
      setExifDate(null);
      setOverrideDate(false);
      await fetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function confirmDelete(photo: ProgressPhoto) {
    Alert.alert('Delete photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setViewing(null);
          await api.deleteProgressPhoto(photo.id);
          await fetch();
        },
      },
    ]);
  }

  const visiblePhotos = selectedDate
    ? photos.filter((photo) => photo.taken_at.slice(0, 10) === selectedDate)
    : photos;
  const selectedDateLabel = selectedDate ? formatDate(isoForDate(selectedDate)) : null;

  return (
    <Screen scroll={false} padded={false}>
      <Stack.Screen options={{ headerShown: true, title: 'Progress photos' }} />
      <ScrollView
        keyboardShouldPersistTaps="handled" className="flex-1" contentContainerClassName="px-4 pt-3 pb-28">
        {selectedDateLabel ? (
          <View className="mb-4 rounded-2xl border border-brand/25 bg-brand/10 p-4">
            <Text variant="caption" className="font-bold uppercase tracking-wider text-brand">
              Progress for
            </Text>
            <Text variant="heading" className="mt-1">
              {selectedDateLabel}
            </Text>
          </View>
        ) : null}
        <Button
          title={selectedDateLabel ? `Add photo for ${selectedDateLabel}` : 'Add progress photo'}
          icon="camera"
          size="lg"
          className="mb-4"
          onPress={addPhoto}
        />
        {error ? <Text className="mb-3 text-sm text-red-400">{error}</Text> : null}

        {loading ? (
          <Loading />
        ) : visiblePhotos.length === 0 ? (
          <EmptyState
            icon="IMG"
            title={selectedDateLabel ? 'No photos for this day' : 'No photos yet'}
            subtitle={
              selectedDateLabel
                ? 'Add one now, or go back to choose another day.'
                : 'Add a photo to start tracking how you look over time.'
            }
          />
        ) : (
          <View className="flex-row flex-wrap" style={{ gap: GAP }}>
            {visiblePhotos.map((p) => (
              <Pressable key={p.id} onPress={() => setViewing(p)}>
                <ProgressImage id={p.id} size={cell} />
                <Text variant="caption" className="mt-1" numberOfLines={1}>
                  {formatDate(p.taken_at)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add sheet — date + notes for the picked image */}
      <Modal visible={!!pending} animationType="slide" transparent onRequestClose={() => setPending(null)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="rounded-t-2xl border-t border-iron-700 bg-iron-950 px-4 pb-8 pt-4">
            <View className="mb-3 flex-row items-center justify-between">
              <Text variant="heading">New progress photo</Text>
              <Pressable onPress={() => setPending(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color="#94a3b8" />
              </Pressable>
            </View>

            {pending ? (
              <Image
                source={{ uri: pending.uri }}
                style={{ width: '100%', height: 220, borderRadius: 12 }}
                contentFit="cover"
              />
            ) : null}

            <Text variant="label" className="mb-1.5 mt-4 text-iron-300">
              When was this taken?
            </Text>

            {exifDate ? (
              <Pressable
                onPress={() => setOverrideDate(false)}
                className={`mb-2 flex-row items-center rounded-lg border px-3 py-2.5 ${
                  overrideDate ? 'border-iron-700 bg-iron-900' : 'border-brand bg-brand/15'
                }`}>
                <Ionicons
                  name={overrideDate ? 'ellipse-outline' : 'checkmark-circle'}
                  size={16}
                  color={overrideDate ? '#64748b' : '#5eead4'}
                />
                <Text
                  variant="caption"
                  className={`ml-2 flex-1 font-semibold ${
                    overrideDate ? 'text-iron-300' : 'text-brand'
                  }`}>
                  From photo: {formatDate(exifDate)}
                </Text>
              </Pressable>
            ) : null}

            {selectedDateLabel ? (
              <View className="rounded-lg border border-brand bg-brand/15 px-3 py-2.5">
                <Text variant="caption" className="font-bold text-brand">
                  Calendar date: {selectedDateLabel}
                </Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {DATE_PRESETS.map((preset) => {
                const active = preset.days === daysBack && (!exifDate || overrideDate);
                return (
                  <Pressable
                    key={preset.days}
                    onPress={() => {
                      setDaysBack(preset.days);
                      setOverrideDate(true);
                    }}
                    className={`rounded-full border px-3.5 py-2 ${
                      active ? 'border-brand bg-brand/20' : 'border-iron-700 bg-iron-900'
                    }`}>
                    <Text variant="caption" className={active ? 'font-bold text-brand' : 'text-iron-200'}>
                      {preset.label}
                    </Text>
                  </Pressable>
                );
                })}
              </View>
            )}

            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes (optional) — e.g. week 4, morning"
              placeholderTextColor="#64748b"
              className="mt-4 rounded-lg border border-iron-700 bg-iron-900 px-4 py-3 text-base text-iron-50"
            />

            <Button
              title="Save photo"
              size="lg"
              className="mt-4"
              loading={uploading}
              onPress={confirmUpload}
            />
          </View>
        </View>
      </Modal>

      {/* Full-screen viewer */}
      <Modal visible={!!viewing} animationType="fade" transparent onRequestClose={() => setViewing(null)}>
        <View className="flex-1 items-center justify-center bg-black/95 px-4">
          {viewing ? <ProgressImage id={viewing.id} size={width - 32} radius={12} /> : null}
          {viewing ? (
            <Text variant="body" className="mt-3 text-iron-200">
              {formatDate(viewing.taken_at)}
              {viewing.notes ? ` · ${viewing.notes}` : ''}
            </Text>
          ) : null}
          <View className="mt-6 flex-row gap-3">
            <Button title="Close" variant="secondary" onPress={() => setViewing(null)} />
            {viewing ? (
              <Button title="Delete" variant="danger" onPress={() => confirmDelete(viewing)} />
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
