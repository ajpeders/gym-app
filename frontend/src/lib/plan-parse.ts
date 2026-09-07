import { parseRepRange } from '@/lib/format';

/**
 * Read a plan that's already structured, without asking a model to.
 *
 * The paste box goes to the AI because a training plan written in Notes is
 * prose. A CSV or a JSON export isn't: the days, the movements and the numbers
 * are already separated, and running them through an LLM only adds latency,
 * cost, and a chance of the model changing something. It also means importing
 * a structured plan works on an account with no AI provider configured at all.
 *
 * Returns null when the text isn't recognisably structured, which is the
 * signal to fall back to the AI path.
 */

export interface StructuredExercise {
  name: string;
  sets: number | null;
  reps: number | null;
  repsMax: number | null;
  weight: number | null;
  notes: string | null;
}

export interface StructuredDay {
  name: string;
  notes: string | null;
  weekdays: number[];
  floating: boolean;
  exercises: StructuredExercise[];
}

export interface StructuredPlan {
  name: string | null;
  notes: string | null;
  rules: string[];
  /** Which shape it came from — surfaced in the review so the user knows. */
  source: 'json' | 'csv';
  days: StructuredDay[];
}

const WEEKDAYS = [
  ['sunday', 'sun'],
  ['monday', 'mon'],
  ['tuesday', 'tue', 'tues'],
  ['wednesday', 'wed', 'weds'],
  ['thursday', 'thu', 'thur', 'thurs'],
  ['friday', 'fri'],
  ['saturday', 'sat'],
];

