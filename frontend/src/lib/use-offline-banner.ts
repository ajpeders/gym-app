import { useEffect, useState } from 'react';

import { pendingCount } from '@/lib/offline';

/**
 * Poll the offline queue size so screens can surface "N writes queued".
 *
 * The queue is the single source of truth; a non-empty queue means at least
 * one write has not reached the server (the caller was offline or flapping).
 * Polling every few seconds catches both the initial mount and the moment a
 * reconnect flushes the queue to zero.
 */
export function usePendingCount(pollMs = 5000): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const n = await pendingCount();
        if (!cancelled) setCount(n);
      } catch {
        // Failed to read storage — treat as empty rather than alarm the user.
        if (!cancelled) setCount(0);
      }
    }

    void check();
    const id = setInterval(check, pollMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  return count;
}
