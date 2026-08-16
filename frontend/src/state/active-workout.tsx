import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { api } from '@/api/client';
import type { SetInput, Session } from '@/api/types';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import {
  cacheSession,
  dequeueSet,
  dropSessionFromQueue,
  enqueueOp,
  enqueueSet,
  flushQueue,
  isLocalSessionId,
  localSession,
  newLocalSessionId,
  pendingCount as queuedCount,
  pendingSets,
  readCachedPlan,
  readCachedSession,
  rememberId,
  rememberRowIds,
  resolveId,
  withPendingSets,
  withPendingSetsSync,
  type QueuedOp,
} from '@/lib/offline';
import { useAuth } from './auth';

const ACTIVE_KEY = 'gymapp.activeWorkoutId';

interface ActiveWorkoutContextValue {
  workout: Session | null;
  activeId: string | null;
  loading: boolean;
  start: (input: { workout_id?: string; name?: string; started_at?: string }) => Promise<Session>;
  load: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  addExercise: (exerciseId: string) => Promise<void>;
  removeExercise: (weId: string) => Promise<void>;
  /** Swap the movement on a logged row, keeping its sets. */
  swapExercise: (weId: string, exerciseId: string) => Promise<void>;
  addSet: (weId: string, input: SetInput) => Promise<void>;
  updateSet: (weId: string, setId: string, input: Partial<SetInput>) => Promise<void>;
  removeSet: (weId: string, setId: string) => Promise<void>;
  finish: () => Promise<void>;
  discard: () => Promise<void>;
  /** Writes made locally that haven't reached the server yet. */
  pendingCount: number;
  /** Try to push the queue now. */
  sync: () => Promise<void>;
}

const ActiveWorkoutContext = createContext<ActiveWorkoutContextValue | null>(null);