/** Weekdays named in a day header ("Mon/Thu - Push" -> [1, 4]). */
export function weekdaysFromLabel(label: string): number[] {
  const text = label.toLowerCase();
  const found = new Set<number>();
  WEEKDAYS.forEach((forms, index) => {
    if (forms.some((f) => new RegExp(`\\b${f}\\b`).test(text))) found.add(index);
  });
  return [...found].sort((a, b) => a - b);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function int(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.round(n);
}

function str(value: unknown): string | null {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s || null;
}

function day(name: string, notes: string | null, exercises: StructuredExercise[]): StructuredDay {
  const weekdays = weekdaysFromLabel(name);
  return {
    name: name.trim() || 'Workout',
    notes,
    weekdays,
    // No weekday in the header means the day isn't pinned to one — the same
    // reading the plan model gives an unscheduled workout.
    floating: weekdays.length === 0,
    exercises,
  };
}

// --- JSON ------------------------------------------------------------------

function exerciseFromJson(raw: Record<string, unknown>): StructuredExercise | null {
  const name = str(raw.name ?? raw.exercise ?? raw.exercise_name);
  if (!name) return null;
  const repsRaw = raw.target_reps ?? raw.reps;
  const parsed =
    typeof repsRaw === 'string' ? parseRepRange(repsRaw) : { min: int(repsRaw), max: null };
  return {
    name,
    sets: int(raw.target_sets ?? raw.sets),
    reps: parsed.min,
    repsMax: int(raw.target_reps_max) ?? parsed.max,
    weight: num(raw.target_weight ?? raw.weight),
    notes: str(raw.notes),
  };
}

function daysFromJson(raw: unknown): StructuredDay[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // Our own single-workout export (lib/export.ts `workoutToJson`).
  if (Array.isArray(obj.exercises)) {
    const exercises = (obj.exercises as Record<string, unknown>[])
      .map(exerciseFromJson)
      .filter((e): e is StructuredExercise => e !== null);
    if (exercises.length === 0) return null;
    return [day(str(obj.name) ?? 'Workout', str(obj.notes), exercises)];
  }

  // A whole plan: { name, workouts: [...] } or { days: [...] }.
  const list = obj.workouts ?? obj.days;
  if (!Array.isArray(list)) return null;
  const days = list
    .map((entry) => {
      const d = entry as Record<string, unknown>;
      const exercises = (Array.isArray(d.exercises) ? d.exercises : [])
        .map((e) => exerciseFromJson(e as Record<string, unknown>))
        .filter((e): e is StructuredExercise => e !== null);
      if (exercises.length === 0) return null;
      const built = day(str(d.name) ?? 'Workout', str(d.notes), exercises);
      if (Array.isArray(d.weekdays) && d.weekdays.length) {
        const weekdays = (d.weekdays as unknown[])
          .map((n) => int(n))
          .filter((n): n is number => n !== null && n >= 0 && n <= 6);
        return { ...built, weekdays, floating: weekdays.length === 0 };
      }
      return built;
    })
    .filter((d): d is StructuredDay => d !== null);
  return days.length ? days : null;
}

// --- CSV -------------------------------------------------------------------

/** Split a delimited line, honouring double quotes around a field. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      out.push(field.trim());
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field.trim());
  return out;
}

const COLUMNS: Record<string, RegExp> = {
  day: /^(day|workout|routine|split.?day|session)$/i,
  exercise: /^(exercise|exercise.?name|movement|lift|title)$/i,
  sets: /^(sets?|set.?count)$/i,
  reps: /^(reps?|repetitions|rep.?range)$/i,
  weight: /^(weight|load|kg|lbs?|weight.?kg|weight.?lbs?)$/i,
  notes: /^(notes?|comment|description)$/i,
};

function headerMap(cells: string[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  cells.forEach((cell, i) => {
    const name = cell.replace(/^﻿/, '').trim();
    for (const [key, re] of Object.entries(COLUMNS)) {
      if (map[key] === undefined && re.test(name)) map[key] = i;
    }
  });
  // Without a movement column there is no plan here, whatever else it has.
  return map.exercise === undefined ? null : map;
}

function daysFromCsv(text: string): StructuredDay[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delimiter =
    (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? '\t' : ',';
  const map = headerMap(splitDelimited(lines[0], delimiter));
  if (!map) return null;

  const at = (cells: string[], key: string) =>
    map[key] === undefined ? null : (cells[map[key]] ?? null);

  // Preserve the order days first appear in, so the plan reads as written.
  const order: string[] = [];
  const grouped = new Map<string, { label: string; exercises: StructuredExercise[] }>();
  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line, delimiter);
    const name = str(at(cells, 'exercise'));
    if (!name) continue;
    const label = str(at(cells, 'day')) ?? 'Workout';
    const key = label.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, { label, exercises: [] });
      order.push(key);
    }
    const repsCell = at(cells, 'reps');
    const parsed = repsCell ? parseRepRange(repsCell) : { min: null, max: null };
    grouped.get(key)!.exercises.push({
      name,
      sets: int(at(cells, 'sets')),
      reps: parsed.min,
      repsMax: parsed.max,
      weight: num(at(cells, 'weight')),
      notes: str(at(cells, 'notes')),
    });
  }

  const days = order
    .map((key) => grouped.get(key)!)
    .filter((g) => g.exercises.length > 0)
    .map((g) => day(g.label, null, g.exercises));
  return days.length ? days : null;
}

// --- entry point -----------------------------------------------------------

export function parseStructuredPlan(text: string): StructuredPlan | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Looks like JSON but isn't — hand it to the AI rather than guessing.
      return null;
    }
    const root = Array.isArray(parsed) ? { workouts: parsed } : parsed;
    const days = daysFromJson(root);
    if (!days) return null;
    const obj = (Array.isArray(parsed) ? {} : parsed) as Record<string, unknown>;
    return {
      // A single-workout export names the workout, not the plan; the day
      // carries that name, so don't repeat it as the plan's.
      name: Array.isArray(obj.exercises) ? null : str(obj.name),
      notes: str(obj.notes),
      rules: Array.isArray(obj.rules) ? (obj.rules as unknown[]).map(String) : [],
      source: 'json',
      days,
    };
  }

  const days = daysFromCsv(trimmed);
  return days ? { name: null, notes: null, rules: [], source: 'csv', days } : null;
}
