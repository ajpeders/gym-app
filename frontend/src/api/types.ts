// TypeScript types mirroring the gym-app API contract (base path /api).

export type Units = 'kg' | 'lb';
export type AiProvider = 'ollama' | 'claude' | 'openai' | 'on-device';
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
  target_weight_max?: number | null;
  target_duration_seconds?: number | null;
  target_duration_seconds_max?: number | null;
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

/** How a split is scheduled. `rigid` reads the calendar — days claim weekdays,
 * a passed day is missed, done resets weekly. `rolling` is an ordered rotation
 * with no dates: the next day comes from what was last logged, nothing is ever
 * missed, and done means since the cycle last came round. */
export type SplitMode = 'rigid' | 'rolling';

export interface Split {
  id: number;
  owner_id: number;
  name: string;
  mode: SplitMode;
  rules: string[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  workouts: Workout[];
}

export interface SplitInput {
  name?: string;
  mode?: SplitMode;
  rules?: string[];
  notes?: string | null;
  is_active?: boolean;
}

/** A well-known program from the shared library (GET /splits/presets). */
export interface PresetSplit {
  slug: string;
  name: string;
  description: string;
  level: string;
  days_per_week: number;
  mode: SplitMode;
  days: { name: string; exercises: { exercise: string; target_sets: number; target_reps: number; target_reps_max: number | null }[] }[];
}

/** The adopted copy, plus anything the catalog couldn't match. */
export interface AdoptedPreset {
  split: Split;
  unmatched: string[];
}

/** Summary of a plan workout scheduled for today (GET /splits/today). */
export interface TodayWorkout {
  id: string;
  name: string;
  floating: boolean;
  weekdays: number[];
  done_this_week: boolean;
  /** Today's weekday claims this day. */
  scheduled_today: boolean;
  /** Scheduled earlier this week and not done — offerable as a makeup.
   * Rigid splits only: a rolling day was never pinned to a date. */
  missed: boolean;
  /** Rolling splits only: this is where the rotation has got to. */
  up_next: boolean;
  /** Rolling splits only: done since the cycle last came round — the rolling
   * answer to `done_this_week`, which a drifting cycle makes meaningless. */
  done_this_cycle: boolean;
}

/** One plan day the schedule put on a catch-up date. */
export interface CatchupWorkout {
  id: string;
  name: string;
}

/** One bout actually logged on a catch-up date. */
export interface CatchupSession {
  id: string;
  name: string | null;
  exercise_count: number;
}

/** A day of the recent past, bucketed in the client's local timezone. */
export interface CatchupDay {
  /** YYYY-MM-DD, local to this device. */
  date: string;
  /** 0=Sun..6=Sat. */
  weekday: number;
  scheduled: CatchupWorkout[];
  sessions: CatchupSession[];
  logged: boolean;
}

export interface WorkoutExerciseInput {
  exercise_id: string;
  order: number;
  target_sets?: number | null;
  target_reps?: number | null;
  target_reps_max?: number | null;
  target_weight?: number | null;
  target_weight_max?: number | null;
  target_duration_seconds?: number | null;
  target_duration_seconds_max?: number | null;
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
  /** Seconds rested before this set. */
  rest_seconds?: number | null;
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
  target_weight_max?: number | null;
  target_duration_seconds?: number | null;
  target_duration_seconds_max?: number | null;
  /**
   * Server-derived: every working set reached the top of the planned rep
   * range, so the plan's own rule says add weight next time. Recomputed on
   * each response — do not cache it alongside offline sets.
   */
  cleared_rep_range?: boolean;
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
  /** Seconds rested BEFORE this set — recorded on the set that follows the
   * rest, so an offline-queued set carries it in a single write. */
  rest_seconds?: number | null;
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
  /** First-run walkthrough done (or skipped). Lives on the account, not the
   *  device, so a second phone doesn't ask again. */
  onboarded?: boolean;
}

export interface Settings {
  units: Units;
  feature_flags: FeatureFlags;
  ai_provider: AiProvider;
  ai_model: string | null;
  ollama_model?: string | null;
  claude_model?: string | null;
  openai_model?: string | null;
  ollama_url?: string | null;
}

// Write-only API keys are accepted by PATCH /settings (empty string clears)
// but are never returned by GET /settings, so they live only on the write type.
export interface SettingsUpdate extends Partial<Omit<Settings, 'feature_flags'>> {
  claude_api_key?: string;
  openai_api_key?: string;
  // PATCH /settings merges feature_flags into the stored dict rather than
  // replacing it, so sending one flag on its own is correct and doesn't need
  // the caller to echo back the others.
  feature_flags?: Partial<FeatureFlags>;
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
  default: 'ollama' | 'claude' | 'openai';
  /** The user's active provider. */
  provider: string;
  /** Whether the user's active provider is usable right now. */
  configured: boolean;
  /** A hint URL to prefill for Ollama (there is no auto-applied default). */
  suggested_ollama_url: string;
  providers: {
    ollama: OllamaProviderInfo;
    claude: AiProviderInfo;
    openai: AiProviderInfo;
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

export interface AiModelCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface AiModelCheckResult {
  provider: string;
  model: string;
  latency_ms: number;
  verdict: 'recommended' | 'parsing_only' | 'not_suitable';
  summary: string;
  checks: AiModelCheck[];
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
  matched_name?: string | null;
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

/** One already-trained day lifted out of a multi-day paste. */
export interface ParsedDay {
  /** The header verbatim ("Thu - Push", "Jul 30"); null when the notes had none.
   *  Resolving it to a date is the client's job — see lib/day-label.ts. */
  day: string | null;
  items: ParsedItem[];
}

export interface ParseDaysResult {
  provider: string;
  model: string;
  units: string;
  latency_ms: number;
  days: ParsedDay[];
}

// ---- AI workout import (parse a pasted plan into structured workouts) ----

export interface ParsedWorkoutExercise {
  exercise_name: string;
  exercise_id: number | null;
  matched_name: string | null;
  match: ParsedMatch;
  target_sets: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  target_weight: number | null;
  target_weight_max: number | null;
  target_duration_seconds: number | null;
  target_duration_seconds_max: number | null;
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
  /** The plan day this makes up — without it the day stays "missed" forever. */
  source_workout_id?: string | null;
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
  target_weight_max: number | null;
  target_duration_seconds: number | null;
  target_duration_seconds_max: number | null;
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
  height: number | null;
  current_weight: number | null;
  goal_weight: number | null;
  goals: string | null;
  injuries: string[];
  equipment: string | null;
  preferences: string | null;
  notes: string | null;
  session_note: string | null;
  /** Daily nutrition goals, set explicitly by the athlete. */
  calorie_target: number | null;
  protein_target: number | null;
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

/** One exercise's personal records (GET /stats/exercises). Every requested id
 * comes back; never-logged ones have null stats and set_count 0. */
/** One muscle's weekly hard sets against the usual volume landmarks
 * (minimum effective / maximum adaptive / maximum recoverable). */
export interface MuscleCoverage {
  muscle: string;
  weekly_sets: number;
  mev: number;
  mav: number;
  mrv: number;
  status: 'missing' | 'under' | 'productive' | 'over';
}

export interface BalanceRatio {
  name: string;
  left: number;
  right: number;
  /** null when one side has no volume at all — nothing to compare. */
  ratio: number | null;
  balanced: boolean;
}

export interface MuscleReport {
  weeks: number;
  total_hard_sets: number;
  coverage: MuscleCoverage[];
  ratios: BalanceRatio[];
}

export interface TrendPoint {
  date: string;
  e1rm: number | null;
  top_weight: number | null;
  top_reps: number | null;
  tonnage: number;
}

export interface ExerciseTrend {
  exercise_id: number;
  points: TrendPoint[];
  direction: 'up' | 'down' | 'flat';
  best_e1rm: number | null;
  total_tonnage: number;
}

/** What to put on the bar next time, derived from the plan + the last session. */
export interface OverloadSuggestion {
  exercise_id: number;
  exercise_name: string;
  action: 'start' | 'repeat' | 'add_weight' | 'add_reps' | 'add_time';
  weight: number | null;
  reps: number | null;
  duration_seconds: number | null;
  reason: string;
}

export interface ExerciseStats {
  exercise_id: number;
  best_weight: number | null;
  best_weight_reps: number | null;
  best_weight_at: string | null;
  min_weight: number | null;
  max_weight: number | null;
  max_reps: number | null;
  set_count: number;
  last_performed_at: string | null;
}

/** A day inside a split, as sent to the AI split editor. The id is echoed back
 * so a proposal can be matched to real workout rows. */
export interface SplitEditWorkingDay {
  id: number | null;
  name: string;
  weekdays: number[];
  floating: boolean;
}

/** Proposed split shape from POST /ai/edit-split/stream. Nothing is saved
 * until the client PATCHes the split and its workouts. */
export interface SplitEditProposal {
  provider: string;
  model: string;
  latency_ms: number;
  reply: string;
  name: string;
  notes: string | null;
  rules: string[];
  days: SplitEditWorkingDay[];
}

/** One logged intake — a meal, shake, or snack (GET/POST /nutrition). */
/** A common food with its per-unit macros (GET /nutrition/foods). */
export interface Food {
  slug: string;
  name: string;
  category: string;
  /** '100g' / '100ml' for measured foods, 'item' for the ones people count. */
  unit: string;
  calories: number;
  protein: number;
}

/** What to hang on each side of the bar (GET /tools/plates). */
export interface PlateBreakdown {
  target: number;
  bar: number;
  units: Units;
  per_side: number[];
  achievable: number;
  leftover: number;
  below_bar: boolean;
}

export interface WarmupSet {
  weight: number;
  reps: number;
}

export interface OneRepMax {
  estimate: number;
  percentages: Record<string, number>;
}

export interface NutritionEntry {
  id: number;
  owner_id: number;
  eaten_at: string;
  label: string | null;
  calories: number | null;
  protein: number | null;
  created_at: string;
}

export interface NutritionEntryInput {
  label?: string | null;
  calories?: number | null;
  protein?: number | null;
  /** ISO time it was eaten. Omitted -> now. */
  eaten_at?: string;
  /** Pick a food off the shelf and the server fills in the macros for
   * `amount` of it. Anything supplied here still wins. */
  food?: string;
  amount?: number;
}

/** One item parsed from a sentence about food (POST /ai/parse-nutrition). */
export interface ParsedNutritionItem {
  label: string;
  calories: number | null;
  protein: number | null;
}

export interface ParsedNutritionResult {
  provider: string;
  model: string;
  latency_ms: number;
  items: ParsedNutritionItem[];
}
