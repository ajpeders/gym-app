import { useEffect, useState } from 'react';

import { api } from '@/api/client';
import type { ExerciseStats } from '@/api/types';

/** Personal records for a set of exercises, keyed by exercise id.
 *
 * Fetched in one batched request and re-fetched only when the set of ids
 * actually changes (the caller usually passes a freshly-built array each
 * render). PR history is decoration — a failure resolves to an empty map so
 * the surrounding screen still works. */
export function useExerciseStats(
  exerciseIds: (string | number)[],
): Map<string, ExerciseStats> {
  const [stats, setStats] = useState<Map<string, ExerciseStats>>(new Map());
  // Ids are declared as strings in api/types.ts but arrive as numbers, so both
  // sides of the map are normalized to strings (see statsKey below).
  const key = [...new Set(exerciseIds.map(String))].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setStats(new Map());
      return;
    }
    api
      .exerciseStats(ids)
      .then((rows) => {
        if (cancelled) return;
        setStats(new Map(rows.map((r) => [String(r.exercise_id), r])));
      })
      .catch(() => {
        if (!cancelled) setStats(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return stats;
}

/** Look up one exercise's stats regardless of whether its id is a string or a
 * number at runtime. */
export function statsFor(
  stats: Map<string, ExerciseStats>,
  exerciseId: string | number,
): ExerciseStats | undefined {
  return stats.get(String(exerciseId));
}

/** One-line PR summary, e.g. "PR 72.5kg × 8 · range 55–72.5kg".
 * Null when there's nothing worth showing yet. */
export function formatExerciseStats(
  stat: ExerciseStats | undefined,
  units: string,
): string | null {
  if (!stat || stat.set_count === 0) return null;
  const parts: string[] = [];
  if (stat.best_weight != null) {
    const reps = stat.best_weight_reps != null ? ` × ${stat.best_weight_reps}` : '';
    parts.push(`PR ${stat.best_weight}${units}${reps}`);
    // A single logged load isn't a range — don't render "55–55".
    if (stat.min_weight != null && stat.min_weight !== stat.max_weight) {
      parts.push(`range ${stat.min_weight}–${stat.max_weight}${units}`);
    }
  } else if (stat.max_reps != null) {
    // Bodyweight-only history: reps are the record.
    parts.push(`best ${stat.max_reps} reps`);
  }
  if (parts.length === 0) return null;
  return parts.join(' · ');
}
