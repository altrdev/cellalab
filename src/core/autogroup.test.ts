import { describe, expect, it } from 'vitest';
import { nextFreeGroup, suggestGroups } from './autogroup';
import { generateGrid } from './layout';
import { alternateGroupPolarity, assignGroups, replaceCells } from './ops';
import { createProject } from './project';
import { runDrc } from './drc';
import type { PlacedCell, Project } from './types';

const T = '21700-5000-10a';

/** Pack with no groups, cells in reverse order (so the starting order does not give it away). */
const truth = new WeakMap<Project, Map<string, number>>();
function ungrouped(series: number, parallel: number, kind: 'hex' | 'square', gap = 1): Project {
  const p = replaceCells(
    createProject(),
    generateGrid({ typeId: T, diameterMm: 21.4, series, parallel, kind, gapMm: gap }),
  );
  const out = { ...p, cells: p.cells.map((c) => ({ ...c, group: null })).reverse() };
  truth.set(out, new Map(p.cells.map((c) => [c.id, c.group as number])));
  return out;
}

/** For each original group (column g) check that it ends up entirely in the same proposed group. */
function sameColumnsAs(original: Project, groups: Map<string, number>, series: number) {
  // generated groups have index g: each proposed group must match an original one
  const byOriginal = new Map<number, Set<number>>();
  for (const c of original.cells) {
    const key = truth.get(original)!.get(c.id)!;
    (byOriginal.get(key) ?? byOriginal.set(key, new Set()).get(key)!).add(groups.get(c.id)!);
  }
  expect([...byOriginal.values()].every((s) => s.size === 1)).toBe(true);
  expect(new Set([...groups.values()]).size).toBe(series);
}

