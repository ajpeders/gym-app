import { Alert, Share } from 'react-native';

import type { Session, Workout } from '@/api/types';
import { formatDate, formatRepRange, titleCase } from '@/lib/format';

// Exports come in two flavors, both delivered through the native Share sheet:
//   - "text": clean human-readable, shareable to Notes/Messages/anyone. Workout
//     text also round-trips back through the AI paste-import.
//   - "json": structured + portable for backup / exact re-import.
export type ExportFormat = 'text' | 'json';

function repsLabel(min: number | null, max: number | null | undefined): string | null {
  return formatRepRange(min, max ?? null);
}

/** One exercise line: "1. Bench Press — 4×8–12 @ 60kg". */
function exerciseLine(
  index: number,
  name: string,
  sets: number | null,
  reps: string | null,
  weight: number | null,
  units: string,
): string {
  const scheme =
    sets != null && reps ? `${sets}×${reps}` : sets != null ? `${sets} sets` : reps ? `${reps} reps` : null;
  const load = weight != null ? `@ ${weight}${units}` : null;
  const detail = [scheme, load].filter(Boolean).join(' ');
  return `${index}. ${titleCase(name)}${detail ? ` — ${detail}` : ''}`;
}

export function workoutToText(workout: Workout, units: string): string {
  const lines = [titleCase(workout.name), ''];
  if (workout.notes) lines.push(workout.notes, '');
  const ordered = workout.exercises.slice().sort((a, b) => a.order - b.order);
  ordered.forEach((e, i) => {
    lines.push(
      exerciseLine(
        i + 1,
        e.exercise?.name ?? 'Exercise',
        e.target_sets,
        repsLabel(e.target_reps, e.target_reps_max),
        e.target_weight,
        units,
      ),
    );
  });
  return lines.join('\n').trim();
}

export function workoutToJson(workout: Workout, units: string): string {
  return JSON.stringify(
    {
      type: 'workout',
      name: workout.name,
      notes: workout.notes,
      units,
      exercises: workout.exercises
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((e) => ({
          name: e.exercise?.name ?? 'Exercise',
          target_sets: e.target_sets,
          target_reps: e.target_reps,
          target_reps_max: e.target_reps_max ?? null,
          target_weight: e.target_weight,
          rest_seconds: e.rest_seconds,
        })),
    },
    null,
    2,
  );
}

export function sessionToText(session: Session, units: string): string {
  const title = session.name || 'Session';
  const lines = [`${titleCase(title)} — ${formatDate(session.started_at)}`, ''];
  if (session.notes) lines.push(session.notes, '');
  const ordered = session.exercises.slice().sort((a, b) => a.order - b.order);
  ordered.forEach((we, i) => {
    lines.push(`${i + 1}. ${titleCase(we.exercise?.name ?? 'Exercise')}`);
    const done = we.sets.filter((s) => s.completed !== false);
    (done.length ? done : we.sets).forEach((s, j) => {
      const load = s.weight != null ? ` @ ${s.weight}${units}` : '';
      const rpe = s.rpe != null ? ` (RPE ${s.rpe})` : '';
      lines.push(`   Set ${j + 1}: ${s.reps} rep${s.reps === 1 ? '' : 's'}${load}${rpe}`);
    });
  });
  return lines.join('\n').trim();
}

export function sessionToJson(session: Session, units: string): string {
  return JSON.stringify(
    {
      type: 'session',
      name: session.name,
      date: session.started_at,
      finished_at: session.finished_at,
      notes: session.notes,
      units,
      exercises: session.exercises
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((we) => ({
          name: we.exercise?.name ?? 'Exercise',
          sets: we.sets.map((s) => ({
            reps: s.reps,
            weight: s.weight,
            rpe: s.rpe,
            set_type: s.set_type,
            completed: s.completed !== false,
          })),
        })),
    },
    null,
    2,
  );
}

/** Open the native share sheet with the given content. Silently ignores the
 *  user dismissing it; rethrows real failures for the caller to surface. */
export async function shareText(title: string, message: string): Promise<void> {
  try {
    await Share.share({ title, message }, { subject: title });
  } catch (err) {
    if (err instanceof Error && /cancel|dismiss/i.test(err.message)) return;
    throw err;
  }
}

/** Ask the user which format to share, then open the share sheet. Uses a native
 *  Alert so there's no bespoke UI to maintain. */
export function promptExport(title: string, text: string, json: string): void {
  Alert.alert('Export', 'Choose a format to share', [
    { text: 'Readable text', onPress: () => void shareText(title, text) },
    { text: 'JSON', onPress: () => void shareText(title, json) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
