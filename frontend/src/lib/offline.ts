import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SetInput, Session, SessionSet, Workout } from '@/api/types';

/**
 * Offline support for logging.
 *
 * Sets are the thing you tap 30x a session, usually in a basement with no
 * signal — and losing one is unacceptable. So a logged set is written to device
 * storage FIRST, shown immediately, and pushed to the server in the background
 * with retries. A queued set survives app restarts, dead zones, and API
 * redeploys.
 *
 * The active session is also cached so the screen still renders (with its
 * exercises and previously logged sets) while offline.
 */

const QUEUE_KEY = 'gymapp.offline.setQueue';
const CACHE_KEY = 'gymapp.offline.session';
const IDMAP_KEY = 'gymapp.offline.sessionIds';
const PLANS_KEY = 'gymapp.offline.plans';

interface QueuedBase {
  /** Local-only id; for a set, also the optimistic row's id until it syncs. */
  localId: string;
  /**
   * Sent as Idempotency-Key so a replay the server already committed returns
   * the first answer instead of doing the work twice. Matters most for a
   * replayed start, which would otherwise close the workout you're standing in.
   */
  opId: string;
  sessionId: string;
  createdAt: number;
  /** Failed attempts so far — used to back off and to surface stuck items. */
  attempts: number;
}

export interface QueuedSet extends QueuedBase {
  kind?: 'set'; // optional: entries queued before ops existed have no kind
  weId: string;
  input: SetInput;
}

/**
 * The rest of a session's writes. Sets were queued from the start because you
 * tap them 30x in a basement; these turned out to matter too — losing signal
 * mid-session used to mean you couldn't swap a taken machine or close the
 * workout at all.
 */
export type QueuedOp =
  | QueuedSet
  | (QueuedBase & {
      kind: 'start';
      workoutId?: string | null;
      name?: string | null;
      startedAt: string;
    })
  | (QueuedBase & { kind: 'addExercise'; exerciseId: string })
  | (QueuedBase & { kind: 'swap'; weId: string; exerciseId: string })
  | (QueuedBase & { kind: 'removeExercise'; weId: string })
  | (QueuedBase & { kind: 'removeSet'; weId: string; setId: string })
  | (QueuedBase & { kind: 'finish'; finishedAt: string });

function isSet(op: QueuedOp): op is QueuedSet {
  return op.kind === undefined || op.kind === 'set';
}

let memoryQueue: QueuedOp[] | null = null;

async function readQueue(): Promise<QueuedOp[]> {
  if (memoryQueue) return memoryQueue;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    memoryQueue = raw ? (JSON.parse(raw) as QueuedOp[]) : [];
  } catch {
    memoryQueue = [];
  }
  return memoryQueue;
}

async function writeQueue(q: QueuedOp[]): Promise<void> {
  memoryQueue = q;
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // Storage full / unavailable — the in-memory copy still serves this session.
  }
}

let seq = 0;
function nextLocalId(): string {
  seq += 1;
  return `local-${Date.now()}-${seq}`;
}

/** What a caller supplies; the queue fills in ids, timestamp and attempts. */
export type QueuedOpInput =
  | {
      kind: 'start';
      sessionId: string;
      workoutId?: string | null;
      name?: string | null;
      startedAt: string;
    }
  | { kind: 'addExercise'; sessionId: string; exerciseId: string }
  | { kind: 'swap'; sessionId: string; weId: string; exerciseId: string }
  | { kind: 'removeExercise'; sessionId: string; weId: string }
  | { kind: 'removeSet'; sessionId: string; weId: string; setId: string }
  | { kind: 'finish'; sessionId: string; finishedAt: string };

/** Queue any non-set write. Ordering is preserved, so a finish stays last. */
export async function enqueueOp(op: QueuedOpInput): Promise<void> {
  const localId = nextLocalId();
  const entry = { ...op, localId, opId: localId, createdAt: Date.now(), attempts: 0 } as QueuedOp;
  await writeQueue([...(await readQueue()), entry]);
}

/** Persist a set immediately. Returns the queued entry for optimistic display. */
export async function enqueueSet(
  sessionId: string,
  weId: string,
  input: SetInput,
): Promise<QueuedSet> {
  const localId = nextLocalId();
  const entry: QueuedSet = {
    kind: 'set',
    localId,
    opId: localId,
    sessionId,
    weId,
    input,
    createdAt: Date.now(),
    attempts: 0,
  };
  const q = await readQueue();
  await writeQueue([...q, entry]);
  return entry;
}

