/**
 * Resolve a day label from pasted notes ("Thu - Push", "Jul 30", "7/30") to a
 * calendar date, using *this device's* local calendar.
 *
 * The parser deliberately returns the header verbatim rather than a date: the
 * server stores naive UTC and tracks no per-user timezone, so only the client
 * can say which day "Thursday" was. Everything here works in local time.
 */

const WEEKDAYS = [
  ['sunday', 'sun'],
  ['monday', 'mon'],
  ['tuesday', 'tue', 'tues'],
  ['wednesday', 'wed', 'weds'],
  ['thursday', 'thu', 'thur', 'thurs'],
  ['friday', 'fri'],
  ['saturday', 'sat'],
];

const MONTHS = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];

/** Local YYYY-MM-DD — never `toISOString()`, which would shift the day. */
export function toDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** The most recent date (today or earlier) falling on `weekday` (0=Sun). */
function mostRecentWeekday(weekday: number): Date {
  const today = daysAgo(0);
  const diff = (today.getDay() - weekday + 7) % 7;
  return daysAgo(diff);
}

/**
 * Best-effort date for a pasted day header, as local YYYY-MM-DD.
 *
 * Returns null when the label carries no date information at all (e.g. a bare
 * "Push"), so the caller can fall back to asking rather than silently guessing
 * a day the user never claimed.
 */
export function resolveDayLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const text = label.toLowerCase();

  if (/\btoday\b/.test(text)) return toDateStr(daysAgo(0));
  if (/\byesterday\b/.test(text)) return toDateStr(daysAgo(1));

  // Explicit numeric date: 7/30, 7-30, 2026-07-30.
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
    return Number.isNaN(d.getTime()) ? null : toDateStr(d);
  }
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (numeric) {
    const month = Number(numeric[1]) - 1;
    const day = Number(numeric[2]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const now = new Date();
      let d = new Date(now.getFullYear(), month, day, 12);
      // A date later than today must belong to last year, not the future.
      if (d.getTime() > daysAgo(0).getTime()) d = new Date(now.getFullYear() - 1, month, day, 12);
      return toDateStr(d);
    }
  }

  // Month name + day: "Jul 30", "30 July".
  for (let m = 0; m < MONTHS.length; m += 1) {
    for (const nameForm of MONTHS[m]) {
      const re = new RegExp(`\\b${nameForm}\\b\\.?\\s*(\\d{1,2})|\\b(\\d{1,2})\\s*${nameForm}\\b`);
      const hit = text.match(re);
      if (hit) {
        const day = Number(hit[1] ?? hit[2]);
        if (day >= 1 && day <= 31) {
          const now = new Date();
          let d = new Date(now.getFullYear(), m, day, 12);
          if (d.getTime() > daysAgo(0).getTime()) d = new Date(now.getFullYear() - 1, m, day, 12);
          return toDateStr(d);
        }
      }
    }
  }

  // Weekday name → the most recent one, since these notes are already-trained
  // days. "Thursday" written on a Saturday means two days ago, not next week.
  for (let w = 0; w < WEEKDAYS.length; w += 1) {
    for (const nameForm of WEEKDAYS[w]) {
      if (new RegExp(`\\b${nameForm}\\b`).test(text)) {
        return toDateStr(mostRecentWeekday(w));
      }
    }
  }

  return null;
}
