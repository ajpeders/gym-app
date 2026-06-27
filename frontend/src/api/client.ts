import { getItem, TOKEN_KEY } from '@/lib/storage';
import type {
  AiModelsResult,
  AiProviders,
  AiTestResult,
  AthleteProfile,
  AuthResponse,
  CheckinResult,
  CoachMessage,
  CoachReply,
  Exercise,
  ExerciseQuery,
  Metric,
  MetricInput,
  Paginated,
  ParseResult,
  ParseRoutineResult,
  Routine,
  RoutineInput,
  Settings,
  SettingsUpdate,
  SetInput,
  StatsSummary,
  User,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from './types';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8000';
export const API_BASE = `${API_URL}/api`;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  // when explicitly false, do not attach the auth header
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = await getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, `Network error: ${(err as Error).message}`);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : undefined) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}

export const api = {
  request,

  // ---- auth ----
  register: (input: { email: string; password: string; display_name: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: input, auth: false }),
  login: (input: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: input, auth: false }),
  me: () => request<User>('/auth/me'),

  // ---- exercises ----
  exercises: (query?: ExerciseQuery) =>
    request<Paginated<Exercise>>('/exercises', { query: query as Query }),
  exercise: (id: string) => request<Exercise>(`/exercises/${id}`),
  createExercise: (input: Partial<Exercise> & { name: string }) =>
    request<Exercise>('/exercises', { method: 'POST', body: input }),
  updateExercise: (id: string, input: Partial<Exercise>) =>
    request<Exercise>(`/exercises/${id}`, { method: 'PATCH', body: input }),
  deleteExercise: (id: string) =>
    request<void>(`/exercises/${id}`, { method: 'DELETE' }),

  // ---- routines ----
  routines: () => request<Routine[]>('/routines'),
  routine: (id: string) => request<Routine>(`/routines/${id}`),
  createRoutine: (input: RoutineInput) =>
    request<Routine>('/routines', { method: 'POST', body: input }),
  updateRoutine: (id: string, input: Partial<RoutineInput>) =>
    request<Routine>(`/routines/${id}`, { method: 'PATCH', body: input }),
  deleteRoutine: (id: string) =>
    request<void>(`/routines/${id}`, { method: 'DELETE' }),

  // ---- workouts ----
  workouts: (query?: { limit?: number; offset?: number }) =>
    request<Paginated<Workout>>('/workouts', { query }),
  workout: (id: string) => request<Workout>(`/workouts/${id}`),
  startWorkout: (input: { routine_id?: string; name?: string }) =>
    request<Workout>('/workouts/start', { method: 'POST', body: input }),
  updateWorkout: (id: string, input: Partial<Pick<Workout, 'name' | 'notes'>>) =>
    request<Workout>(`/workouts/${id}`, { method: 'PATCH', body: input }),
  finishWorkout: (id: string) =>
    request<Workout>(`/workouts/${id}/finish`, { method: 'POST' }),
  deleteWorkout: (id: string) =>
    request<void>(`/workouts/${id}`, { method: 'DELETE' }),
  addWorkoutExercise: (id: string, input: { exercise_id: string; order?: number }) =>
    request<WorkoutExercise>(`/workouts/${id}/exercises`, { method: 'POST', body: input }),
  deleteWorkoutExercise: (id: string, weId: string) =>
    request<void>(`/workouts/${id}/exercises/${weId}`, { method: 'DELETE' }),
  addSet: (id: string, weId: string, input: SetInput) =>
    request<WorkoutSet>(`/workouts/${id}/exercises/${weId}/sets`, {
      method: 'POST',
      body: input,
    }),
  updateSet: (id: string, weId: string, setId: string, input: Partial<SetInput>) =>
    request<WorkoutSet>(`/workouts/${id}/exercises/${weId}/sets/${setId}`, {
      method: 'PATCH',
      body: input,
    }),
  deleteSet: (id: string, weId: string, setId: string) =>
    request<void>(`/workouts/${id}/exercises/${weId}/sets/${setId}`, { method: 'DELETE' }),

  // ---- metrics ----
  metrics: () => request<Metric[]>('/metrics'),
  createMetric: (input: MetricInput) =>
    request<Metric>('/metrics', { method: 'POST', body: input }),
  deleteMetric: (id: string) => request<void>(`/metrics/${id}`, { method: 'DELETE' }),

  // ---- settings ----
  settings: () => request<Settings>('/settings'),
  updateSettings: (input: SettingsUpdate) =>
    request<Settings>('/settings', { method: 'PATCH', body: input }),

  // ---- stats ----
  statsSummary: () => request<StatsSummary>('/stats/summary'),

  // ---- ai (Phase 3) ----
  aiProviders: () => request<AiProviders>('/ai/providers'),
  aiModels: () => request<AiModelsResult>('/ai/models'),
  aiTest: () => request<AiTestResult>('/ai/test', { method: 'POST' }),
  parseSets: (input: { text: string; workout_id?: number }) =>
    request<ParseResult>('/ai/parse-sets', { method: 'POST', body: input }),
  parseRoutine: (text: string): Promise<ParseRoutineResult> =>
    request<ParseRoutineResult>('/ai/parse-routine', { method: 'POST', body: { text } }),

  // ---- athlete profile + coach check-in ----
  getProfile: () => request<AthleteProfile>('/profile'),
  updateProfile: (patch: Partial<AthleteProfile>) =>
    request<AthleteProfile>('/profile', { method: 'PATCH', body: patch }),
  checkIn: (text: string) =>
    request<CheckinResult>('/ai/check-in', { method: 'POST', body: { text } }),

  // ---- coach chat ----
  coachHistory: () => request<{ messages: CoachMessage[] }>('/ai/coach/history'),
  coachSend: (message: string) =>
    request<CoachReply>('/ai/coach', { method: 'POST', body: { message } }),
};
