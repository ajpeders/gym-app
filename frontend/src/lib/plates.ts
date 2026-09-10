/**
 * What goes on each side of the bar, worked out on the phone.
 *
 * A mirror of the API's plate_breakdown (app/calculators.py), kept here so the
 * hint under the weight field updates per keystroke and works offline. Greedy
 * heaviest-first is both optimal for real plate sets and the order you load
 * them.
 */
const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
const LB_PLATES = [45, 35, 25, 10, 5, 2.5];

export function barWeight(units: string): number {
  return units === 'lb' ? 45 : 20;
}

export function perSide(target: number, units: string, bar = barWeight(units)): number[] {
  if (!Number.isFinite(target) || target <= bar) return [];
  const plates = units === 'lb' ? LB_PLATES : KG_PLATES;
  let remaining = (target - bar) / 2;
  const out: number[] = [];
  for (const plate of plates) {
    while (remaining >= plate - 1e-9) {
      out.push(plate);
      remaining -= plate;
    }
  }
  return out;
}

/** "25 + 15 a side", "bar only", or null when the number isn't one. */
export function plateHint(target: number | null | undefined, units: string): string | null {
  if (target == null || !Number.isFinite(target) || target <= 0) return null;
  const bar = barWeight(units);
  if (target <= bar) return target === bar ? 'bar only' : `under the ${bar}${units} bar`;
  const sides = perSide(target, units, bar);
  const loaded = bar + sides.reduce((a, b) => a + b, 0) * 2;
  const short = Math.round((target - loaded) * 100) / 100;
  const list = sides.length ? sides.join(' + ') : 'nothing';
  return short > 0 ? `${list} a side (${short}${units} short)` : `${list} a side`;
}
