import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SetInput, Session, SessionSet } from '@/api/types';

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
    if (p.sessionId !== w.id) continue;
    byWe.set(p.weId, [...(byWe.get(p.weId) ?? []), p]);
  }
  if (byWe.size === 0) return w;

  return {
    ...w,
    exercises: w.exercises.map((we) => {
      const extra = byWe.get(we.id);
      if (!extra?.length) return we;
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
