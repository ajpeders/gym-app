import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { api } from '@/api/client';
import type { SetInput, Workout } from '@/api/types';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import {
  cacheWorkout,
  dequeueSet,
  dropWorkoutFromQueue,
  enqueueSet,
  flushQueue,
  pendingSets,
  readCachedWorkout,
  withPendingSets,
  withPendingSetsSync,
  type QueuedSet,
} from '@/lib/offline';
import { useAuth } from './auth';

const ACTIVE_KEY = 'gymapp.activeWorkoutId';

interface ActiveWorkoutContextValue {
  workout: Workout | null;
  activeId: string | null;
  loading: boolean;
  start: (input: { routine_id?: string; name?: string; started_at?: string }) => Promise<Workout>;
  load: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  addExercise: (exerciseId: string) => Promise<void>;
  removeExercise: (weId: string) => Promise<void>;
  addSet: (weId: string, input: SetInput) => Promise<void>;
  updateSet: (weId: string, setId: string, input: Partial<SetInput>) => Promise<void>;
  removeSet: (weId: string, setId: string) => Promise<void>;
  finish: () => Promise<void>;
  discard: () => Promise<void>;
  /** Sets logged locally that haven't reached the server yet. */
  pendingCount: number;
  /** Try to push queued sets now. */
  sync: () => Promise<void>;
}

const ActiveWorkoutContext = createContext<ActiveWorkoutContextValue | null>(null);

export function ActiveWorkoutProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [workout, setWorkout] = useState<Workout | null>(null);
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
        const w = await api.workout(stored);
        if (w.status === 'in_progress') {
          await applyWorkout(w);
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
        const cached = await readCachedWorkout(stored);
        if (cached) setWorkout(await overlay(cached));
      }
    })();
  }, [user]);

  // Merge unsynced sets on top of a server/cached workout so nothing the user
  // logged ever disappears from the screen.
  const overlay = useCallback(async (w: Workout): Promise<Workout> => {
    const pend = await pendingSets(w.id);
    setPendingCount(pend.length);
    return withPendingSets(w, pend);
  }, []);

  // Store the authoritative server copy, then display it with pending overlaid.
  const applyWorkout = useCallback(
    async (w: Workout) => {
      await cacheWorkout(w);
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
    const id = setInterval(() => {
      if (pendingCount > 0) void syncRef.current?.();
    }, 30000);

    return () => {
      netSub();
      appSub.remove();
      clearInterval(id);
    };
  }, [user, pendingCount]);

  const setActive = useCallback(async (w: Workout | null) => {
    if (w) await cacheWorkout(w);
    setWorkout(w);
    setActiveId(w?.id ?? null);
    if (w && w.status === 'in_progress') {
      await setItem(ACTIVE_KEY, w.id);
    } else {
      await deleteItem(ACTIVE_KEY);
    }
  }, []);

  const start = useCallback(
    async (input: { routine_id?: string; name?: string; started_at?: string }) => {
      const w = await api.startWorkout(input);
      await setActive(w);
      return w;
    },
    [setActive],
  );

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setActiveId(id);
      try {
        const w = await api.workout(id);
        await applyWorkout(w);
        if (w.status === 'in_progress') await setItem(ACTIVE_KEY, id);
      } catch {
        // Offline: render from cache so the workout is still usable.
        const cached = await readCachedWorkout(id);
        if (cached) setWorkout(await overlay(cached));
      } finally {
        setLoading(false);
      }
    },
    [applyWorkout, overlay],
  );

  const refresh = useCallback(async () => {
    if (!activeId) return;
    try {
      await applyWorkout(await api.workout(activeId));
    } catch {
      // Stay on the cached + pending view rather than blanking the screen.
      const cached = await readCachedWorkout(activeId);
      if (cached) setWorkout(await overlay(cached));
    }
  }, [activeId, applyWorkout, overlay]);

  const addExercise = useCallback(
    async (exerciseId: string) => {
      if (!activeId) return;
      await api.addWorkoutExercise(activeId, { exercise_id: exerciseId });
      await refresh();
    },
    [activeId, refresh],
  );

  const removeExercise = useCallback(
    async (weId: string) => {
      if (!activeId) return;
      await api.deleteWorkoutExercise(activeId, weId);
      await refresh();
    },
    [activeId, refresh],
  );

  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const send = async (e: QueuedSet) => {
        await api.addSet(e.workoutId, e.weId, e.input);
      };
      const { synced, remaining } = await flushQueue(send);
      setPendingCount(remaining);
      // Only re-read the server when something actually landed.
      if (synced > 0 && activeId) {
        try {
          await applyWorkout(await api.workout(activeId));
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
      await api.deleteSet(activeId, weId, setId);
      await refresh();
    },
    [activeId, refresh],
  );

  const finish = useCallback(async () => {
    if (!activeId) return;
    await sync(); // push any queued sets before closing the session
    await api.finishWorkout(activeId);
    await setActive(null);
  }, [activeId, setActive, sync]);

  const discard = useCallback(async () => {
    if (!activeId) return;
    try {
      await dropWorkoutFromQueue(activeId);
      await api.deleteWorkout(activeId);
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
