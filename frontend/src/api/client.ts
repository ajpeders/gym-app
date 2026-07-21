import { fetch as expoFetch } from 'expo/fetch';

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
  ProgressPhoto,
  Routine,
  RoutineEditProposal,
  RoutineEditWorkingExercise,
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
  // abort the request after this many ms (used to bound slow AI calls so they
  // fail with a clear "took too long" instead of an ambiguous network error or
  // an endless spinner). Omit for no client-side timeout.
  timeoutMs?: number;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, timeoutMs } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = await getItem(TOKEN_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = timeoutMs ? new AbortController() : undefined;
  const timer =
    controller && timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
  } catch (err) {
    // AbortController.abort() surfaces as an AbortError — report it as a
    // timeout (408) so the UI can say "took too long" rather than "offline".
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(408, 'The request took too long — try again.');
    }
    throw new ApiError(0, `Network error: ${(err as Error).message}`);
  } finally {
    if (timer) clearTimeout(timer);
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

export interface ParseProgressInfo {
  /** Total characters of model output received so far. */
  received: number;
}

// Parse one SSE block ("event: X\ndata: {...}") into [event, data].
function parseSseBlock(raw: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

// Stream the routine parse over SSE so a slow (10–30s) generation keeps the
// connection alive and can report real progress, instead of a single long
// blocking request that a mobile client may drop. Falls back to reading the
// whole body if the platform can't expose a streaming reader.
async function parseRoutineStream(
  text: string,
  onProgress?: (info: ParseProgressInfo) => void,
): Promise<ParseRoutineResult> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const token = await getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    let res: Awaited<ReturnType<typeof expoFetch>>;
    try {
      res = await expoFetch(`${API_BASE}/ai/parse-routine/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(408, 'The request took too long — try again.');
      }
      throw new ApiError(0, `Network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiError(res.status, `Request failed (${res.status})`, body);
    }

    let result: ParseRoutineResult | null = null;
    let errorDetail: string | null = null;

    const handleBlock = (raw: string) => {
      const parsed = parseSseBlock(raw);
      if (!parsed) return;
      if (parsed.event === 'progress') {
        onProgress?.({ received: (parsed.data as ParseProgressInfo).received ?? 0 });
      } else if (parsed.event === 'result') {
        result = parsed.data as ParseRoutineResult;
      } else if (parsed.event === 'error') {
        errorDetail = (parsed.data as { detail?: string }).detail ?? 'Failed to parse.';
      }
    };

    let buffer = '';
    const drain = (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block.trim()) handleBlock(block);
      }
    };

    const reader = res.body?.getReader?.();
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        drain(decoder.decode(value, { stream: true }));
      }
    } else {
      // No streaming reader on this platform — the full SSE body still holds
      // every event, including the final result.
      drain(await res.text());
    }
    if (buffer.trim()) handleBlock(buffer);

    if (errorDetail) throw new ApiError(502, errorDetail);
    if (!result) throw new ApiError(0, 'The stream ended without a result.');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export interface RoutineEditInput {
  instruction: string;
  name: string;
  notes: string | null;
  exercises: RoutineEditWorkingExercise[];
}

// Conversationally edit ONE routine over SSE. Mirrors parseRoutineStream: the
// model can take 10–30s on a local model, so streaming keeps a mobile
// connection alive and reports progress. Returns the proposed routine; nothing
// is saved until the caller PATCHes the routine.
async function editRoutineStream(
  input: RoutineEditInput,
  onProgress?: (info: ParseProgressInfo) => void,
): Promise<RoutineEditProposal> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const token = await getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    let res: Awaited<ReturnType<typeof expoFetch>>;
    try {
      res = await expoFetch(`${API_BASE}/ai/edit-routine/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(408, 'The request took too long — try again.');
      }
      throw new ApiError(0, `Network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiError(res.status, `Request failed (${res.status})`, body);
    }

    let result: RoutineEditProposal | null = null;
    let errorDetail: string | null = null;

    const handleBlock = (raw: string) => {
      const parsed = parseSseBlock(raw);
      if (!parsed) return;
      if (parsed.event === 'progress') {
        onProgress?.({ received: (parsed.data as ParseProgressInfo).received ?? 0 });
      } else if (parsed.event === 'result') {
        result = parsed.data as RoutineEditProposal;
      } else if (parsed.event === 'error') {
        errorDetail = (parsed.data as { detail?: string }).detail ?? 'Failed to edit.';
      }
    };

    let buffer = '';
    const drain = (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block.trim()) handleBlock(block);
      }
    };

    const reader = res.body?.getReader?.();
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        drain(decoder.decode(value, { stream: true }));
      }
    } else {
      drain(await res.text());
    }
    if (buffer.trim()) handleBlock(buffer);

    if (errorDetail) throw new ApiError(502, errorDetail);
    if (!result) throw new ApiError(0, 'The stream ended without a result.');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProgressPhotoUpload {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  takenAt?: string;
  notes?: string;
}