describe('suggestGroups', () => {
  it('finds the groups (diagonals) of a 4S3P hexagonal pack and puts them in series from left to right', () => {
    const p = ungrouped(4, 3, 'hex');
    const r = suggestGroups(p.cells, 3);
    expect(r.strategy).toBe('x');
    expect(r.groupCount).toBe(4);
    sameColumnsAs(p, r.groups, 4);
    // series order as in the generated pack: left to right
    for (const c of p.cells) expect(r.groups.get(c.id)).toBe(truth.get(p)!.get(c.id));
  });

  it('finds the rows when the groups are horizontal', () => {
    const p = ungrouped(3, 4, 'square');
    // transposed: each group becomes a row
    const rows = { ...p, cells: p.cells.map((c) => ({ ...c, x: c.y, y: c.x })) };
    const r = suggestGroups(rows.cells, 4);
    expect(r.strategy).toBe('y');
    const byY = new Map<number, Set<number>>();
    for (const c of rows.cells) (byY.get(Math.round(c.y)) ?? byY.set(Math.round(c.y), new Set()).get(Math.round(c.y))!).add(r.groups.get(c.id)!);
    expect([...byY.values()].every((s) => s.size === 1)).toBe(true);
  });

  it('with a forced block strategy it forms 2×2 squares', () => {
    const p = ungrouped(4, 4, 'square'); // griglia 4×4
    const r = suggestGroups(p.cells, 4, { strategy: 'blob' });
    expect(r.strategy).toBe('blob');
    for (let g = 0; g < 4; g++) {
      const cells = p.cells.filter((c) => r.groups.get(c.id) === g);
      expect(cells).toHaveLength(4);
      const xs = new Set(cells.map((c) => Math.round(c.x)));
      const ys = new Set(cells.map((c) => Math.round(c.y)));
      expect(xs.size).toBe(2);
      expect(ys.size).toBe(2);
    }
  });

  it('automatically uses blocks when columns and rows are not aligned (3×3 in a 6×6 grid)', () => {
    const p = ungrouped(6, 6, 'square');
    const r = suggestGroups(p.cells, 9);
    expect(r.strategy).toBe('blob');
    for (let g = 0; g < 4; g++) {
      const cells = p.cells.filter((c) => r.groups.get(c.id) === g);
      expect(new Set(cells.map((c) => Math.round(c.x))).size).toBe(3);
      expect(new Set(cells.map((c) => Math.round(c.y))).size).toBe(3);
    }
  });

  it('automatically prefers columns when they are aligned (even if 2×2 blocks would be possible)', () => {
    const p = ungrouped(4, 4, 'square');
    expect(suggestGroups(p.cells, 4).strategy).toBe('x');
  });

  it('applies the initial group offset', () => {
    const p = ungrouped(2, 2, 'square');
    const r = suggestGroups(p.cells, 2, { startGroup: 5 });
    expect([...new Set(r.groups.values())].sort()).toEqual([5, 6]);
  });

  it('is deterministic', () => {
    const p = ungrouped(5, 3, 'hex');
    const a = suggestGroups(p.cells, 3);
    const b = suggestGroups([...p.cells].reverse(), 3);
    expect([...a.groups].sort()).toEqual([...b.groups].sort());
  });

  it.each([
    ['cell count not a multiple of P', 7, 3],
    ['invalid P', 6, 0],
  ])('rejects: %s', (_n, count, parallel) => {
    const cells: PlacedCell[] = Array.from({ length: count }, (_, i) => ({
      id: `c${i}`, typeId: T, x: i * 22, y: 0, plusUp: true, group: null,
    }));
    expect(() => suggestGroups(cells, parallel)).toThrow(RangeError);
  });

  it('rejects an empty set', () => {
    expect(() => suggestGroups([], 2)).toThrow(RangeError);
  });

  it('with the cells in a single row, the groups are consecutive stretches', () => {
    const cells: PlacedCell[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, typeId: T, x: i * 22.4, y: 0, plusUp: true, group: null,
    }));
    const r = suggestGroups(cells, 2);
    expect(cells.map((c) => r.groups.get(c.id))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('nextFreeGroup, assignGroups, alternateGroupPolarity', () => {
  it('nextFreeGroup ignores the excluded cells', () => {
    const cells: PlacedCell[] = [
      { id: 'a', typeId: T, x: 0, y: 0, plusUp: true, group: 0 },
      { id: 'b', typeId: T, x: 0, y: 0, plusUp: true, group: 3 },
      { id: 'c', typeId: T, x: 0, y: 0, plusUp: true, group: null },
    ];
    expect(nextFreeGroup(cells, new Set())).toBe(4);
    expect(nextFreeGroup(cells, new Set(['b']))).toBe(1);
    expect(nextFreeGroup(cells, new Set(['a', 'b']))).toBe(0);
  });

  it('assignGroups applies the groups and does not create a new project if nothing changes', () => {
    const p = ungrouped(2, 2, 'square');
    const r = suggestGroups(p.cells, 2);
    const q = assignGroups(p, r.groups);
    expect(q.cells.every((c) => c.group !== null)).toBe(true);
    expect(assignGroups(q, r.groups)).toBe(q);
  });

  it('after automatic grouping + alternation the pack is clean for the checks', () => {
    const p = ungrouped(4, 3, 'hex');
    const grouped = assignGroups(p, suggestGroups(p.cells, 3).groups);
    const flat = { ...grouped, cells: grouped.cells.map((c) => ({ ...c, plusUp: true })) };
    expect(runDrc(flat).map((i) => i.code)).toContain('series-same-polarity');
    const fixed = alternateGroupPolarity(flat);
    expect(runDrc(fixed)).toEqual([]);
  });

  it('alternateGroupPolarity respects the selection and skips cells with no group', () => {
    const cells: PlacedCell[] = [
      { id: 'a', typeId: T, x: 0, y: 0, plusUp: true, group: 1 },
      { id: 'b', typeId: T, x: 0, y: 0, plusUp: true, group: 1 },
      { id: 'c', typeId: T, x: 0, y: 0, plusUp: true, group: null },
    ];
    const p = { ...createProject(), cells };
    const q = alternateGroupPolarity(p, ['a']);
    expect(q.cells.map((c) => c.plusUp)).toEqual([false, true, true]);
    expect(alternateGroupPolarity(p, ['c'])).toBe(p);
  });
});
