// TypeScript types mirroring the gym-app API contract (base path /api).

export type Units = 'kg' | 'lb';
export type AiProvider = 'ollama' | 'claude' | 'on-device';
export type SetType = 'working' | 'warmup' | 'drop' | 'failure' | 'normal';

export interface User {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Exercise {
  id: string;
  external_id: string | null;
  name: string;
  category: string | null;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  instructions: string[];
  images: string[]; // full URLs
  is_custom: boolean;
  /** How a set is measured: load x reps, reps only, or a timed hold. */
  tracking_type?: 'weight_reps' | 'bodyweight' | 'time';
  owner_id: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface ExerciseQuery {
  q?: string;
  muscle?: string;
  equipment?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface RoutineExercise {
  id?: string;
  exercise_id: string;
  exercise?: Exercise;
  order: number;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max?: number | null;
  target_weight: number | null;
  rest_seconds: number | null;
  notes?: string | null;
}

export interface Routine {
  id: string;
  name: string;
  notes: string | null;
  split_id?: number | null;
  day_label?: string | null;
  day_order?: number;
  exercises: RoutineExercise[];
  created_at?: string;
  updated_at?: string;
}

export interface ScheduleEntry {
  day: string;
  label?: string | null;
  routine_id?: number | null;
}

export interface Split {
  id: number;
  owner_id: number;
  name: string;
  schedule: ScheduleEntry[];
  rules: string[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  routines: Routine[];
}

export interface SplitInput {
  name?: string;
  schedule?: ScheduleEntry[];
  rules?: string[];
  notes?: string | null;
  is_active?: boolean;
}

export interface RoutineExerciseInput {
  exercise_id: string;
  order: number;
  target_sets?: number | null;
  target_reps?: number | null;
  target_reps_max?: number | null;
  target_weight?: number | null;
  rest_seconds?: number | null;
}

export interface RoutineInput {
  name: string;
  notes?: string | null;
  exercises: RoutineExerciseInput[];
}

export interface WorkoutSet {
  id: string;
  /** null for timed movements. */
  reps: number | null;
  /** null = bodyweight (no external load). */
  weight: number | null;
  rpe: number | null;
  set_type: SetType;
  order?: number;
  completed?: boolean;
  notes?: string | null;
  /** Seconds held, for timed movements. */
  duration_seconds?: number | null;
  /** When the set was performed. */
  completed_at?: string | null;
  /** Client-only: logged locally, not yet pushed to the server. */
  pending?: boolean;
}

export interface WorkoutExercise {
  id: string;
  exercise_id: string;
  exercise?: Exercise;
  order: number;
  notes?: string | null;
  // Snapshot of the routine's targets when this workout was started from one.
  target_sets?: number | null;
  target_reps?: number | null;
  target_reps_max?: number | null;
  target_weight?: number | null;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  name: string | null;
  routine_id: string | null;
  /** The routine this workout was started from (or null for blank workouts). */
  source_routine_id?: number | null;
  status: 'in_progress' | 'completed';
  started_at: string;
  finished_at: string | null;
  notes: string | null;
  exercises: WorkoutExercise[];
}

export interface SetInput {
  /** Omit for timed movements. */
  reps?: number | null;
  /** Omit / null for bodyweight exercises. */
  weight?: number | null;
  rpe?: number | null;
  set_type?: SetType;
  notes?: string | null;
  /** ISO time the set was actually performed (kept accurate across offline sync). */
  completed_at?: string;
  /** Seconds held, for timed movements (plank, dead hang). */
  duration_seconds?: number | null;
}

export interface Metric {
  id: string;
  type: string;
  value: number;
  unit: string | null;
  recorded_at: string;
  notes?: string | null;
}

export interface MetricInput {
  type: string;
  value: number;
  unit?: string | null;
  recorded_at?: string;
  notes?: string | null;
}

export interface FeatureFlags {
  quick_buttons: boolean;
  in_set_prompts: boolean;
}

export interface Settings {
  units: Units;
  feature_flags: FeatureFlags;
  ai_provider: AiProvider;
  ai_model: string | null;
  ollama_model?: string | null;
  claude_model?: string | null;
  ollama_url?: string | null;
}

// Write-only settings patch. `claude_api_key` is accepted by PATCH /settings
// (empty string clears it) but is never returned by GET /settings, so it lives
// here rather than on the read-side `Settings` type.
export interface SettingsUpdate extends Partial<Settings> {
  claude_api_key?: string;
}

// ---- AI (Phase 3) ----

export interface AiProviderInfo {
  configured: boolean;
  model: string;
}

export interface OllamaProviderInfo extends AiProviderInfo {
  url: string | null;
}

export interface AiProviders {
  default: 'ollama' | 'claude';
  /** The user's active provider. */
  provider: string;
  /** Whether the user's active provider is usable right now. */
  configured: boolean;
  /** A hint URL to prefill for Ollama (there is no auto-applied default). */
  suggested_ollama_url: string;
  providers: {
    ollama: OllamaProviderInfo;
    claude: AiProviderInfo;
  };
}

export interface OllamaModel {
  name: string;
  size: string | null;
}

export interface AiModelsResult {
  provider: string;
  url: string;
  current: string;
  models: OllamaModel[];
}

export interface AiTestResult {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms: number;
  sample: string;
}

export type ParsedSetType = 'warmup' | 'working' | 'drop' | 'failure';
export type ParsedMatch = 'exact' | 'fuzzy' | 'none';

export interface ParsedSet {
  reps: number;
  weight: number | null;
  rpe: number | null;
  set_type: ParsedSetType;
}

export interface ParsedItem {
  exercise_name: string;
  exercise_id: number | null;
  match: ParsedMatch;
  sets: ParsedSet[];
  notes: string | null;
}

export interface ParseResult {
  provider: string;
  model: string;
  units: string;
  latency_ms: number;
  items: ParsedItem[];
}

// ---- AI routine import (parse a pasted routine into structured routines) ----

export interface ParsedRoutineExercise {
  exercise_name: string;
  exercise_id: number | null;
  match: ParsedMatch;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  target_weight: number | null;
  notes: string | null;
}

export interface ParsedRoutine {
  name: string;
  notes: string | null;
  rest_day: boolean;
  exercises: ParsedRoutineExercise[];
}

export interface ParseRoutineResult {
  provider: string;
  model: string;
  units: string;
  latency_ms: number;
  routines: ParsedRoutine[];
}

// ---- Log a completed workout (one-shot, no live session) ----

export interface LoggedSetInput {
  reps?: number | null;
  weight?: number | null;
  rpe?: number | null;
  set_type?: string;
}

export interface LoggedExerciseInput {
  exercise_id: string;
  sets: LoggedSetInput[];
}

export interface WorkoutLogInput {
  name?: string | null;
  started_at?: string;
  notes?: string | null;
  exercises: LoggedExerciseInput[];
}

// ---- Progress photos ----

export interface ProgressPhoto {
  id: number;
  owner_id: number;
  taken_at: string;
  notes: string | null;
  created_at: string;
}

// ---- AI routine edit (conversationally edit one routine) ----

// The routine as the client currently has it, sent so follow-up edits build on
// the last proposal. Exercises are by name (the model reasons over names).
export interface RoutineEditWorkingExercise {
  exercise: string;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  target_weight: number | null;
  notes?: string | null;
}

export interface RoutineEditProposal {
  provider: string;
  model: string;
  units: string;
  latency_ms: number;
  reply: string;
  name: string;
  notes: string | null;
  exercises: ParsedRoutineExercise[];
}

// ---- Athlete profile + coach check-in ----

export interface AthleteProfile {
  experience_level: string | null;
  goals: string | null;
  injuries: string[];
  equipment: string | null;
  preferences: string | null;
  notes: string | null;
  session_note: string | null;
}

export interface CheckinResult {
  provider: string;
  model: string;
  latency_ms: number;
  acknowledgement: string;
  profile: AthleteProfile;
}

// ---- Coach chat ----

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface CoachReply {
  provider: string;
  model: string;
  latency_ms: number;
  reply: string;
}

export interface StatsSummary {
  total_workouts: number;
  this_week: number;
  streak?: number;
  recent_prs: {
    exercise_id: string;
    exercise_name?: string;
    weight: number;
    reps: number;
    achieved_at?: string;
  }[];
  volume_by_week: { week: string; volume: number }[];
}
