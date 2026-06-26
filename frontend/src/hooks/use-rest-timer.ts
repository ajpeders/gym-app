import { useCallback, useEffect, useRef, useState } from 'react';

export interface RestTimer {
  remaining: number;
  running: boolean;
  duration: number;
  start: (seconds?: number) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  skip: () => void;
  addTime: (seconds: number) => void;
}

/**
 * Simple countdown rest timer driven by setInterval (1s tick).
 * `defaultDuration` is used when start() is called without an argument.
 */
export function useRestTimer(defaultDuration: number): RestTimer {
  const [duration, setDuration] = useState(defaultDuration);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return clear;
  }, [running, clear]);

  // keep default in sync if settings change while idle
  useEffect(() => {
    if (!running && remaining === 0) {
      setDuration(defaultDuration);
    }
  }, [defaultDuration, running, remaining]);

  const start = useCallback(
    (seconds?: number) => {
      const d = seconds ?? defaultDuration;
      setDuration(d);
      setRemaining(d);
      setRunning(d > 0);
    },
    [defaultDuration],
  );

  const pause = useCallback(() => setRunning(false), []);
  const resume = useCallback(() => setRunning((r) => (remaining > 0 ? true : r)), [remaining]);
  const reset = useCallback(() => {
    setRemaining(duration);
    setRunning(duration > 0);
  }, [duration]);
  const skip = useCallback(() => {
    clear();
    setRunning(false);
    setRemaining(0);
  }, [clear]);
  const addTime = useCallback((seconds: number) => {
    setRemaining((prev) => Math.max(0, prev + seconds));
  }, []);

  return { remaining, running, duration, start, pause, resume, reset, skip, addTime };
}