export function ActiveWorkoutProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [workout, setWorkout] = useState<Session | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const syncing = useRef(false);
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  // Resume any persisted active workout after login.
  useEffect(() => {
    if (!user) {
      setWorkout(null);
      setActiveId(null);
      return;
    }
    (async () => {
      const stored = await getItem(ACTIVE_KEY);
      if (!stored) return;
      setActiveId(stored);
      try {
        const serverId = await resolveId(stored);
        if (isLocalSessionId(serverId)) {
          // Started offline and still unsynced: the cache is the only copy.
          const cached = await readCachedSession(stored);
          if (cached) setWorkout(await overlay(cached));
          return;
        }
        const w = await api.session(serverId);
        if (w.finished_at == null) {
          await applyWorkout(isLocalSessionId(stored) ? { ...w, id: stored } : w);
        } else {
          await deleteItem(ACTIVE_KEY);
          setActiveId(null);
        }
      } catch (err) {
        // Offline (or the API is mid-redeploy): keep the session alive from the
        // cache instead of dropping it. Only forget it on a definite 404.
        if ((err as { status?: number })?.status === 404) {
          await deleteItem(ACTIVE_KEY);
          setActiveId(null);
          return;
        }
        const cached = await readCachedSession(stored);
        if (cached) setWorkout(await overlay(cached));
      }
    })();
  }, [user]);

  // Merge unsynced sets on top of a server/cached workout so nothing the user
  // logged ever disappears from the screen.
  const overlay = useCallback(async (w: Session): Promise<Session> => {
    const pend = await pendingSets(w.id);
    // Count the whole queue, not just sets — a swap or a finish waiting to go
    // out is just as unsynced, and the badge is what tells you so.
    setPendingCount(await queuedCount());
    return withPendingSets(w, pend);
  }, []);

  // Store the authoritative server copy, then display it with pending overlaid.
  const applyWorkout = useCallback(
    async (w: Session) => {
      await cacheSession(w);
      setWorkout(await overlay(w));
    },
    [overlay],
  );

  // Push queued sets the moment we can: on connectivity returning (the main
  // path — walk out of the dead zone and it just syncs), on app foreground, and
  // a slow timer as a backstop for cases NetInfo doesn't report (e.g. the API
  // being down while the phone still has wifi).
  useEffect(() => {
    if (!user) return;
    void syncRef.current?.();

    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void syncRef.current?.();
      }
    });
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncRef.current?.();
    });
    // On web, NetInfo only reports a reachability probe it runs on its own
    // schedule, so reconnecting could sit unsynced until the backstop timer.
    // The browser already knows the moment the network is back.
    const onOnline = () => void syncRef.current?.();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
    }
    const id = setInterval(() => {
      if (pendingCount > 0) void syncRef.current?.();
    }, 30000);

    return () => {
      netSub();
      appSub.remove();
      clearInterval(id);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
      }
    };
  }, [user, pendingCount]);

  const setActive = useCallback(async (w: Session | null) => {
    if (w) await cacheSession(w);
    setWorkout(w);
    setActiveId(w?.id ?? null);
    if (w && w.finished_at == null) {
      await setItem(ACTIVE_KEY, w.id);
    } else {
      await deleteItem(ACTIVE_KEY);
    }
  }, []);

  /**
   * Start a session, with or without a network.
   *
   * Offline it gets a local id and a session built from the cached plan, so the
   * gym floor experience is identical — the alternative was being unable to
   * begin a workout at all in the one place phones have no signal. The local id
   * is permanent (see lib/offline.ts); the server id is swapped in per call.
   */
  const start = useCallback(
    async (input: { workout_id?: string; name?: string; started_at?: string }) => {
      try {
        const w = await api.startSession(input);
        await setActive(w);
        return w;
      } catch (err) {
        if ((err as { status?: number })?.status !== 0) throw err;
        const localId = newLocalSessionId();
        const startedAt = input.started_at ?? new Date().toISOString();
        const plan = input.workout_id ? await readCachedPlan(input.workout_id) : null;
        const w = localSession(localId, { ...input, started_at: startedAt }, plan);
        await enqueueOp({
          kind: 'start',
          sessionId: localId,
          workoutId: input.workout_id ?? null,
          name: input.name ?? null,
          startedAt,
        });
        await setActive(w);
        setPendingCount(await queuedCount());
        return w;
      }
    },
    [setActive],
  );

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setActiveId(id);
      try {
        const w = await api.session(await resolveId(id));
        await applyWorkout(isLocalSessionId(id) ? { ...w, id } : w);
        if (w.finished_at == null) await setItem(ACTIVE_KEY, id);
      } catch {
        // Offline: render from cache so the session is still usable.
        const cached = await readCachedSession(id);
        if (cached) setWorkout(await overlay(cached));
      } finally {
        setLoading(false);
      }
    },
    [applyWorkout, overlay],
  );

  const refresh = useCallback(async () => {
    if (!activeId) return;
    const serverId = await resolveId(activeId);
    // A start that hasn't synced yet has nothing to read back — asking would
    // 404 and blank a session the user is standing in the middle of.
    if (isLocalSessionId(serverId)) return;
    try {
      const w = await api.session(serverId);
      await applyWorkout(isLocalSessionId(activeId) ? { ...w, id: activeId } : w);
    } catch {
      // Stay on the cached + pending view rather than blanking the screen.
      const cached = await readCachedSession(activeId);
      if (cached) setWorkout(await overlay(cached));
    }
  }, [activeId, applyWorkout, overlay]);

  /**
   * Try the network, fall back to the queue.
   *
   * Sets are queued unconditionally because they're the thing you can't lose.
   * These writes are different: online, going straight to the server keeps the
   * screen showing server truth immediately (an added exercise needs its real
   * id). Only a genuine connectivity failure — ApiError status 0, never a 4xx
   * the server would reject again — falls back to queueing.
   */
  const sendOrQueue = useCallback(
    async (attempt: () => Promise<unknown>, queued: () => Promise<void>) => {
      // A session the server has never heard of can only be written to by
      // queueing — attempting first would 404, and a 404 is treated as
      // permanent, which would silently throw the write away.
      if (activeId && isLocalSessionId(await resolveId(activeId))) {
        await queued();
        setPendingCount(await queuedCount());
        await refresh();
        return;
      }
      try {
        await attempt();
      } catch (err) {
        if ((err as { status?: number })?.status !== 0) throw err;
        await queued();
        setPendingCount(await queuedCount());
      }
      await refresh();
    },
    [activeId, refresh],
  );

  const addExercise = useCallback(
    async (exerciseId: string) => {
      if (!activeId) return;
      await sendOrQueue(
        () => api.addSessionExercise(activeId, { exercise_id: exerciseId }),
        () => enqueueOp({ kind: 'addExercise', sessionId: activeId, exerciseId }),
      );
    },
    [activeId, sendOrQueue],
  );

  const removeExercise = useCallback(
    async (weId: string) => {
      if (!activeId) return;
      await sendOrQueue(
        () => api.deleteSessionExercise(activeId, weId),
        () => enqueueOp({ kind: 'removeExercise', sessionId: activeId, weId }),
      );
    },
    [activeId, sendOrQueue],
  );

  const swapExercise = useCallback(
    async (weId: string, exerciseId: string) => {
      if (!activeId) return;
      await sendOrQueue(
        () => api.swapSessionExercise(activeId, weId, exerciseId),
        () => enqueueOp({ kind: 'swap', sessionId: activeId, weId, exerciseId }),
      );
    },
    [activeId, sendOrQueue],
  );

  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const send = async (e: QueuedOp) => {
        // Local ids are translated here and nowhere else — this is the single
        // seam between what the app calls a session and what the server does.
        const sid = await resolveId(e.sessionId);
        switch (e.kind) {
          case 'start': {
            const created = await api.startSession(
              {
                workout_id: e.workoutId ?? undefined,
                name: e.name ?? undefined,
                started_at: e.startedAt,
              },
              e.opId,
            );
            await rememberId(e.sessionId, created.id);
            await rememberRowIds(e.sessionId, created.exercises.map((we) => we.id));
            return;
          }
          case 'addExercise': {
            const row = await api.addSessionExercise(sid, { exercise_id: e.exerciseId }, e.opId);
            // Sets logged against the optimistic row must find the real one.
            await rememberId(e.localId, row.id);
            return;
          }
          case 'swap':
            await api.swapSessionExercise(sid, await resolveId(e.weId), e.exerciseId);
            return;
          case 'removeExercise':
            await api.deleteSessionExercise(sid, await resolveId(e.weId));
            return;
          case 'removeSet':
            await api.deleteSet(sid, await resolveId(e.weId), e.setId);
            return;
          case 'finish':
            await api.finishSession(sid, e.finishedAt);
            return;
          default:
            // Stamp with when the set was actually logged, not when it synced —
            // otherwise a whole offline session collapses onto one timestamp.
            await api.addSet(
              sid,
              await resolveId(e.weId),
              {
                ...e.input,
                completed_at: e.input.completed_at ?? new Date(e.createdAt).toISOString(),
              },
              e.opId,
            );
        }
      };
      const { synced, remaining } = await flushQueue(send);
      setPendingCount(remaining);
      // Only re-read the server when something actually landed.
      if (synced > 0 && activeId) {
        try {
          const serverId = await resolveId(activeId);
          if (isLocalSessionId(serverId)) return; // start still queued
          const w = await api.session(serverId);
          // Logging a set kicks off a background sync, so this read can land
          // after the session was finished and cleared. Applying it then would
          // put a finished workout back on screen as "ongoing".
          if (w.finished_at != null) return;
          await applyWorkout(isLocalSessionId(activeId) ? { ...w, id: activeId } : w);
        } catch {
          /* still offline — keep showing what we have */
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [activeId, applyWorkout]);

  // Offline-first: the set is written to device storage and shown immediately,
  // then pushed in the background. Losing a logged set to a dead zone (or an
  // API redeploy) is not acceptable, so nothing here depends on the network.
  const addSet = useCallback(
    async (weId: string, input: SetInput) => {
      if (!activeId) return;
      await enqueueSet(activeId, weId, input);
      setWorkout((prev) => (prev ? withPendingSetsSync(prev, weId, input) : prev));
      setPendingCount((n) => n + 1);
      void sync();
    },
    [activeId, sync],
  );

  const updateSet = useCallback(
    async (weId: string, setId: string, input: Partial<SetInput>) => {
      if (!activeId) return;
      await api.updateSet(activeId, weId, setId, input);
      await refresh();
    },
    [activeId, refresh],
  );

  const removeSet = useCallback(
    async (weId: string, setId: string) => {
      if (!activeId) return;
      // A still-pending set only exists locally — drop it from the queue rather
      // than sending its local id to the server (which would 404).
      // NB: server ids arrive as numbers despite the string type, so coerce
      // before any string check.
      if (String(setId).startsWith('local-')) {
        await dequeueSet(setId);
        setWorkout((prev) =>
          prev
            ? {
                ...prev,
                exercises: prev.exercises.map((we) =>
                  we.id === weId
                    ? { ...we, sets: we.sets.filter((s) => String(s.id) !== String(setId)) }
                    : we,
                ),
              }
            : prev,
        );
        setPendingCount((n) => Math.max(0, n - 1));
        return;
      }
      await sendOrQueue(
        () => api.deleteSet(activeId, weId, setId),
        () => enqueueOp({ kind: 'removeSet', sessionId: activeId, weId, setId }),
      );
    },
    [activeId, sendOrQueue],
  );

  const finish = useCallback(async () => {
    if (!activeId) return;
    await sync(); // push anything queued before closing the session
    // The workout ended when you tapped Finish, not when the phone found
    // signal again — so the time is stamped here and travels with the queued
    // op. The server keeps the first finish it sees and won't restamp.
    const finishedAt = new Date().toISOString();
    try {
      const serverId = await resolveId(activeId);
      // Still unsynced: there is nothing to finish yet, so the finish rides the
      // queue behind its own start.
      if (isLocalSessionId(serverId)) throw { status: 0 };
      await api.finishSession(serverId, finishedAt);
    } catch (err) {
      if ((err as { status?: number })?.status !== 0) throw err;
      // Offline: you're done regardless. Queue it and clear the screen rather
      // than trapping someone in a session they've finished.
      await enqueueOp({ kind: 'finish', sessionId: activeId, finishedAt });
      setPendingCount(await queuedCount());
    }
    await setActive(null);
  }, [activeId, setActive, sync]);

  const discard = useCallback(async () => {
    if (!activeId) return;
    try {
      await dropSessionFromQueue(activeId);
      const serverId = await resolveId(activeId);
      // Never reached the server, so dropping the queue already discarded it.
      if (!isLocalSessionId(serverId)) await api.deleteSession(serverId);
    } finally {
      setPendingCount(0);
      await setActive(null);
    }
  }, [activeId, setActive]);

  syncRef.current = sync;

  const value = useMemo<ActiveWorkoutContextValue>(
    () => ({
      workout,
      activeId,
      loading,
      start,
      load,
      refresh,
      addExercise,
      removeExercise,
      swapExercise,
      addSet,
      updateSet,
      removeSet,
      finish,
      discard,
      pendingCount,
      sync,
    }),
    [
      workout,
      activeId,
      loading,
      start,
      load,
      refresh,
      addExercise,
      removeExercise,
      swapExercise,
      addSet,
      updateSet,
      removeSet,
      finish,
      discard,
      pendingCount,
      sync,
    ],
  );

  return <ActiveWorkoutContext.Provider value={value}>{children}</ActiveWorkoutContext.Provider>;
}

export function useActiveWorkout(): ActiveWorkoutContextValue {
  const ctx = useContext(ActiveWorkoutContext);
  if (!ctx) throw new Error('useActiveWorkout must be used within an ActiveWorkoutProvider');
  return ctx;
}