export async function pendingSets(sessionId?: string): Promise<QueuedSet[]> {
  const q = (await readQueue()).filter(isSet);
  return sessionId ? q.filter((e) => e.sessionId === sessionId) : q;
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function clearQueue(): Promise<void> {
  await writeQueue([]);
}

/** Remove a single queued set by its local id (user deleted it before it synced). */
export async function dequeueSet(localId: string): Promise<boolean> {
  const q = await readQueue();
  const next = q.filter((e) => e.localId !== localId);
  if (next.length === q.length) return false;
  await writeQueue(next);
  return true;
}

/** Drop queued sets belonging to a session (e.g. it was discarded). */
export async function dropSessionFromQueue(sessionId: string): Promise<void> {
  const q = await readQueue();
  await writeQueue(q.filter((e) => e.sessionId !== sessionId));
}

export interface FlushResult {
  synced: number;
  remaining: number;
}

/**
 * Push queued sets to the server, oldest first. Stops at the first network
 * failure so ordering is preserved and we don't hammer a dead connection.
 * A set the server rejects outright (4xx that isn't auth) is dropped — retrying
 * it forever would block everything behind it.
 */
export async function flushQueue(
  send: (e: QueuedOp) => Promise<void>,
): Promise<FlushResult> {
  const q = await readQueue();
  if (q.length === 0) return { synced: 0, remaining: 0 };

  const remaining: QueuedOp[] = [];
  let synced = 0;
  let stopped = false;

  for (const entry of q) {
    if (stopped) {
      remaining.push(entry);
      continue;
    }
    try {
      await send(entry);
      synced += 1;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      // 4xx (except 401/408/429) means the server will never accept it.
      const permanent =
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        status !== 401 &&
        status !== 408 &&
        status !== 429;
      if (permanent) continue; // drop it
      remaining.push({ ...entry, attempts: entry.attempts + 1 });
      stopped = true; // offline — keep the rest queued in order
    }
  }
  await writeQueue(remaining);
  return { synced, remaining: remaining.length };
}

// --- local session ids (starting a workout with no signal) ---
//
// A session started offline has no server id yet, but the screen, the router,
// the queue and the resume-on-launch path all need to call it something right
// now. So it gets a local id that NEVER changes: rewriting it across all four
// once the server answers is the bug factory this avoids. The server id is
// recorded alongside it and swapped in at the moment of each API call, which
// makes the local id a permanent alias for the session.

let idMap: Record<string, string> | null = null;
// Server id -> local id. The overlay runs synchronously during render and has
// to recognise a row it still knows by its local name, so the reverse lookup
// can't be async.
const aliasByServerId: Record<string, string> = {};

export function isLocalSessionId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('local-sess-');
}

export function newLocalSessionId(): string {
  seq += 1;
  return `local-sess-${Date.now()}-${seq}`;
}

async function readIdMap(): Promise<Record<string, string>> {
  if (idMap) return idMap;
  try {
    const raw = await AsyncStorage.getItem(IDMAP_KEY);
    idMap = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    idMap = {};
  }
  for (const [local, server] of Object.entries(idMap)) aliasByServerId[server] = local;
  return idMap;
}

/** Record the server id a local id turned out to have — a session from an
 * offline start, or one of the exercise rows inside it. */
export async function rememberId(localId: string, serverId: string): Promise<void> {
  const map = { ...(await readIdMap()), [localId]: String(serverId) };
  idMap = map;
  aliasByServerId[String(serverId)] = localId;
  try {
    await AsyncStorage.setItem(IDMAP_KEY, JSON.stringify(map));
  } catch {
    // In-memory still serves this launch; a lost map only costs a re-start.
  }
}

/** The id to actually send to the server. Unmapped ids pass straight through,
 * so this is safe to call on every id everywhere. */
export async function resolveId(id: string): Promise<string> {
  if (typeof id !== 'string' || !id.startsWith('local-')) return id;
  return (await readIdMap())[id] ?? id;
}

/** Map a synced session's exercise rows onto the local ids sets were logged
 * against. The server snapshots the plan in order, so position is the join —
 * without this, every set logged before the start synced would 404 and be
 * dropped, which is the one outcome the offline queue exists to prevent. */
export async function rememberRowIds(localSessionId: string, serverRowIds: string[]): Promise<void> {
  for (const [i, serverId] of serverRowIds.entries()) {
    await rememberId(`local-we-${localSessionId}-${i}`, String(serverId));
  }
}

/** The local id a server row used to be called, if this app run created it. */
export function localAliasFor(serverId: string): string | undefined {
  return aliasByServerId[String(serverId)];
}

// --- plan cache (so a workout can be started with no signal) ---
//
// Starting from a plan day needs that day's exercises and targets. They're
// cached whenever a screen lists them, which is the realistic path: you look at
// Home or your split before you get to the gym, then the signal dies.

