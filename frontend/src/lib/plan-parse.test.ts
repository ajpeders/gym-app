import { describe, expect, it } from 'vitest';
import { parseStructuredPlan, splitDelimited, weekdaysFromLabel } from './plan-parse';

describe('weekdaysFromLabel', () => {
  it('reads every weekday named in a header', () => {
    expect(weekdaysFromLabel('Mon/Thu - Push')).toEqual([1, 4]);
    expect(weekdaysFromLabel('Wednesday')).toEqual([3]);
    expect(weekdaysFromLabel('Push')).toEqual([]);
  });
});

describe('splitDelimited', () => {
  it('keeps a delimiter inside quotes', () => {
    expect(splitDelimited('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd']);
  });

  it('unescapes a doubled quote', () => {
    expect(splitDelimited('a,"say ""hi""",b', ',')).toEqual(['a', 'say "hi"', 'b']);
  });
});

describe('parseStructuredPlan — CSV', () => {
  const csv = [
    'Day,Exercise,Sets,Reps,Weight,Notes',
    'Mon - Push,Bench Press,4,8-12,60,touch and go',
    'Mon - Push,Overhead Press,3,10,30,',
    'Thu - Pull,Barbell Row,4,8,70,',
  ].join('\n');

  it('groups rows into days, in the order they first appear', () => {
    const plan = parseStructuredPlan(csv)!;
    expect(plan.source).toBe('csv');
    expect(plan.days.map((d) => d.name)).toEqual(['Mon - Push', 'Thu - Pull']);
    expect(plan.days[0].weekdays).toEqual([1]);
    expect(plan.days[1].weekdays).toEqual([4]);
  });

  it('reads sets, a rep range, load and notes', () => {
    const plan = parseStructuredPlan(csv)!;
    expect(plan.days[0].exercises[0]).toEqual({
      name: 'Bench Press',
      sets: 4,
      reps: 8,
      repsMax: 12,
      weight: 60,
      notes: 'touch and go',
    });
    expect(plan.days[0].exercises[1]).toMatchObject({ reps: 10, repsMax: null, notes: null });
  });

  it('marks a day with no weekday in its name as floating', () => {
    const plan = parseStructuredPlan('Workout,Exercise\nUpper,Bench Press')!;
    expect(plan.days[0].floating).toBe(true);
    expect(plan.days[0].weekdays).toEqual([]);
  });

  it('accepts tab-separated columns and alternative headers', () => {
    const tsv = 'Routine\tMovement\tSet Count\tRep Range\tLoad\nPull\tChin Up\t3\t6-10\t';
    const plan = parseStructuredPlan(tsv)!;
    expect(plan.days[0].exercises[0]).toMatchObject({
      name: 'Chin Up',
      sets: 3,
      reps: 6,
      repsMax: 10,
      weight: null,
    });
  });

  it('falls back to the AI when there is no exercise column', () => {
    // Prose with commas must not be mistaken for a spreadsheet.
    expect(parseStructuredPlan('Monday, chest day\nBench, then flyes, then dips')).toBeNull();
  });

  it('falls back to the AI for a header with no rows', () => {
    expect(parseStructuredPlan('Day,Exercise,Sets')).toBeNull();
  });
});

describe('parseStructuredPlan — JSON', () => {
  it('round-trips our own single-workout export', () => {
    // Matches lib/export.ts `workoutToJson`.
    const json = JSON.stringify({
      type: 'workout',
      name: 'Wednesday - Legs',
      notes: 'deload week',
      units: 'kg',
      exercises: [
        { name: 'Barbell Squat', target_sets: 5, target_reps: 5, target_reps_max: null, target_weight: 100 },
      ],
    });
    const plan = parseStructuredPlan(json)!;
    expect(plan.source).toBe('json');
    // The name belongs to the day here, not to a plan wrapping it.
    expect(plan.name).toBeNull();
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].name).toBe('Wednesday - Legs');
    expect(plan.days[0].weekdays).toEqual([3]);
    expect(plan.days[0].exercises[0]).toMatchObject({ sets: 5, reps: 5, weight: 100 });
  });

  it('reads a whole plan with explicit weekdays', () => {
    const json = JSON.stringify({
      name: 'PPL',
      rules: ['add weight at the top of the range'],
      workouts: [
        { name: 'Push', weekdays: [1], exercises: [{ name: 'Bench Press', sets: 4, reps: '8-12' }] },
        { name: 'Pull', weekdays: [4], exercises: [{ name: 'Row', sets: 4, reps: 8 }] },
      ],
    });
    const plan = parseStructuredPlan(json)!;
    expect(plan.name).toBe('PPL');
    expect(plan.rules).toEqual(['add weight at the top of the range']);
    // An explicit weekdays list wins over what the name happens to say.
    expect(plan.days.map((d) => d.weekdays)).toEqual([[1], [4]]);
    expect(plan.days[0].exercises[0]).toMatchObject({ reps: 8, repsMax: 12 });
  });

  it('accepts a bare array of days', () => {
    const plan = parseStructuredPlan('[{"name":"Push","exercises":[{"name":"Bench"}]}]')!;
    expect(plan.days).toHaveLength(1);
  });

  it('drops a day with no readable exercises rather than importing it empty', () => {
    const json = JSON.stringify({
      workouts: [{ name: 'Push', exercises: [{ sets: 3 }] }, { name: 'Pull', exercises: [{ name: 'Row' }] }],
    });
    const plan = parseStructuredPlan(json)!;
    expect(plan.days.map((d) => d.name)).toEqual(['Pull']);
  });

  it('falls back to the AI for JSON that is not a plan', () => {
    expect(parseStructuredPlan('{"hello":"world"}')).toBeNull();
    expect(parseStructuredPlan('{ broken json')).toBeNull();
  });

  it('ignores empty input', () => {
    expect(parseStructuredPlan('   ')).toBeNull();
  });
});
