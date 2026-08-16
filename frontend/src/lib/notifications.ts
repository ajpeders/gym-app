import { Platform } from 'react-native';

/**
 * Local notifications: rest is up, and it's a training day.
 *
 * Deliberately *local* rather than push. A rest timer that fires from a server
 * needs a push token, a service worker, and something in the homelab awake to
 * send it — for a countdown the phone already knows about. Workout reminders
 * are the same: the schedule is on the device.
 *
 * Two backends behind one seam. On web the browser's Notification API works
 * today, including in the installed PWA. On a device `expo-notifications` does
 * it properly (scheduled, survives the app being closed) but only in a real
 * build — it isn't available in Expo Go — so it's required lazily and a
 * missing module degrades to "no notification" rather than a crash.
 */

export interface ReminderTime {
  hour: number;
  minute: number;
  /** 0=Sun..6=Sat. Empty = every day. */
  weekdays: number[];
}

/** Next occurrence of a reminder, as a Date. Pure, so it can be tested. */
export function nextReminderAt(now: Date, { hour, minute, weekdays }: ReminderTime): Date {
  const days = weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6];
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    // Today only counts if the time hasn't already passed — a reminder set for
    // 09:00 at 09:30 belongs to tomorrow, not to thirty minutes ago.
    if (candidate > now && days.includes(candidate.getDay())) return candidate;
  }
  // Unreachable with a non-empty weekday list, but a total function beats a
  // null the callers have to think about.
  const fallback = new Date(now);
  fallback.setDate(now.getDate() + 7);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

function nativeModule(): typeof import('expo-notifications') | null {
  if (Platform.OS === 'web') return null;
  try {
    // Required lazily: absent in Expo Go, present in a real build.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch {
    return null;
  }
}

/** Ask once. Returns whether we're allowed to notify. */
export async function ensurePermission(): Promise<boolean> {
  const native = nativeModule();
  if (native) {
    const existing = await native.getPermissionsAsync();
    if (existing.granted) return true;
    return (await native.requestPermissionsAsync()).granted;
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Fire now — used when a rest timer reaches its target. */
export async function notifyNow(title: string, body: string): Promise<boolean> {
  const native = nativeModule();
  if (native) {
    await native.scheduleNotificationAsync({ content: { title, body }, trigger: null });
    return true;
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  new Notification(title, { body });
  return true;
}

/**
 * A daily-ish reminder to train.
 *
 * On device this is scheduled with the OS and survives the app being closed.
 * On web there's no such guarantee, so it's a timeout that only fires while a
 * tab is open — honest rather than pretend-reliable, and the settings copy
 * says so.
 */
let webTimer: ReturnType<typeof setTimeout> | null = null;

export async function scheduleWorkoutReminder(when: ReminderTime): Promise<boolean> {
  const native = nativeModule();
  if (native) {
    await native.cancelAllScheduledNotificationsAsync();
    const days = when.weekdays.length ? when.weekdays : [0, 1, 2, 3, 4, 5, 6];
    for (const day of days) {
      await native.scheduleNotificationAsync({
        content: { title: 'Training day', body: "Your plan's ready when you are." },
        trigger: {
          type: native.SchedulableTriggerInputTypes.WEEKLY,
          // expo-notifications counts weekdays 1=Sun..7=Sat.
          weekday: day + 1,
          hour: when.hour,
          minute: when.minute,
        },
      });
    }
    return true;
  }

  if (typeof window === 'undefined') return false;
  if (webTimer) clearTimeout(webTimer);
  const delay = nextReminderAt(new Date(), when).getTime() - Date.now();
  webTimer = setTimeout(() => {
    void notifyNow('Training day', "Your plan's ready when you are.");
    void scheduleWorkoutReminder(when); // roll to the next one
  }, delay);
  return true;
}

export async function cancelReminders(): Promise<void> {
  const native = nativeModule();
  if (native) {
    await native.cancelAllScheduledNotificationsAsync();
    return;
  }
  if (webTimer) {
    clearTimeout(webTimer);
    webTimer = null;
  }
}
