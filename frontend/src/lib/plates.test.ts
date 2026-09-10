import { describe, expect, it } from 'vitest';

import { perSide, plateHint } from './plates';

describe('perSide', () => {
  it('loads heaviest first for a 20kg bar', () => {
    expect(perSide(100, 'kg')).toEqual([25, 15]);
    expect(perSide(102.5, 'kg')).toEqual([25, 15, 1.25]);
  });
  it('uses a 45lb bar and lb plates', () => {
    expect(perSide(135, 'lb')).toEqual([45]);
  });
  it('is empty at or under the bar', () => {
    expect(perSide(20, 'kg')).toEqual([]);
    expect(perSide(15, 'kg')).toEqual([]);
  });
});

describe('plateHint', () => {
  it('reads as what you do at the rack', () => {
    expect(plateHint(100, 'kg')).toBe('25 + 15 a side');
    expect(plateHint(20, 'kg')).toBe('bar only');
    expect(plateHint(15, 'kg')).toBe('under the 20kg bar');
  });
  it('says when the plates cannot make the number', () => {
    expect(plateHint(101, 'kg')).toBe('25 + 15 a side (1kg short)');
  });
  it('is null for nothing', () => {
    expect(plateHint(null, 'kg')).toBeNull();
    expect(plateHint(Number.NaN, 'kg')).toBeNull();
  });
});
