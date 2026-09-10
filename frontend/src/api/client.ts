import { fetch as expoFetch } from 'expo/fetch';

import { getItem, TOKEN_KEY } from '@/lib/storage';
import type {
  AiModelsResult,
  AiModelCheckResult,
  AiProviders,
  AiTestResult,
  AthleteProfile,
  AuthResponse,
  CatchupDay,
  CheckinResult,
  CoachMessage,
  CoachReply,
  Exercise,
  ExerciseMatch,
  ExerciseQuery,
  Metric,
  MetricInput,
  Paginated,
  ParseDaysResult,
  ParseResult,
  ParseWorkoutResult,
  ProgressPhoto,
  Session,
  SessionExercise,
  SessionLogInput,
  SessionSet,
  Split,
  SplitImportInput,
  SplitImportResult,
  SplitInput,
  Settings,
  SettingsUpdate,
  SetInput,
  Units,
  Achievement,
  AdminOverview,
  AdminUser,
  AdoptedPreset,
  AiHealth,
  ClientErrorReport,
  ExerciseStats,
  Food,
  OneRepMax,
  PlateBreakdown,
  ReadinessCheck,
  WarmupSet,
  ExerciseTrend,
  PresetSplit,
  MuscleReport,
  OverloadSuggestion,
  NutritionEntry,
  NutritionEntryInput,
  ParsedNutritionResult,
  StatsSummary,
  TodayWorkout,
  User,
  Workout,
  SplitEditProposal,
  SplitEditWorkingDay,
  WorkoutEditProposal,
  WorkoutEditWorkingExercise,
  WorkoutInput,
} from './types';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8000';
export const API_BASE = `${API_URL}/api`;

// Catalog images are stored as server-relative paths ("/api/exercise-media/…")
// so they work across dev/prod; external URLs (legacy free-exercise-db) pass
// through untouched. Resolves against the configured API host.
export function resolveMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

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

