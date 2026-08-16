/**
 * Superset labels, derived from adjacency.
 *
 * A superset is a *run* of exercises next to each other in the list, so the
 * labels are never edited directly — they're recomputed from "is this one
 * paired with the one below it". That keeps two things impossible: a group
 * whose members aren't adjacent (the logging screen couldn't show it), and a
 * group of one (which is just an exercise).
 */

export interface Pairable {
  superset_group?: string | null;
  /** Set while editing; the labels are rebuilt from these. */
  _pairedWithNext?: boolean;
}

const LABELS = 'ABCDEFGH';

/** Which exercises are paired with the one after them, read off the labels. */
export function pairFlags<T extends Pairable>(list: T[]): boolean[] {
  return list.map(
    (item, i) =>
      !!item.superset_group &&
      i < list.length - 1 &&
      list[i + 1].superset_group === item.superset_group,
  );
}

/**
 * Rewrite the labels from pairing flags: runs become A, B, C top to bottom.
 *
 * A run of one gets no label at all — "superset A" containing a single
 * exercise is a lie the UI would then have to render.
 */
export function applyLabels<T extends Pairable>(list: T[], flags: boolean[]): T[] {
  const out = list.map((item) => ({ ...item, superset_group: null as string | null }));
  let group = 0;
  let i = 0;
  while (i < out.length) {
    let end = i;
    while (end < out.length - 1 && flags[end]) end += 1;
    if (end > i) {
      const label = LABELS[group % LABELS.length];
      for (let j = i; j <= end; j++) out[j].superset_group = label;
      group += 1;
    }
    i = end + 1;
  }
  return out.map(({ _pairedWithNext, ...rest }) => rest as T);
}

/** Recompute labels after a reorder or a delete, from what's still adjacent. */
export function normalise<T extends Pairable>(list: T[]): T[] {
  return applyLabels(list, pairFlags(list));
}

/** Toggle the pairing between `index` and the exercise after it. */
export function togglePairAt<T extends Pairable>(list: T[], index: number): T[] {
  if (index < 0 || index >= list.length - 1) return list;
  const flags = pairFlags(list);
  flags[index] = !flags[index];
  return applyLabels(list, flags);
}
