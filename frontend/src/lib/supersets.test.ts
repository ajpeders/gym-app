/**
 * Superset labelling. The rule under test: a superset is a run of adjacent
 * exercises, and the labels are always derived from that — never typed, never
 * left behind by a reorder.
 */
import { describe, expect, it } from 'vitest';

import { normalise, pairFlags, togglePairAt } from './supersets';

const list = (...groups: (string | null)[]) => groups.map((g) => ({ superset_group: g }));
const labels = (rows: { superset_group?: string | null }[]) => rows.map((r) => r.superset_group);

describe('reading pairs off the labels', () => {
  it('sees a run of two as one pairing', () => {
    expect(pairFlags(list('A', 'A', null))).toEqual([true, false, false]);
  });

  it('sees a run of three as two pairings', () => {
    expect(pairFlags(list('A', 'A', 'A'))).toEqual([true, true, false]);
  });

  it('does not pair equal labels that aren’t adjacent', () => {
    expect(pairFlags(list('A', null, 'A'))).toEqual([false, false, false]);
  });
});

describe('toggling a pairing', () => {
  it('pairs an exercise with the one below it', () => {
    expect(labels(togglePairAt(list(null, null, null), 0))).toEqual(['A', 'A', null]);
  });

  it('extends an existing superset rather than starting a second one', () => {
    expect(labels(togglePairAt(list('A', 'A', null), 1))).toEqual(['A', 'A', 'A']);
  });

  it('splits a pair apart again', () => {
    expect(labels(togglePairAt(list('A', 'A', null), 0))).toEqual([null, null, null]);
  });

  it('labels a second group B', () => {
    const once = togglePairAt(list(null, null, null, null), 0);
    expect(labels(togglePairAt(once, 2))).toEqual(['A', 'A', 'B', 'B']);
  });

  it('ignores a pairing request on the last exercise', () => {
    expect(labels(togglePairAt(list(null, null), 1))).toEqual([null, null]);
  });
});

describe('after a reorder or a delete', () => {
  it('keeps a group that is still adjacent', () => {
    expect(labels(normalise(list('A', 'A', null)))).toEqual(['A', 'A', null]);
  });

  it('drops a group whose members were separated', () => {
    // Moving an exercise between them ends the superset; leaving the labels
    // behind would show a pairing that no longer exists.
    expect(labels(normalise(list('A', null, 'A')))).toEqual([null, null, null]);
  });

  it('drops a group left with one member', () => {
    expect(labels(normalise(list('A', null)))).toEqual([null, null]);
  });

  it('relabels the remaining groups from the top', () => {
    // The A pair was deleted; what was B is now the first group.
    expect(labels(normalise(list('B', 'B', null)))).toEqual(['A', 'A', null]);
  });
});
