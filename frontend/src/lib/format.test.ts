import { describe, expect, it } from 'vitest';

import { muscleLabel } from './format';

describe('muscleLabel', () => {
  it('turns Latin into what people say', () => {
    expect(muscleLabel('Obliquus externus abdominis')).toBe('Obliques');
    expect(muscleLabel('Trapezius')).toBe('Traps');
    expect(muscleLabel('quadriceps')).toBe('Quads');
  });
  it('leaves plain names plain', () => {
    expect(muscleLabel('chest')).toBe('Chest');
    expect(muscleLabel('Lats')).toBe('Lats');
  });
});
