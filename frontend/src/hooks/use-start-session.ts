import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';

import { useActiveWorkout } from '@/state/active-workout';
import { confirm } from '@/lib/confirm';

/**
 * Start a session without stacking up a second one.
 *
 * Every Start button used to call `start()` unconditionally, so tapping one
 * while a session was already running orphaned the first — it stayed open
 * forever and the next tap did it again. The server now closes strays on
 * start, but that alone would silently discard a session the user is mid-way
 * through, so the decision is surfaced here:
 *
 * - same plan day already running -> just resume it, no prompt (obvious intent)
 * - a different one running -> ask before closing it
 * - nothing running -> straight through
 */
export function useStartSession() {
  const router = useRouter();
  const { start, activeId, workout } = useActiveWorkout();
  const [starting, setStarting] = useState(false);

  const startSession = useCallback(
    async (input: { workout_id?: string; name?: string }) => {
      if (starting) return;

      const go = async () => {
        setStarting(true);
        try {
          const s = await start(input);
          router.push(`/session/active/${s.id}`);
        } finally {
          setStarting(false);
        }
      };

      const running = activeId && workout && workout.finished_at == null ? workout : null;
      if (!running) {
        await go();
        return;
      }

      // Tapping Start on the day you're already logging means "take me there".
      if (
        input.workout_id != null &&
        running.source_workout_id != null &&
        String(running.source_workout_id) === String(input.workout_id)
      ) {
        router.push(`/session/active/${activeId}`);
        return;
      }

      confirm(
        'Finish your current session?',
        `"${running.name ?? 'Session'}" is still in progress. Starting a new one will close it.`,
        () => void go(),
      );
    },
    [starting, activeId, workout, start, router],
  );

  return { startSession, starting };
}
