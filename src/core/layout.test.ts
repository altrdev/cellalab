import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { addCell, applyLayout, clearPack, removeCells, replaceCells, setCellType, setGenerator } from './ops';
import { createProject } from './project';
import { computeStats } from './stats';

const base = { typeId: '21700-5000-10a', diameterMm: 21.4 };

describe('generateGrid', () => {
  it('square 3S2P: pitch = diameter + gap, one group per column', () => {
    const cells = generateGrid({ ...base, series: 3, parallel: 2, kind: 'square', gapMm: 1 });
    expect(cells).toHaveLength(6);
    // passo 22,4 mm, origine in (0, 0)
    expect(cells[0]).toMatchObject({ x: 0, y: 0, group: 0 });
    expect(cells[1]).toMatchObject({ x: 0, y: 22.4, group: 0 });
    expect(cells[2]).toMatchObject({ x: 22.4, y: 0, group: 1 });
  });

  it('the polarity alternates from one group to the next', () => {
    const cells = generateGrid({ ...base, series: 4, parallel: 1, kind: 'square', gapMm: 0 });
    expect(cells.map((c) => c.plusUp)).toEqual([true, false, true, false]);
  });

  it('hexagonal: every cell has neighbours at the same distance (= pitch)', () => {
    const gap = 1;
    const pitch = base.diameterMm + gap;
    const cells = generateGrid({ ...base, series: 4, parallel: 4, kind: 'hex', gapMm: gap });
    const dist = (a: number, b: number) =>
      Math.hypot(cells[a]!.x - cells[b]!.x, cells[a]!.y - cells[b]!.y);
    // cell (g=0,k=1) with (g=1,k=0) and (g=1,k=1): next column offset by half a pitch
    expect(dist(1, 4)).toBeCloseTo(pitch, 2);
    expect(dist(1, 5)).toBeCloseTo(pitch, 2);
    // no pair closer than the pitch (no overlaps)
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(dist(i, j)).toBeGreaterThanOrEqual(pitch - 0.01);
      }
    }
  });

  it('the generated pack has the requested configuration in the calculations', () => {
    const cells = generateGrid({ ...base, series: 13, parallel: 4, kind: 'hex', gapMm: 0.5 });
    const st = computeStats(replaceCells(createProject(), cells));
    expect(st.configLabel).toBe('13S4P');
    expect(st.ungroupedCount).toBe(0);
    expect(st.groupGaps).toBe(false);
  });

  it.each([
    ['zero S', { series: 0, parallel: 1 }],
    ['non-integer P', { series: 2, parallel: 1.5 }],
    ['too many cells', { series: 100, parallel: 100 }],
  ])('rejects: %s', (_n, extra) => {
    expect(() => generateGrid({ ...base, kind: 'square', gapMm: 1, ...extra })).toThrow(RangeError);
  });

  it('rejects a negative gap or a zero diameter', () => {
    expect(() => generateGrid({ ...base, series: 1, parallel: 1, kind: 'square', gapMm: -1 })).toThrow(RangeError);
    expect(() => generateGrid({ ...base, diameterMm: 0, series: 1, parallel: 1, kind: 'square', gapMm: 1 })).toThrow(RangeError);
  });
});

describe('replaceCells', () => {
  it('replaces the existing cells with new unique ids', () => {
    let p = addCell(createProject(), { typeId: base.typeId, x: 0, y: 0, id: 'vecchia' });
    p = replaceCells(p, generateGrid({ ...base, series: 2, parallel: 2, kind: 'square', gapMm: 1 }));
    expect(p.cells).toHaveLength(4);
    expect(new Set(p.cells.map((c) => c.id)).size).toBe(4);
    expect(p.cells.some((c) => c.id === 'vecchia')).toBe(false);
  });
});