type QueryValue = string | number | boolean | undefined | null;
type Query = Record<string, QueryValue | QueryValue[]>;

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  const append = (key: string, value: QueryValue) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  };
  for (const [key, value] of Object.entries(query)) {
    // An array becomes repeated params (?id=1&id=2) — what FastAPI's
    // list-valued Query() expects; joining them would arrive as one string.
    if (Array.isArray(value)) {
      for (const item of value) append(key, item);
    } else {
      append(key, value);
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
  // Makes a write safe for the offline queue to replay: the server returns the
  // first response instead of doing the work twice. See api/app/idempotency.py.
  idempotencyKey?: string;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, timeoutMs, idempotencyKey } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
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
async function parseWorkoutStream(
  text: string,
  onProgress?: (info: ParseProgressInfo) => void,
): Promise<ParseWorkoutResult> {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  };
  const token = await getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  // Local Ollama can spend a while evaluating a full program before it emits
  // its first token. Keep the client aligned with the API's five-minute limit.
  const timer = setTimeout(() => controller.abort(), 300_000);

  try {
    let res: Awaited<ReturnType<typeof expoFetch>>;
    try {
      res = await expoFetch(`${API_BASE}/ai/parse-workout/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(408, 'The import took longer than five minutes — try again.');
      }
      throw new ApiError(0, `Network error: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiError(res.status, `Request failed (${res.status})`, body);
    }

    let result: ParseWorkoutResult | null = null;
    let errorDetail: string | null = null;

    const handleBlock = (raw: string) => {
      const parsed = parseSseBlock(raw);
      if (!parsed) return;
      if (parsed.event === 'progress') {
        onProgress?.({ received: (parsed.data as ParseProgressInfo).received ?? 0 });
      } else if (parsed.event === 'result') {
        result = parsed.data as ParseWorkoutResult;
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

export interface WorkoutEditInput {
  instruction: string;
  name: string;
  notes: string | null;
  exercises: WorkoutEditWorkingExercise[];
}

// Shared SSE POST used by the conversational AI editors. The model can take
// 10-30s locally, so streaming keeps a mobile connection alive and reports
// progress. Returns the proposal; nothing is saved until the caller PATCHes.
async function postSseStream<T>(
  path: string,
  input: unknown,
  onProgress?: (info: ParseProgressInfo) => void,
): Promise<T> {
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
      res = await expoFetch(`${API_BASE}${path}`, {
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

    let result: T | null = null;
    let errorDetail: string | null = null;

    const handleBlock = (raw: string) => {
      const parsed = parseSseBlock(raw);
      if (!parsed) return;
      if (parsed.event === 'progress') {
        onProgress?.({ received: (parsed.data as ParseProgressInfo).received ?? 0 });
      } else if (parsed.event === 'result') {
        result = parsed.data as T;
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

// Conversationally edit ONE plan workout (its exercises and targets).
function editWorkoutStream(
  input: WorkoutEditInput,
  onProgress?: (info: ParseProgressInfo) => void,
): Promise<WorkoutEditProposal> {
  return postSseStream<WorkoutEditProposal>('/ai/edit-workout/stream', input, onProgress);
}

export interface SplitEditInput {
  instruction: string;
  name: string;
  notes: string | null;
  rules: string[];
  days: SplitEditWorkingDay[];
}

// Conversationally edit ONE split's shape: name, notes, progression rules, and
// which day sits on which weekday. Exercises inside a day stay with
// editWorkoutStream.
function editSplitStream(
  input: SplitEditInput,
  onProgress?: (info: ParseProgressInfo) => void,
): Promise<SplitEditProposal> {
  return postSseStream<SplitEditProposal>('/ai/edit-split/stream', input, onProgress);
}

export interface ProgressPhotoUpload {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  takenAt?: string;
  notes?: string;
}

/** A local file picked on the device, in the {uri,name,type} shape RN FormData wants. */
interface PickedFile {
  uri: string;
  // expo-image-picker hands back `null` for an asset it can't name or type.
  mimeType?: string | null;
  fileName?: string | null;
}

// Multipart POST. Goes outside `request` because it sends FormData (a local
// file reference), not JSON — the platform sets the multipart boundary
// Content-Type itself, so we must not set it here.
async function postFile<T>(
  path: string,
  file: PickedFile,
  fields: Record<string, string | undefined> = {},
): Promise<T> {
  const form = new FormData();
  const mime = file.mimeType || 'image/jpeg';
  const name = file.fileName || `upload.${mime.split('/')[1] ?? 'jpg'}`;
  form.append('file', { uri: file.uri, name, type: mime } as unknown as Blob);
  for (const [key, value] of Object.entries(fields)) {
    if (value) form.append(key, value);
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = await getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: form });
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
  return parsed as T;
}

function uploadProgressPhoto(input: ProgressPhotoUpload): Promise<ProgressPhoto> {
  return postFile<ProgressPhoto>('/progress-photos', input, {
    taken_at: input.takenAt,
    notes: input.notes,
  });
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
  parseWorkoutStream,
  editWorkoutStream,
  editSplitStream,
  companionChat,

  // ---- auth ----
  register: (input: { email: string; password: string; display_name: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: input, auth: false }),
  login: (input: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: input, auth: false }),
  me: () => request<User>('/auth/me'),
  // Which social sign-ins this server can complete. Empty on an install with
  // no client ids, which is the default.
  socialProviders: () => request<{ providers: string[] }>('/auth/providers', { auth: false }),
  oauthLogin: (provider: string, token: string) =>
    request<AuthResponse>(`/auth/oauth/${provider}`, {
      method: 'POST',
      body: { token },
      auth: false,
    }),

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
  /** Give one of your own exercises a picture. Replaces any previous one. */
  uploadExerciseImage: (id: string, file: PickedFile) =>
    postFile<Exercise>(`/exercises/${id}/image`, file),
  deleteExerciseImage: (id: string) =>
    request<Exercise>(`/exercises/${id}/image`, { method: 'DELETE' }),

  /**
   * Resolve movement names against the catalog with no model involved — the
   * same matcher the AI import uses, on its own. Lets a CSV or JSON plan
   * import on an account that has no AI provider set up.
   */
  matchExercises: (names: string[]) =>
    request<ExerciseMatch[]>('/exercises/match', { method: 'POST', body: { names } }),

  // ---- splits (weekly plans) ----
  splits: () => request<Split[]>('/splits'),
  split: (id: string) => request<Split>(`/splits/${id}`),
  splitToday: () => request<TodayWorkout[]>('/splits/today'),
  // tz_offset lets the server bucket sessions by *this device's* calendar day;
  // it stores naive UTC and tracks no per-user timezone.
  splitCatchup: (days = 14) =>
    request<CatchupDay[]>('/splits/catchup', {
      query: { days, tz_offset: new Date().getTimezoneOffset() },
    }),
  createSplit: (input: SplitInput) =>
    request<Split>('/splits', { method: 'POST', body: input }),
  updateSplit: (id: string, input: SplitInput) =>
    request<Split>(`/splits/${id}`, { method: 'PATCH', body: input }),
  deleteSplit: (id: string) => request<void>(`/splits/${id}`, { method: 'DELETE' }),
  /**
   * Apply a whole reviewed plan in one transaction.
   *
   * The alternative — create the split, then each workout, then each custom
   * exercise, from here — could fail halfway and leave a half-built plan that
   * "try again" then built a second copy of. `idempotencyKey` is what makes the
   * retry safe: same reviewed content replays the first answer.
   */
  importSplit: (input: SplitImportInput, idempotencyKey?: string) =>
    request<SplitImportResult>('/splits/import', {
      method: 'POST',
      body: input,
      idempotencyKey,
    }),

  // ---- workouts (plan days) ----
  workouts: () => request<Workout[]>('/workouts'),
  workout: (id: string) => request<Workout>(`/workouts/${id}`),
  createWorkout: (input: WorkoutInput) =>
    request<Workout>('/workouts', { method: 'POST', body: input }),
  updateWorkout: (id: string, input: Partial<WorkoutInput>) =>
    request<Workout>(`/workouts/${id}`, { method: 'PATCH', body: input }),
  deleteWorkout: (id: string) =>
    request<void>(`/workouts/${id}`, { method: 'DELETE' }),

  // ---- sessions (logged bouts) ----
  sessions: (query?: { limit?: number; offset?: number }) =>
    request<Paginated<Session>>('/sessions', { query }),
  session: (id: string) => request<Session>(`/sessions/${id}`),
  // The session in progress, or null. Finds one this device doesn't remember.
  activeSession: () => request<Session | null>('/sessions/active'),
  // The idempotency key matters most here: a replayed start would otherwise
  // close the session you're standing in and open a second one.
  startSession: (
    input: { workout_id?: string; name?: string; started_at?: string },
    idempotencyKey?: string,
  ) => request<Session>('/sessions/start', { method: 'POST', body: input, idempotencyKey }),
  logSession: (input: SessionLogInput) =>
    request<Session>('/sessions/log', { method: 'POST', body: input }),
  updateSession: (id: string, input: Partial<Pick<Session, 'name' | 'notes'>>) =>
    request<Session>(`/sessions/${id}`, { method: 'PATCH', body: input }),
  // finishedAt lets a finish queued in a dead zone carry the time it actually
  // happened, instead of the moment the queue drained.
  finishSession: (id: string, finishedAt?: string) =>
    request<Session>(`/sessions/${id}/finish`, {
      method: 'POST',
      body: finishedAt ? { finished_at: finishedAt } : {},
    }),
  deleteSession: (id: string) =>
    request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  addSessionExercise: (
    id: string,
    input: { exercise_id: string; order?: number },
    idempotencyKey?: string,
  ) =>
    request<SessionExercise>(`/sessions/${id}/exercises`, {
      method: 'POST',
      body: input,
      idempotencyKey,
    }),
  deleteSessionExercise: (id: string, weId: string) =>
    request<void>(`/sessions/${id}/exercises/${weId}`, { method: 'DELETE' }),
  // Swap which movement a logged row is for, keeping its sets — the machine
  // was taken, the work still happened.
  swapSessionExercise: (id: string, weId: string, exerciseId: string) =>
    request<SessionExercise>(`/sessions/${id}/exercises/${weId}`, {
      method: 'PATCH',
      body: { exercise_id: exerciseId },
    }),
  addSet: (id: string, weId: string, input: SetInput, idempotencyKey?: string) =>
    request<SessionSet>(`/sessions/${id}/exercises/${weId}/sets`, {
      method: 'POST',
      body: input,
      idempotencyKey,
    }),
  updateSet: (id: string, weId: string, setId: string, input: Partial<SetInput>) =>
    request<SessionSet>(`/sessions/${id}/exercises/${weId}/sets/${setId}`, {
      method: 'PATCH',
      body: input,
    }),
  deleteSet: (id: string, weId: string, setId: string) =>
    request<void>(`/sessions/${id}/exercises/${weId}/sets/${setId}`, { method: 'DELETE' }),

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
  deleteMetric: (id: number) => request<void>(`/metrics/${id}`, { method: 'DELETE' }),

  // ---- account ----
  /** Everything this account owns, as one JSON document. */
  exportAccount: () => request<Record<string, unknown>>('/auth/me/export'),

  // ---- settings ----
  settings: () => request<Settings>('/settings'),
  updateSettings: (input: SettingsUpdate) =>
    request<Settings>('/settings', { method: 'PATCH', body: input }),

  // ---- nutrition (calorie / protein log) ----
  nutrition: (days = 14) => request<NutritionEntry[]>('/nutrition', { query: { days } }),
  createNutrition: (input: NutritionEntryInput) =>
    request<NutritionEntry>('/nutrition', { method: 'POST', body: input }),
  updateNutrition: (id: string, input: NutritionEntryInput) =>
    request<NutritionEntry>(`/nutrition/${id}`, { method: 'PATCH', body: input }),
  deleteNutrition: (id: string) => request<void>(`/nutrition/${id}`, { method: 'DELETE' }),
  parseNutrition: (text: string) =>
    request<ParsedNutritionResult>('/ai/parse-nutrition', { method: 'POST', body: { text } }),

  // ---- stats ----
  statsSummary: () => request<StatsSummary>('/stats/summary'),
  adminOverview: () => request<AdminOverview>('/admin/overview'),
  adminUsers: () => request<AdminUser[]>('/admin/users'),
  adminResetPassword: (userId: number, password: string) =>
    request<void>(`/admin/users/${userId}/password`, { method: 'POST', body: { password } }),
  adminDeleteUser: (userId: number) =>
    request<void>(`/admin/users/${userId}`, { method: 'DELETE' }),
  adminErrors: () => request<ClientErrorReport[]>('/admin/errors'),
  adminAiHealth: () => request<AiHealth>('/admin/ai'),
  foods: (q = '') => request<Food[]>('/nutrition/foods', { query: { q } }),
  plateBreakdown: (target: number, units: Units, bar?: number) =>
    request<PlateBreakdown>('/tools/plates', { query: { target, units, ...(bar != null ? { bar } : {}) } }),
  warmupSets: (weight: number, units: Units, bar?: number) =>
    request<WarmupSet[]>('/tools/warmup', { query: { weight, units, ...(bar != null ? { bar } : {}) } }),
  oneRepMax: (weight: number, reps: number) =>
    request<OneRepMax>('/tools/one-rep-max', { query: { weight, reps } }),
  presetSplits: () => request<PresetSplit[]>('/splits/presets'),
  adoptPreset: (slug: string) =>
    request<AdoptedPreset>(`/splits/presets/${slug}/adopt`, { method: 'POST' }),
  readiness: () => request<ReadinessCheck[]>('/readiness'),
  // Named for what it records, not for the verb — `checkIn` is already the AI
  // profile check-in, which is a different thing entirely.
  recordReadiness: (input: {
    sleep_hours?: number | null;
    soreness?: number | null;
    energy?: number | null;
  }) => request<ReadinessCheck>('/readiness', { method: 'POST', body: input }),
  achievements: () => request<Achievement[]>('/stats/achievements'),
  muscleReport: (weeks = 4) => request<MuscleReport>('/stats/muscles', { query: { weeks } }),
  exerciseTrend: (exerciseId: string, days = 180) =>
    request<ExerciseTrend>(`/stats/exercises/${exerciseId}/trend`, { query: { days } }),
  workoutSuggestions: (workoutId: string) =>
    request<OverloadSuggestion[]>(`/workouts/${workoutId}/suggestions`),
  exerciseStats: (exerciseIds: string[]) =>
    exerciseIds.length === 0
      ? Promise.resolve([] as ExerciseStats[])
      : request<ExerciseStats[]>('/stats/exercises', {
          query: { exercise_ids: exerciseIds },
        }),

  // ---- ai (Phase 3) ----
  aiProviders: () => request<AiProviders>('/ai/providers'),
  aiModels: () => request<AiModelsResult>('/ai/models'),
  aiTest: () => request<AiTestResult>('/ai/test', { method: 'POST' }),
  aiCheckModel: () =>
    request<AiModelCheckResult>('/ai/check-model', { method: 'POST', timeoutMs: 180_000 }),
  // NB: the request field is `workout_id` but its value is the active SESSION's
  // id (the backend field name is unchanged from the rename).
  parseSets: (input: { text: string; workout_id?: number }) =>
    request<ParseResult>('/ai/parse-sets', {
      method: 'POST',
      body: input,
      timeoutMs: 90_000,
    }),
  // Multi-day paste for catching up: one group of sets per trained day.
  parseDays: (text: string) =>
    request<ParseDaysResult>('/ai/parse-days', {
      method: 'POST',
      body: { text },
      timeoutMs: 180_000,
    }),
  // A program written from a description rather than pasted. Same shape as a
  // parse, so it goes through the same review before anything is saved.
  // A question about one movement, answered from that exercise's catalog entry.
  exerciseQa: (exerciseId: string, question: string) =>
    request<{
      answer: string;
      exercise_id: number;
      exercise_name: string;
      grounded: boolean;
      provider: string;
      model: string;
      latency_ms: number;
    }>('/ai/exercise-qa', {
      method: 'POST',
      body: { exercise_id: Number(exerciseId), question },
      timeoutMs: 120_000,
    }),
  // A Hevy or Strong export, read deterministically (no model involved).
  importCsv: (csv: string) =>
    request<{ format: string; sessions_created: number; sets_imported: number; unmatched: string[] }>(
      '/sessions/import-csv',
      { method: 'POST', body: { csv } },
    ),
  exportCsvUrl: () => `${API_BASE}/sessions/export.csv`,
  // Not wired to any screen: the import screen sends people to the presets
  // shelf instead. Kept so re-enabling AI program generation is a UI change,
  // not a rewrite — see ROADMAP, "AI writes a program".
  generateProgram: (input: {
    goal?: string;
    days_per_week?: number;
    experience?: string;
    equipment?: string;
  }): Promise<ParseWorkoutResult> =>
    request<ParseWorkoutResult>('/ai/generate-program', {
      method: 'POST',
      body: input,
      // Local models take their time writing a whole program.
      timeoutMs: 300_000,
    }),
  parseWorkout: (text: string): Promise<ParseWorkoutResult> =>
    request<ParseWorkoutResult>('/ai/parse-workout', {
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