export async function cachePlans(workouts: Workout[]): Promise<void> {
  if (workouts.length === 0) return;
  try {
    const raw = await AsyncStorage.getItem(PLANS_KEY);
    const existing = raw ? (JSON.parse(raw) as Record<string, Workout>) : {};
    for (const w of workouts) existing[String(w.id)] = w;
    await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(existing));
  } catch {
    /* best effort */
  }
}

export async function readCachedPlan(workoutId: string): Promise<Workout | null> {
  try {
    const raw = await AsyncStorage.getItem(PLANS_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as Record<string, Workout>)[String(workoutId)] ?? null;
  } catch {
    return null;
  }
}

/**
 * The session to show for a start that hasn't reached the server yet.
 *
 * Built from the cached plan so the screen looks exactly like an online start —
 * same exercises, same targets — rather than an empty shell you have to
 * rebuild by hand in a basement.
 */
export function localSession(
  localId: string,
  input: { workout_id?: string; name?: string; started_at?: string },
  plan: Workout | null,
): Session {
  return {
    id: localId,
    name: input.name ?? plan?.name ?? 'Session',
    source_workout_id: input.workout_id != null ? Number(input.workout_id) : null,
    started_at: input.started_at ?? new Date().toISOString(),
    finished_at: null,
    notes: null,
    exercises: (plan?.exercises ?? []).map((pe, i) => ({
      // Local row ids: sets logged against them queue under these and are
      // re-pointed at the real rows when the start syncs and the session is
      // re-read from the server.
      id: `local-we-${localId}-${i}`,
      exercise_id: String(pe.exercise_id),
      exercise: pe.exercise,
      order: pe.order ?? i,
      notes: pe.notes ?? null,
      target_sets: pe.target_sets ?? null,
      target_reps: pe.target_reps ?? null,
      target_reps_max: pe.target_reps_max ?? null,
      target_weight: pe.target_weight ?? null,
      target_weight_max: pe.target_weight_max ?? null,
      target_duration_seconds: pe.target_duration_seconds ?? null,
      target_duration_seconds_max: pe.target_duration_seconds_max ?? null,
      sets: [],
    })),
  };
}

// --- active session cache (so the screen renders offline) ---

export async function cacheSession(w: Session): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(w));
  } catch {
    /* best effort */
  }
}

export async function readCachedSession(id?: string): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Session;
    return !id || w.id === id ? w : null;
  } catch {
    return null;
  }
}

/** Append one just-logged set to a session immediately (no await, no network). */
export function withPendingSetsSync(w: Session, weId: string, input: SetInput): Session {
  return {
    ...w,
    exercises: w.exercises.map((we) =>
      we.id === weId
        ? {
            ...we,
            sets: [
              ...we.sets,
              {
                id: `local-${Date.now()}-${Math.round(performance.now())}`,
                reps: input.reps ?? null,
                duration_seconds: input.duration_seconds ?? null,
                weight: input.weight ?? null,
                rpe: input.rpe ?? null,
                set_type: input.set_type ?? 'working',
                completed: true,
                notes: input.notes ?? null,
                pending: true,
              },
            ],
          }
        : we,
    ),
  };
}

/**
 * Overlay still-unsynced sets onto a session so the UI shows everything the
 * user logged, whether or not the server has it yet.
 */
export function withPendingSets(w: Session, pending: QueuedSet[]): Session {
  if (pending.length === 0) return w;
  const byWe = new Map<string, QueuedSet[]>();
  for (const p of pending) {
    if (p.sessionId !== w.id && localAliasFor(w.id) !== p.sessionId) continue;
    byWe.set(p.weId, [...(byWe.get(p.weId) ?? []), p]);
  }
  if (byWe.size === 0) return w;

  return {
    ...w,
    exercises: w.exercises.map((we) => {
      // Sets logged before the session's start synced were queued against the
      // row's local id; the server copy calls it something else. Both names
      // have to find their sets or they blink off the screen mid-sync.
      const alias = localAliasFor(we.id);
      const extra = [...(byWe.get(we.id) ?? []), ...(alias ? (byWe.get(alias) ?? []) : [])];
      if (!extra.length) return we;
      const optimistic: SessionSet[] = extra.map((p) => ({
        id: p.localId,
        reps: p.input.reps ?? null,
        duration_seconds: p.input.duration_seconds ?? null,
        weight: p.input.weight ?? null,
        rpe: p.input.rpe ?? null,
        set_type: p.input.set_type ?? 'working',
        completed: true,
        notes: p.input.notes ?? null,
        pending: true,
      }));
      return { ...we, sets: [...we.sets, ...optimistic] };
    }),
  };
}