// Multipart upload of a progress photo. Goes outside `request` because it sends
// FormData (a local file reference), not JSON — the platform sets the multipart
// boundary Content-Type itself.
async function uploadProgressPhoto(input: ProgressPhotoUpload): Promise<ProgressPhoto> {
  const form = new FormData();
  const mime = input.mimeType || 'image/jpeg';
  const name = input.fileName || `photo.${mime.split('/')[1] ?? 'jpg'}`;
  // RN FormData accepts this {uri,name,type} shape for a file part.
  form.append('file', { uri: input.uri, name, type: mime } as unknown as Blob);
  if (input.takenAt) form.append('taken_at', input.takenAt);
  if (input.notes) form.append('notes', input.notes);

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = await getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/progress-photos`, { method: 'POST', headers, body: form });
  } catch (err) {
    throw new ApiError(0, `Network error: ${(err as Error).message}`);
  }
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `Upload failed (${res.status})`;
    throw new ApiError(res.status, detail, parsed);
  }
  return parsed as ProgressPhoto;
}

// Source for <Image> that carries the bearer token (the image endpoint is
// auth'd). expo-image supports per-request headers on the source.
async function progressPhotoImageSource(id: number): Promise<{ uri: string; headers: Record<string, string> }> {
  const token = await getItem(TOKEN_KEY);
  return {
    uri: `${API_BASE}/progress-photos/${id}/image`,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

// ---- companion (tool-calling coach) ----

export interface CompanionMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: { id: string; name: string; arguments: unknown }[];
  tool_call_id?: string;
}

export type CompanionEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown; access: 'read' | 'write' }
  | { type: 'tool_result'; id: string; name: string; result: string }
  | { type: 'confirm'; id: string; name: string; arguments: unknown; messages: CompanionMessage[] }
  | { type: 'done'; pending?: boolean; truncated?: boolean }
  | { type: 'error'; error: string };

// Stream a companion chat turn. Emits events (text / tool_call / tool_result /
// confirm / done / error) as they arrive. `approvals` resumes a paused write
// (pass the messages the `confirm` event returned + {callId: true}).
async function companionChat(
  messages: CompanionMessage[],
  onEvent: (ev: CompanionEvent) => void,
  approvals?: Record<string, boolean>,
): Promise<void> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const token = await getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);

  try {
    let res: Awaited<ReturnType<typeof expoFetch>>;
    try {
      res = await expoFetch(`${API_BASE}/companion/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages, approvals: approvals ?? {} }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(408, 'The request took too long — try again.');
      }
      throw new ApiError(0, `Network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail: string | undefined;
      try {
        detail = JSON.parse(body).detail;
      } catch {
        /* non-JSON body */
      }
      throw new ApiError(res.status, detail ?? `Request failed (${res.status})`, body);
    }

    // companion emits `data: {json}\n\n` blocks (event type is inside the JSON).
    const handleBlock = (raw: string) => {
      const line = raw.split('\n').find((l) => l.startsWith('data:'));
      if (!line) return;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as CompanionEvent);
      } catch {
        /* skip malformed block */
      }
    };

    let buffer = '';
    const drain = (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block.trim()) handleBlock(block);
      }
    };

    const reader = res.body?.getReader?.();
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        drain(decoder.decode(value, { stream: true }));
      }
    } else {
      drain(await res.text());
    }
    if (buffer.trim()) handleBlock(buffer);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  request,
  parseRoutineStream,
  editRoutineStream,
  companionChat,

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
  startWorkout: (input: { routine_id?: string; name?: string; started_at?: string }) =>
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

  // ---- progress photos ----
  progressPhotos: () => request<ProgressPhoto[]>('/progress-photos'),
  uploadProgressPhoto,
  progressPhotoImageSource,
  deleteProgressPhoto: (id: number) =>
    request<void>(`/progress-photos/${id}`, { method: 'DELETE' }),

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
    request<ParseResult>('/ai/parse-sets', {
      method: 'POST',
      body: input,
      timeoutMs: 90_000,
    }),
  parseRoutine: (text: string): Promise<ParseRoutineResult> =>
    request<ParseRoutineResult>('/ai/parse-routine', {
      method: 'POST',
      body: { text },
      timeoutMs: 120_000,
    }),

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
