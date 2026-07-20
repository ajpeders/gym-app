import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

import { Text } from '@/components/ui/Text';

interface Props {
  images?: string[] | null;
  /** Square side length when width/height aren't given. */
  size?: number;
  width?: number;
  height?: number;
  /** Loop through the frames like a GIF (free-exercise-db ships 2 per move). */
  animate?: boolean;
  radius?: number;
  intervalMs?: number;
}

/**
 * Exercise image. In lists it shows a single still (`images[0]`); on the
 * exercise detail screen `animate` flips through the frames on a timer, and
 * expo-image's crossfade turns the two start/end stills into a little loop of
 * the movement — a "GIF" with no extra data.
 */
export function ExerciseThumb({
  images,
  size = 56,
  width,
  height,
  animate = false,
  radius = 8,
  intervalMs = 850,
}: Props) {
  const frames = (images ?? []).filter(Boolean);
  const w = width ?? size;
  const h = height ?? size;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!animate || frames.length < 2) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), intervalMs);
    return () => clearInterval(id);
  }, [animate, frames.length, intervalMs]);

  if (frames.length === 0) {
    return (
      <View
        style={{ width: w, height: h, borderRadius: radius }}
        className="items-center justify-center bg-iron-800">
        <Text className="text-lg font-black text-brand">EX</Text>
      </View>
    );
  }

  return (
    <View style={{ width: w, height: h, borderRadius: radius, overflow: 'hidden' }} className="bg-iron-800">
      <Image
        source={{ uri: frames[animate ? frame % frames.length : 0] }}
        style={{ width: w, height: h }}
        contentFit="cover"
        transition={animate ? 300 : 0}
      />
    </View>
  );
}
