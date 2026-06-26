import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api } from '@/api/client';
import type { SetInput, Workout } from '@/api/types';
import { deleteItem, getItem, setItem } from '@/lib/storage';
import { useAuth } from './auth';

const ACTIVE_KEY = 'gymapp.activeWorkoutId';

interface ActiveWorkoutContextValue {
  workout: Workout | null;
  activeId: string | null;
  loading: boolean;
  start: (input: { routine_id?: string; name?: string }) => Promise<Workout>;
  load: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  addExercise: (exerciseId: string) => Promise<void>;
  removeExercise: (weId: string) => Promise<void>;
  addSet: (weId: string, input: SetInput) => Promise<void>;
  updateSet: (weId: string, setId: string, input: Partial<SetInput>) => Promise<void>;
  removeSet: (weId: string, setId: string) => Promise<void>;
  finish: () => Promise<void>;
  discard: () => Promise<void>;
}

const ActiveWorkoutContext = createContext<ActiveWorkoutContextValue | null>(null);

export function ActiveWorkoutProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
          setWorkout(w);
        } else {
          await deleteItem(ACTIVE_KEY);
          setActiveId(null);
        }
      } catch {
        await deleteItem(ACTIVE_KEY);
        setActiveId(null);
      }
    })();
  }, [user]);

  const setActive = useCallback(async (w: Workout | null) => {
    setWorkout(w);
    setActiveId(w?.id ?? null);
    if (w && w.status === 'in_progress') {
      await setItem(ACTIVE_KEY, w.id);
    } else {
      await deleteItem(ACTIVE_KEY);
    }
  }, []);

  const start = useCallback(
    async (input: { routine_id?: string; name?: string }) => {
      const w = await api.startWorkout(input);
      await setActive(w);
      return w;
    },
    [setActive],
  );

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const w = await api.workout(id);
      setWorkout(w);
      setActiveId(id);
      if (w.status === 'in_progress') await setItem(ACTIVE_KEY, id);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!activeId) return;
    const w = await api.workout(activeId);
    setWorkout(w);
  }, [activeId]);

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

  const addSet = useCallback(
    async (weId: string, input: SetInput) => {
      if (!activeId) return;
      await api.addSet(activeId, weId, input);
      await refresh();
    },
    [activeId, refresh],
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
      await api.deleteSet(activeId, weId, setId);
      await refresh();
    },
    [activeId, refresh],
  );

  const finish = useCallback(async () => {
    if (!activeId) return;
    await api.finishWorkout(activeId);
    await setActive(null);
  }, [activeId, setActive]);

  const discard = useCallback(async () => {
    if (!activeId) return;
    try {
      await api.deleteWorkout(activeId);
    } finally {
      await setActive(null);
    }
  }, [activeId, setActive]);

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
    ],
  );

  return <ActiveWorkoutContext.Provider value={value}>{children}</ActiveWorkoutContext.Provider>;
}

export function useActiveWorkout(): ActiveWorkoutContextValue {
  const ctx = useContext(ActiveWorkoutContext);
  if (!ctx) throw new Error('useActiveWorkout must be used within an ActiveWorkoutProvider');
  return ctx;
}