describe('applyLayout', () => {
  const recipe = (series: number, parallel: number, kind: 'hex' | 'square', gapMm: number) => ({
    series,
    parallel,
    kind,
    gapMm,
    pitchMm: base.diameterMm + gapMm,
    typeId: base.typeId,
  });
  const generated = (series: number, parallel: number, kind: 'hex' | 'square', gapMm: number) =>
    setGenerator(
      replaceCells(createProject(), generateGrid({ ...base, series, parallel, kind, gapMm })),
      recipe(series, parallel, kind, gapMm),
    );

  it('changing the cell changes the type of all the cells and the pitch, like a new generation', () => {
    const p = generated(3, 2, 'hex', 1.5);
    const big = { typeId: '32700-lfp-6000', diameterMm: 32.2 };
    const r = applyLayout(p, { kind: 'hex', gapMm: 1.5, pitchMm: big.diameterMm + 1.5, typeId: big.typeId })!;
    const fresh = generateGrid({ ...big, series: 3, parallel: 2, kind: 'hex', gapMm: 1.5 });
    expect(r.cells.every((c) => c.typeId === big.typeId)).toBe(true);
    expect(r.generator!.typeId).toBe(big.typeId);
    r.cells.forEach((c, i) => {
      expect(c.x).toBeCloseTo(fresh[i]!.x, 3);
      expect(c.y).toBeCloseTo(fresh[i]!.y, 3);
    });
  });

  it('changing the space gives the same positions as a new generation', () => {
    const p = generated(4, 3, 'hex', 1);
    const r = applyLayout(p, { kind: 'hex', gapMm: 2.5, pitchMm: base.diameterMm + 2.5 })!;
    const fresh = generateGrid({ ...base, series: 4, parallel: 3, kind: 'hex', gapMm: 2.5 });
    r.cells.forEach((c, i) => {
      expect(c.x).toBeCloseTo(fresh[i]!.x, 3);
      expect(c.y).toBeCloseTo(fresh[i]!.y, 3);
    });
    expect(r.generator).toMatchObject({ gapMm: 2.5, kind: 'hex' });
  });

  it('hexagonal → square like regenerating', () => {
    const p = generated(3, 2, 'hex', 1);
    const r = applyLayout(p, { kind: 'square', gapMm: 1, pitchMm: base.diameterMm + 1 })!;
    const fresh = generateGrid({ ...base, series: 3, parallel: 2, kind: 'square', gapMm: 1 });
    r.cells.forEach((c, i) => {
      expect(c.x).toBeCloseTo(fresh[i]!.x, 3);
      expect(c.y).toBeCloseTo(fresh[i]!.y, 3);
    });
  });

  it('keeps ids, groups, polarities and the cells removed by hand', () => {
    let p = generated(3, 2, 'hex', 1);
    p = { ...p, cells: p.cells.map((c, i) => (i === 0 ? { ...c, plusUp: !c.plusUp } : c)) };
    const removed = p.cells[5]!.id;
    p = removeCells(p, [removed]);
    const r = applyLayout(p, { kind: 'hex', gapMm: 3, pitchMm: base.diameterMm + 3 })!;
    expect(r.cells).toHaveLength(5);
    expect(r.cells.map((c) => c.id)).toEqual(p.cells.map((c) => c.id));
    expect(r.cells.map((c) => [c.group, c.plusUp])).toEqual(p.cells.map((c) => [c.group, c.plusUp]));
  });

  it('null if a cell is off the lattice or there is no recipe', () => {
    const p = generated(3, 2, 'hex', 1);
    const moved = { ...p, cells: p.cells.map((c, i) => (i === 0 ? { ...c, x: c.x + 3.3 } : c)) };
    expect(applyLayout(moved, { kind: 'hex', gapMm: 2, pitchMm: 23.4 })).toBeNull();
    expect(applyLayout(clearPack(p), { kind: 'hex', gapMm: 2, pitchMm: 23.4 })).toBeNull();
  });

  it('removing all the cells forgets the recipe', () => {
    const p = generated(2, 1, 'square', 1);
    expect(removeCells(p, p.cells.map((c) => c.id)).generator).toBeUndefined();
    expect(clearPack(p).generator).toBeUndefined();
  });
});

describe('setCellType', () => {
  const p = replaceCells(createProject(), generateGrid({ ...base, series: 2, parallel: 2, kind: 'square', gapMm: 1 }));

  it('changes the type of all the cells or only of the given ones', () => {
    expect(setCellType(p, '18650-3000-10a').cells.every((c) => c.typeId === '18650-3000-10a')).toBe(true);
    const some = setCellType(p, '18650-3000-10a', [p.cells[0]!.id]);
    expect(some.cells[0]!.typeId).toBe('18650-3000-10a');
    expect(some.cells[1]!.typeId).toBe(base.typeId);
    expect(some.cells[0]!.x).toBe(p.cells[0]!.x);
    expect(some.cells[0]!.group).toBe(p.cells[0]!.group);
  });

  it('with no changes returns the same project', () => {
    expect(setCellType(p, base.typeId)).toBe(p);
  });
});
