/**
 * The offline queue is the one piece of frontend logic that can silently lose
 * a user's work, which is why it's the first thing here to get tests.
 *
 * The invariant under test throughout: a write made with no signal is never
 * dropped and never lands on the wrong row. Starting a session offline makes
 * that harder — the session and its exercise rows have local ids for a while,
 * and every queued write behind the start points at them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// AsyncStorage is the only device dependency in this module.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

import type { QueuedOp } from './offline';

const offline = await import('./offline');
const {
  clearQueue,
  enqueueOp,
  enqueueSet,
  flushQueue,
  isLocalSessionId,
  localSession,
  newLocalSessionId,
  pendingCount,
  pendingSets,
  rememberId,
  localAliasFor,
  rememberRowIds,
  resolveId,
  withPendingSets,
} = offline;

beforeEach(async () => {
  store.clear();
  await clearQueue();
});

function plan(exerciseIds: number[]) {
  return {
    id: '5',
    name: 'Push',
    notes: null,
    weekdays: [1],
    floating: false,
    order: 0,
    exercises: exerciseIds.map((exercise_id, i) => ({
      id: `we-${i}`,
      exercise_id: String(exercise_id),
      order: i,
      target_sets: 3,
      target_reps: 8,
      sets: [],
    })),
  } as never;
}

describe('local session ids', () => {
  it('are recognisable and unique', () => {
    const a = newLocalSessionId();
    const b = newLocalSessionId();
    expect(isLocalSessionId(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isLocalSessionId('42')).toBe(false);
  });

  it('pass server ids through untouched', async () => {
    await expect(resolveId('42')).resolves.toBe('42');
  });

  it('resolve to the server id once the start has synced', async () => {
    const local = newLocalSessionId();
    expect(await resolveId(local)).toBe(local); // nothing to map to yet
    await rememberId(local, '77');
    expect(await resolveId(local)).toBe('77');
  });

  it('survive a restart, because a lost map orphans the session', async () => {
    const local = newLocalSessionId();
    await rememberId(local, '77');
    vi.resetModules();
    const fresh = await import('./offline');
    expect(await fresh.resolveId(local)).toBe('77');
  });
});

describe('a session started with no signal', () => {
  it('is built from the cached plan, so the screen looks the same', () => {
    const local = newLocalSessionId();
    const s = localSession(local, { workout_id: '5' }, plan([10, 20]));

    expect(s.id).toBe(local);
    expect(s.name).toBe('Push');
    expect(s.source_workout_id).toBe(5);
    expect(s.finished_at).toBeNull();
    expect(s.exercises.map((e) => e.exercise_id)).toEqual(['10', '20']);
    expect(s.exercises[0].target_sets).toBe(3);
  });

  it('is still usable with no cached plan — an empty session, not a crash', () => {
    const s = localSession(newLocalSessionId(), { name: 'Quick session' }, null);
    expect(s.name).toBe('Quick session');
    expect(s.exercises).toEqual([]);
  });

  it('keeps the time it actually started, not the time it synced', () => {
    const s = localSession(newLocalSessionId(), { started_at: '2026-08-16T09:00:00Z' }, null);
    expect(s.started_at).toBe('2026-08-16T09:00:00Z');
  });

  it('still shows sets logged against a row the server has since renamed', async () => {
    // Mid-sync the screen holds the server's copy of the session while the
    // queue still holds sets addressed to the local rows. Without the reverse
    // lookup those sets blink off the screen until the last one lands.
    const local = newLocalSessionId();
    await rememberId(local, '77');
    await rememberRowIds(local, ['901']);
    const entry = await enqueueSet(local, `local-we-${local}-0`, { reps: 5 });
    const fromServer = {
      id: local, // the provider keeps the local alias on the fetched session
      name: 'Push',
      started_at: 'now',
      finished_at: null,
      notes: null,
      exercises: [{ id: '901', exercise_id: '10', order: 0, sets: [] }],
    } as never;

    expect(localAliasFor('901')).toBe(`local-we-${local}-0`);
    expect(withPendingSets(fromServer, [entry]).exercises[0].sets).toHaveLength(1);
  });

  it('re-points its rows at the real ones when the start syncs', async () => {
    // Without this every set logged before the start reached the server would
    // be sent against a local row id, 404, and be dropped as permanent.
    const local = newLocalSessionId();
    const s = localSession(local, { workout_id: '5' }, plan([10, 20]));
    await rememberRowIds(local, ['901', '902']);

    expect(await resolveId(s.exercises[0].id)).toBe('901');
    expect(await resolveId(s.exercises[1].id)).toBe('902');
  });
});

describe('the queue', () => {
  it('keeps a start ahead of everything logged after it', async () => {
    const local = newLocalSessionId();
    await enqueueOp({ kind: 'start', sessionId: local, workoutId: '5', startedAt: 'now' });
    await enqueueSet(local, 'local-we-x-0', { reps: 5, weight: 100 });
    await enqueueOp({ kind: 'finish', sessionId: local, finishedAt: 'later' });

    const sent: string[] = [];
    await flushQueue(async (e: QueuedOp) => void sent.push(e.kind ?? 'set'));
    expect(sent).toEqual(['start', 'set', 'finish']);
  });

  it('stops at the first network failure and keeps the rest in order', async () => {
    const local = newLocalSessionId();
    await enqueueOp({ kind: 'start', sessionId: local, startedAt: 'now' });
    await enqueueSet(local, 'w', { reps: 5 });
    await enqueueSet(local, 'w', { reps: 6 });

    let seen = 0;
    const result = await flushQueue(async () => {
      seen += 1;
      if (seen === 2) throw { status: 0 };
    });

    expect(result).toEqual({ synced: 1, remaining: 2 });
    // The third was never attempted — order matters more than throughput.
    expect(seen).toBe(2);
    expect(await pendingCount()).toBe(2);
  });

  it('counts a failed attempt so a stuck item is visible', async () => {
    await enqueueSet('1', 'w', { reps: 5 });
    await flushQueue(async () => {
      throw { status: 0 };
    });
    expect((await pendingSets())[0].attempts).toBe(1);
  });

  it('drops a write the server will never accept', async () => {
    await enqueueSet('1', 'w', { reps: 5 });
    await enqueueSet('1', 'w', { reps: 6 });
    const result = await flushQueue(async () => {
      throw { status: 422 };
    });
    // Retrying forever would block everything behind it.
    expect(result).toEqual({ synced: 0, remaining: 0 });
  });

  it('retries an auth or rate-limit failure rather than dropping it', async () => {
    await enqueueSet('1', 'w', { reps: 5 });
    const result = await flushQueue(async () => {
      throw { status: 401 };
    });
    expect(result.remaining).toBe(1);
  });

  it('survives a restart with everything still queued', async () => {
    const local = newLocalSessionId();
    await enqueueOp({ kind: 'start', sessionId: local, startedAt: 'now' });
    await enqueueSet(local, 'w', { reps: 5 });

    vi.resetModules();
    const fresh = await import('./offline');
    expect(await fresh.pendingCount()).toBe(2);
  });

  it('drops a discarded session without touching another one', async () => {
    await enqueueSet('1', 'w', { reps: 5 });
    await enqueueSet('2', 'w', { reps: 5 });
    await offline.dropSessionFromQueue('1');
    expect((await pendingSets()).map((s) => s.sessionId)).toEqual(['2']);
  });
});

describe('what the screen shows', () => {
  it('overlays unsynced sets so nothing logged ever disappears', async () => {
    const entry = await enqueueSet('1', 'we-1', { reps: 5, weight: 100 });
    const session = {
      id: '1',
      name: 'Push',
      started_at: 'now',
      finished_at: null,
      notes: null,
      exercises: [{ id: 'we-1', exercise_id: '10', order: 0, sets: [] }],
    } as never;

    const shown = withPendingSets(session, [entry]);
    expect(shown.exercises[0].sets).toHaveLength(1);
    expect(shown.exercises[0].sets[0].pending).toBe(true);
    expect(shown.exercises[0].sets[0].weight).toBe(100);
  });

  it('ignores pending sets belonging to a different session', async () => {
    const other = await enqueueSet('2', 'we-1', { reps: 5 });
    const session = {
      id: '1',
      name: 'Push',
      started_at: 'now',
      finished_at: null,
      notes: null,
      exercises: [{ id: 'we-1', exercise_id: '10', order: 0, sets: [] }],
    } as never;

    expect(withPendingSets(session, [other]).exercises[0].sets).toEqual([]);
  });
});
