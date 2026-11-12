import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { replaceCells } from './ops';
import { createProject } from './project';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS } from './busbar';
import { buildStrips } from './strips';

const project = () =>
  replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 3, parallel: 2, kind: 'hex', gapMm: 1 }));

describe('strip shape', () => {
  const p = project();
  const base = buildStrips(p);
  const series = (l: ReturnType<typeof buildStrips>) => l.filter((x) => x.kind === 'series');

  it('every cell has the same support, by default the + button plus the rim', () => {
    for (const s of base) for (const n of s.nodes) expect(n.reachMm).toBeCloseTo(0.41 * 10.7 + 1, 6);
  });
  it('more rim = larger support and strip', () => {
    expect(series(buildStrips(p, { marginMm: 3 }))[0]!.areaMm2).toBeGreaterThan(series(base)[0]!.areaMm2);
  });
  it("forced weld area Ø: the rim is added outside (with a limit on the cell)", () => {
    const n = buildStrips(p, { contactDiameterMm: 12 })[0]!.nodes[0]!;
    expect(n.contactRadiusMm).toBeCloseTo(6);
    expect(n.reachMm).toBeCloseTo(6 + 1);
    // the rim takes no room from the spots: with more rim the area stays the same and only the support grows
    const wide = buildStrips(p, { contactDiameterMm: 12, marginMm: 4 })[0]!.nodes[0]!;
    expect(wide.contactRadiusMm).toBeCloseTo(6);
    expect(wide.reachMm).toBeCloseTo(6 + 4);
    const big = buildStrips(p, { contactDiameterMm: 100 })[0]!.nodes[0]!;
    expect(big.reachMm).toBeCloseTo(21.4 / 2 - 0.3);
    expect(big.contactRadiusMm).toBeCloseTo(21.4 / 2 - 0.3 - 1);
  });
  it('the series have windows between the bands; two-cell terminals do not', () => {
    // 3S2P: two groups of two cells per series strip → ring (rails, crossbars, diagonal)
    for (const s of series(base)) expect(s.holes.length).toBeGreaterThanOrEqual(1);
    for (const s of base.filter((x) => x.kind !== 'series')) expect(s.holes).toHaveLength(0);
  });
  it('widening the bands the windows close and the area grows', () => {
    const narrow = series(buildStrips(p, { widthMm: 5 }))[0]!;
    const wide = series(buildStrips(p, { widthMm: 20 }))[0]!;
    expect(wide.areaMm2).toBeGreaterThan(narrow.areaMm2);
    expect(wide.holes.length).toBeLessThanOrEqual(narrow.holes.length);
    expect(narrow.bandMm).toBeCloseTo(5);
  });
  it('forced width limited to the cell diameter', () => {
    expect(series(buildStrips(p, { widthMm: 500 }))[0]!.bandMm).toBeCloseTo(21.4);
  });
  it("the neck is the band width and the analysis divides the current among the cells in parallel (I/P)", () => {
    const strips = buildStrips(p, { widthMm: 8 });
    const r = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 30);
    const row = r.strips.find((x) => x.label.startsWith('S'))!;
    expect(row.neckMm).toBeCloseTo(8);
    expect(row.neckCurrentA).toBeCloseTo(30 / 2); // P = 2
    expect(r.issues.some((i) => /si toccano/.test(i.message))).toBe(false);
  });
});
