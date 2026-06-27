// TypeScript types mirroring the gym-app API contract (base path /api).

export type Units = 'kg' | 'lb';
export type AiProvider = 'ollama' | 'claude' | 'on-device';
export type SetType = 'normal' | 'warmup' | 'drop' | 'failure';

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
  target_weight: number | null;
  rest_seconds: number | null;
}

export interface Routine {
  id: string;
  name: string;
  notes: string | null;
  exercises: RoutineExercise[];
  created_at?: string;
  updated_at?: string;
}

export interface RoutineExerciseInput {
  exercise_id: string;
  order: number;
  target_sets?: number | null;
  target_reps?: number | null;
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
  reps: number;
  weight: number;
  rpe: number | null;
  set_type: SetType;
  order?: number;
  completed?: boolean;
}

export interface WorkoutExercise {
  id: string;
  exercise_id: string;
  exercise?: Exercise;
  order: number;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  name: string | null;
  routine_id: string | null;
  status: 'in_progress' | 'completed';
  started_at: string;
  finished_at: string | null;
  notes: string | null;
  exercises: WorkoutExercise[];
}

export interface SetInput {
  reps: number;
  weight: number;
  rpe?: number | null;
  set_type?: SetType;
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
  rest_timer_default: number;
}

// ---- AI (Phase 3) ----

export interface AiProviderInfo {
  configured: boolean;
  model: string;
}

export interface AiProviders {
  default: 'ollama' | 'claude';
  providers: {
    ollama: AiProviderInfo;
    claude: AiProviderInfo;
  };
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
  recent_prs: {
    exercise_id: string;
    exercise_name?: string;
    weight: number;
    reps: number;
    achieved_at?: string;
  }[];
  volume_by_week: { week: string; volume: number }[];
}
