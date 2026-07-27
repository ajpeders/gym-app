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

// ---- Workout (plan day — a scheduled template owning exercises) ----

export interface WorkoutExercise {
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

export interface Workout {
  id: string;
  name: string;
  notes: string | null;
  split_id?: number | null;
  /** Weekdays this workout is scheduled on (0=Sun..6=Sat). */
  weekdays: number[];
  /** Not pinned to specific weekdays — done whenever it fits. */
  floating: boolean;
  order: number;
  exercises: WorkoutExercise[];
  created_at?: string;
  updated_at?: string;
}

export interface Split {
  id: number;
  owner_id: number;
  name: string;
  rules: string[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  workouts: Workout[];
}

export interface SplitInput {
  name?: string;
  rules?: string[];
  notes?: string | null;
  is_active?: boolean;
}

/** Summary of a plan workout scheduled for today (GET /splits/today). */
export interface TodayWorkout {
  id: string;
  name: string;
  floating: boolean;
  weekdays: number[];
  done_this_week: boolean;
}

export interface WorkoutExerciseInput {
  exercise_id: string;
  order: number;
  target_sets?: number | null;
  target_reps?: number | null;
  target_reps_max?: number | null;
  target_weight?: number | null;
  rest_seconds?: number | null;
  notes?: string | null;
}

export interface WorkoutInput {
  name: string;
  notes?: string | null;
  weekdays?: number[];
  floating?: boolean;
  order?: number;
  split_id?: number | null;
  exercises: WorkoutExerciseInput[];
}

// ---- Session (a logged bout) + its sets ----

export interface SessionSet {
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

export interface SessionExercise {
  id: string;
  exercise_id: string;
  exercise?: Exercise;
  order: number;
  notes?: string | null;
  // Snapshot of the plan workout's targets when this session was started from one.
  target_sets?: number | null;
  target_reps?: number | null;
  target_reps_max?: number | null;
  target_weight?: number | null;
  sets: SessionSet[];
}

export interface Session {
  id: string;
  name: string | null;
  /** The plan workout this session was started from (or null for blank ones). */
  source_workout_id?: number | null;
  started_at: string;
  /** null while in progress; set once the session is finished. */
  finished_at: string | null;
  notes: string | null;
  exercises: SessionExercise[];
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

// ---- AI workout import (parse a pasted plan into structured workouts) ----

export interface ParsedWorkoutExercise {
  exercise_name: string;
  exercise_id: number | null;
  match: ParsedMatch;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  target_weight: number | null;
  notes: string | null;
}

export interface ParsedWorkout {
  name: string;
  notes: string | null;
  rest_day: boolean;
  weekdays: number[];
  floating: boolean;
  optional: boolean;
  exercises: ParsedWorkoutExercise[];
}

export interface ParseWorkoutResult {
  provider: string;
  model: string;
  units: string;
  latency_ms: number;
  name?: string | null;
  notes?: string | null;
  rules?: string[];
  workouts: ParsedWorkout[];
}

// ---- Log a completed session (one-shot, no live session) ----

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

export interface SessionLogInput {
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

// ---- AI workout edit (conversationally edit one plan workout) ----

// The workout as the client currently has it, sent so follow-up edits build on
// the last proposal. Exercises are by name (the model reasons over names).
export interface WorkoutEditWorkingExercise {
  exercise: string;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  target_weight: number | null;
  notes?: string | null;
}

export interface WorkoutEditProposal {
  provider: string;
  model: string;
  units: string;
  latency_ms: number;
  reply: string;
  name: string;
  notes: string | null;
  exercises: ParsedWorkoutExercise[];
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
    exercise?: string;
    exercise_id?: string;
    exercise_name?: string;
    weight: number;
    reps: number | null;
    date?: string | null;
    achieved_at?: string;
  }[];
  volume_by_week: { week: string; volume: number }[];
}
