import type { Units } from '@/api/types';

/** Parse an API timestamp.
 *
 * The backend stores UTC and serializes it WITHOUT a timezone designator
 * ("2026-07-31T01:45:00"). JavaScript reads such a string as *local* time, so
 * every absolute time would be off by the UTC offset — times of day wrong, and
 * entries grouped under the wrong calendar day. Assume UTC when no designator
 * is present. */
export function parseServerDate(iso: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

export function formatWeight(weight: number | null | undefined, units: Units): string {
  if (weight === null || weight === undefined) return '—';
  const rounded = Math.round(weight * 100) / 100;
  return `${rounded} ${units}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseServerDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseServerDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseServerDate(iso).getTime();
  if (Number.isNaN(d)) return '';
  const diff = Date.now() - d;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/** Wall-clock span. With no `end` it counts up from `start` to now (a live
 * session). A finished session with no measurable span never actually ran on
 * the clock — a retroactively logged one gets finished_at = started_at — so it
 * reads "—" rather than claiming "0m". */
export function formatDuration(start: string, end?: string | null): string {
  const s = parseServerDate(start).getTime();
  const e = end ? parseServerDate(end).getTime() : Date.now();
  const secs = Math.max(0, Math.round((e - s) / 1000));
  if (end && secs < 60) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function titleCase(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Render a rep target that may be a range: (8, 12) -> "8–12", (8, null) -> "8".
// Returns null when there's no rep target at all.
export function formatRepRange(
  min: number | null | undefined,
  max?: number | null,
): string | null {
  if (min == null) return max == null ? null : String(max);
  if (max != null && max !== min) return `${min}–${max}`;
  return String(min);
}

// Parse an editor field like "8-12", "8–12", or "8" into low/high rep targets.
// Empty/garbage -> both null. A single value -> {min, max: null}.
export function parseRepRange(input: string): { min: number | null; max: number | null } {
  const nums = (input.match(/\d+/g) ?? []).map((n) => parseInt(n, 10));
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length === 1) return { min: nums[0], max: null };
  const [a, b] = [nums[0], nums[1]].sort((x, y) => x - y);
  return { min: a, max: a === b ? null : b };
}

/** Load for a logged set: bodyweight moves have no external weight. */
/**
 * A muscle the way a person says it.
 *
 * The catalog mixes "Abs" with "Obliquus externus abdominis" and "Lats" with
 * "Trapezius". The rows stay as their source wrote them; every screen reads
 * them through here.
 */
const MUSCLE_LABELS: Record<string, string> = {
  'obliquus externus abdominis': 'Obliques',
  'rectus abdominis': 'Abs',
  abdominals: 'Abs',
  trapezius: 'Traps',
  gastrocnemius: 'Calves',
  soleus: 'Calves',
  'biceps femoris': 'Hamstrings',
  'latissimus dorsi': 'Lats',
  'pectoralis major': 'Chest',
  'anterior deltoid': 'Front delts',
  deltoid: 'Shoulders',
  'serratus anterior': 'Serratus',
  brachialis: 'Brachialis',
  'erector spinae': 'Lower back',
  'gluteus maximus': 'Glutes',
  'quadriceps femoris': 'Quads',
  quadriceps: 'Quads',
  'triceps brachii': 'Triceps',
  'biceps brachii': 'Biceps',
};

export function muscleLabel(name: string): string {
  const key = name.trim().toLowerCase();
  return MUSCLE_LABELS[key] ?? titleCase(name);
}

export function formatLoad(weight: number | null | undefined, units: string): string {
  return weight == null ? 'BW' : `${weight} ${units}`;
}

/** Wall-clock time a set was logged, e.g. "6:42 PM". Empty when unknown. */
export function formatTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseServerDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A held set's duration, e.g. 45 -> "45s", 90 -> "1:30". */
export function formatDurationSeconds(secs: number | null | undefined): string {
  if (secs == null) return '-';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
