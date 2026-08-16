/**
 * Reminder scheduling. The only part worth testing without a device is *when*
 * the next one lands — everything else is a call into the OS.
 */
import { describe, expect, it } from 'vitest';

import { nextReminderAt } from './notifications';

// A Wednesday.
const wednesday9am = new Date('2026-08-12T09:00:00');

describe('the next reminder', () => {
  it('is later today when the time has not passed', () => {
    const at = nextReminderAt(wednesday9am, { hour: 18, minute: 30, weekdays: [] });
    expect(at.getDate()).toBe(12);
    expect(at.getHours()).toBe(18);
    expect(at.getMinutes()).toBe(30);
  });

  it('rolls to tomorrow once the time has passed', () => {
    // 08:00 on a day where it's already 09:00 belongs to tomorrow, not to an
    // hour ago.
    const at = nextReminderAt(wednesday9am, { hour: 8, minute: 0, weekdays: [] });
    expect(at.getDate()).toBe(13);
  });

  it('skips days the athlete does not train', () => {
    // Only Mondays (1) — from Wednesday that's five days out.
    const at = nextReminderAt(wednesday9am, { hour: 7, minute: 0, weekdays: [1] });
    expect(at.getDay()).toBe(1);
    expect(at.getDate()).toBe(17);
  });

  it('treats an empty weekday list as every day', () => {
    const at = nextReminderAt(wednesday9am, { hour: 10, minute: 0, weekdays: [] });
    expect(at.getDate()).toBe(12);
  });

  it('lands a week out when today is the only training day and it has passed', () => {
    const at = nextReminderAt(wednesday9am, { hour: 7, minute: 0, weekdays: [3] });
    expect(at.getDay()).toBe(3);
    expect(at.getDate()).toBe(19);
  });
});
