import { describe, expect, it } from 'vitest';
import { closeRegions, differenceRegions, circlePolygon, regionArea, unionAll } from './clip';
import { analyzeHolder, buildHolder, buildToleranceTest, clearanceLabel, DEFAULT_HOLDER_SETTINGS } from './holder';
import { generateGrid } from './layout';
import { replaceCells } from './ops';
import { createProject } from './project';
import { stlBinary } from './stl';

const T = '21700-5000-10a';
const pack = (series: number, parallel: number, gapMm = 1, kind: 'hex' | 'square' = 'hex') =>
  replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series, parallel, kind, gapMm }));

describe('differenceRegions', () => {
  it('a circle minus a smaller circle: ring with a hole', () => {
    const outer = { outline: circlePolygon(0, 0, 10), holes: [] };
    const r = differenceRegions(outer, [circlePolygon(0, 0, 6)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.holes).toHaveLength(1);
    expect(regionArea(r[0]!)).toBeCloseTo(Math.PI * (100 - 36), -1);
  });

  it('if the hole isolates a part, it remains as a shape of its own', () => {
    // ring of pockets around a central island
    const outer = { outline: circlePolygon(0, 0, 20), holes: [] };
    const ring = differenceRegions({ outline: circlePolygon(0, 0, 10), holes: [] }, [circlePolygon(0, 0, 5)]);
    expect(ring).toHaveLength(1);
    const cut = differenceRegions(outer, [ring[0]!.outline]);
    expect(cut.length).toBe(1);
    const island = differenceRegions(outer, [circlePolygon(0, 0, 10)]);
    const fine = differenceRegions(island[0]!, [circlePolygon(0, 0, 14)]);
    expect(fine.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildHolder', () => {
  it('with no cells there is nothing to build', () => {
    expect(buildHolder(createProject())).toBeNull();
  });

  it('3S2P: a plate with 6 holes and 6 pockets, wider than the cells alone', () => {
    const p = pack(3, 2);
    const h = buildHolder(p)!;
    expect(h.slab).toHaveLength(1);
    expect(h.slab[0]!.holes).toHaveLength(6);
    expect(h.wall).toHaveLength(1);
    expect(h.wall[0]!.holes).toHaveLength(6);
    const s = DEFAULT_HOLDER_SETTINGS;
    const r = analyzeHolder(p, h);
    // cell footprint 77.4 × 40.8 + wall and clearance on every side
    expect(r.widthMm).toBeCloseTo(77.4 + 2 * (s.wallMm + s.clearanceMm), 0);
    expect(r.depthMm).toBeCloseTo(40.8 + 2 * (s.wallMm + s.clearanceMm), 0);
    expect(r.totalHeightMm).toBeCloseTo(70.4 + 2 * s.floorMm, 6); // 21700: 70,4 mm
  });

  it('the tiny slits between three cells are filled, the big gaps between four stay', () => {
    const hex = buildHolder(pack(3, 3))!;
    expect(hex.slab[0]!.holes).toHaveLength(9); // only the terminal holes
    const sq = buildHolder(pack(3, 3, 1, 'square'))!;
    expect(sq.slab[0]!.holes.length).toBeGreaterThan(9); // + the gaps at the centre of the squares
  });

  it('the floor holes have radius R − rim, the pockets R + clearance', () => {
    const p = pack(1, 1);
    const h = buildHolder(p)!;
    const s = DEFAULT_HOLDER_SETTINGS;
    const hole = (pts: { x: number; y: number }[]) => Math.hypot(pts[0]!.x - 0, pts[0]!.y - 0);
    const R = 21.4 / 2;
    expect(hole(h.slab[0]!.holes[0]!)).toBeCloseTo(R - s.ledgeMm, 1);
    expect(hole(h.wall[0]!.holes[0]!)).toBeCloseTo(R + s.clearanceMm, 1);
  });

  it('the walls do not exceed half a cell', () => {
    const h = buildHolder(pack(2, 1), { ...DEFAULT_HOLDER_SETTINGS, lipMm: 500 })!;
    expect(h.lipMm).toBeLessThanOrEqual(h.cellHeightMm / 2 - 1 + 1e-9);
  });
});

describe('analyzeHolder', () => {
  it('1 mm space and 0.15 clearance: 0.7 mm wall, fragility warning', () => {
    const p = pack(2, 2, 1);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.minWallBetweenMm).toBeCloseTo(0.7, 2);
    expect(r.issues.some((i) => i.level === 'warning' && i.text.includes('parete'))).toBe(true);
  });

  it('2 mm space: no warning about the walls', () => {
    const p = pack(2, 2, 2);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.minWallBetweenMm).toBeCloseTo(1.7, 2);
    expect(r.issues.some((i) => i.text.includes('parete'))).toBe(false);
  });

  it('overlapping pockets: error', () => {
    const p = pack(2, 1, 0.1);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('a large pack does not fit the print bed', () => {
    const p = pack(13, 4);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.issues.some((i) => i.text.includes('piano di stampa'))).toBe(true);
    const small = pack(2, 2, 2);
    expect(analyzeHolder(small, buildHolder(small)!).issues.some((i) => i.text.includes('piano di stampa'))).toBe(false);
  });

  it('always recommends materials that withstand the heat', () => {
    const p = pack(1, 1);
    expect(analyzeHolder(p, buildHolder(p)!).issues.some((i) => i.text.includes('PETG'))).toBe(true);
  });

  it('the volume is positive and grows with the floor thickness', () => {
    const p = pack(2, 2, 2);
    const a = analyzeHolder(p, buildHolder(p)!).volumeMm3;
    const b = analyzeHolder(p, buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, floorMm: 2 })!).volumeMm3;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
});

describe('stlBinary', () => {
  it('one triangle: 84 + 50 bytes, normal +z', () => {
    const out = stlBinary([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(out.byteLength).toBe(134);
    const v = new DataView(out.buffer);
    expect(v.getUint32(80, true)).toBe(1);
    expect(v.getFloat32(84 + 8, true)).toBeCloseTo(1, 6); // nz
    expect(v.getFloat32(84 + 12 + 12, true)).toBeCloseTo(1, 6); // x of the second vertex
  });
});

describe('fillet and distant groups', () => {
  it('unionAll keeps shapes that do not touch separate', () => {
    const two = unionAll([circlePolygon(0, 0, 10), circlePolygon(21, 0, 10)]);
    expect(two).toHaveLength(2); // distanza 21 > 20: forme separate
  });

  it('a single circle does not change', () => {
    const one = unionAll([circlePolygon(0, 0, 10)]);
    const closed = closeRegions(one, 3);
    expect(regionArea(closed[0]!)).toBeCloseTo(regionArea(one[0]!), -1);
  });

  it('two overlapping circles: the fillet fills the notch (larger area)', () => {
    const u = unionAll([circlePolygon(0, 0, 10), circlePolygon(16, 0, 10)]);
    const closed = closeRegions(u, 3);
    expect(closed).toHaveLength(1);
    expect(regionArea(closed[0]!)).toBeGreaterThan(regionArea(u[0]!) + 1);
  });

  it('cells in two distant groups: the holder has the walls of both', () => {
    const base = pack(2, 1, 2);
    const far = { ...base, cells: base.cells.map((c, i) => ({ ...c, x: c.x + i * 300 })) };
    const h = buildHolder(far)!;
    expect(h.wall).toHaveLength(2);
    expect(h.slab).toHaveLength(2);
  });
});

describe('slices and chamfer', () => {
  const s = DEFAULT_HOLDER_SETTINGS;

  it('the slices cover the whole thickness, with no gaps', () => {
    const h = buildHolder(pack(2, 2, 2))!;
    expect(h.layers[0]!.z0).toBe(0);
    expect(h.layers[h.layers.length - 1]!.z1).toBeCloseTo(h.totalMm, 6);
    for (let i = 1; i < h.layers.length; i++) expect(h.layers[i]!.z0).toBeCloseTo(h.layers[i - 1]!.z1, 6);
    expect(h.totalMm).toBeCloseTo(s.floorMm + s.lipMm, 6);
  });

  it('on the outer face of the floor the outline is set back by about the chamfer', () => {
    const h = buildHolder(pack(1, 1))!;
    const width = (rs: { outline: { x: number }[] }[]) => Math.max(...rs.flatMap((r) => r.outline.map((p) => p.x))) - Math.min(...rs.flatMap((r) => r.outline.map((p) => p.x)));
    const full = width(h.wall);
    const first = width(h.layers[0]!.regions);
    expect(first).toBeCloseTo(full - 2 * 0.5, 1); // first step halfway through 0.2 mm → shrink 0.5
  });

  it('ramp chamfer: few slices, paired outlines and volume close to the stepped one', () => {
    const p = pack(2, 2, 2);
    const stairs = buildHolder(p)!;
    const smooth = buildHolder(p, s, true)!;
    expect(smooth.ramp).not.toBeNull();
    expect(smooth.ramp!.contours.length).toBeGreaterThanOrEqual(1);
    expect(smooth.layers.length).toBeLessThanOrEqual(5);
    expect(smooth.layers[0]!.z0).toBe(0);
    expect(smooth.layers[smooth.layers.length - 1]!.z1).toBeCloseTo(smooth.totalMm, 6);
    for (let i = 1; i < smooth.layers.length; i++) expect(smooth.layers[i]!.z0).toBeCloseTo(smooth.layers[i - 1]!.z1, 6);
    const vs = analyzeHolder(p, stairs).volumeMm3;
    const vr = analyzeHolder(p, smooth).volumeMm3;
    expect(Math.abs(vr - vs) / vs).toBeLessThan(0.02);
  });

  it('without a chamfer there is no ramp', () => {
    expect(buildHolder(pack(2, 1, 2), { ...s, chamferMm: 0 }, true)!.ramp).toBeNull();
  });

  it('without a chamfer two slices remain: floor and walls', () => {
    const h = buildHolder(pack(2, 1, 2), { ...s, chamferMm: 0 })!;
    expect(h.layers).toHaveLength(2);
  });

  it('the chamfer removes plastic', () => {
    const p = pack(2, 2, 2);
    const withC = analyzeHolder(p, buildHolder(p)!).volumeMm3;
    const without = analyzeHolder(p, buildHolder(p, { ...s, chamferMm: 0 })!).volumeMm3;
    expect(withC).toBeLessThan(without);
  });

  it('the chamfer does not exceed three quarters of the wall', () => {
    const h = buildHolder(pack(1, 1), { ...s, chamferMm: 2 })!;
    expect(h.chamferMm).toBeLessThanOrEqual(s.wallMm * 0.75 + 1e-9);
  });
});

describe('without cell lock', () => {
  it('no floor: thickness = walls, pack as tall as the cells, no holes', () => {
    const p = pack(2, 2, 2);
    const h = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, lockCells: false })!;
    expect(h.floorMm).toBe(0);
    expect(h.slab).toHaveLength(0);
    expect(h.openingDiameterMm).toBeNull();
    expect(analyzeHolder(p, h).totalHeightMm).toBeCloseTo(70.4, 6);
    expect(analyzeHolder(p, h).issues.some((i) => i.text.includes('non le bloccano'))).toBe(true);
  });

  it('with the lock the hole is 2·(R − rim)', () => {
    const h = buildHolder(pack(1, 1))!;
    expect(h.openingDiameterMm).toBeCloseTo(2 * (10.7 - DEFAULT_HOLDER_SETTINGS.ledgeMm), 6);
  });
});

describe('rounded geometry', () => {
  const rounded = { ...DEFAULT_HOLDER_SETTINGS, shape: 'rounded' as const };

  it('the outline is convex: the area is that of its hull, larger than the cell profile', () => {
    const p = pack(3, 3, 1.5, 'square');
    const prof = buildHolder(p)!;
    const rnd = buildHolder(p, rounded)!;
    const area = (h: typeof prof) => h.wall.reduce((a, r) => a + regionArea(r), 0);
    expect(rnd.wall).toHaveLength(1);
    expect(rnd.wall[0]!.holes).toHaveLength(9); // only the pockets: no gaps between the cells
    expect(area(rnd)).toBeGreaterThanOrEqual(area(prof) - 1e-6);
  });

  it('distant cell groups stay separate', () => {
    const base = pack(2, 1, 2);
    const far = { ...base, cells: base.cells.map((c, i) => ({ ...c, x: c.x + i * 300 })) };
    expect(buildHolder(far, rounded)!.wall).toHaveLength(2);
  });

  it('with a single cell it is a circle, as in the profile', () => {
    const p = pack(1, 1);
    const a = regionArea(buildHolder(p, rounded)!.slab[0]!);
    const b = regionArea(buildHolder(p)!.slab[0]!);
    expect(a).toBeCloseTo(b, -1);
  });
});

describe('buildToleranceTest', () => {
  const none = { customCellTypes: [] };

  it('unknown cell type or no clearance: nothing', () => {
    expect(buildToleranceTest(none, 'non-esiste')).toBeNull();
    expect(buildToleranceTest(none, T, [])).toBeNull();
  });

  it('one pocket per clearance, each as wide as cell + 2 clearances', () => {
    const h = buildToleranceTest(none, T, [0.3, 0.1, 0.2])!;
    expect(h.wall).toHaveLength(1);
    const widths = h.wall[0]!.holes
      .map((ring) => {
        const xs = ring.map((p) => p.x);
        return Math.max(...xs) - Math.min(...xs);
      })
      .sort((a, b) => a - b);
    expect(widths).toHaveLength(3);
    [0.1, 0.2, 0.3].forEach((cl, i) => expect(widths[i]).toBeCloseTo(21.4 + 2 * cl, 1));
  });

  it('low walls: floor + 4 mm at most', () => {
    const h = buildToleranceTest(none, T)!;
    expect(h.lipMm).toBeLessThanOrEqual(4);
    expect(h.totalMm).toBeCloseTo(DEFAULT_HOLDER_SETTINGS.floorMm + h.lipMm, 6);
  });

  it('the clearances are engraved on the wall rim, only in the upper layers', () => {
    const h = buildToleranceTest(none, T)!;
    const holes = (l: { regions: { holes: unknown[] }[] }) => l.regions.reduce((n, r) => n + r.holes.length, 0);
    const top = h.layers[h.layers.length - 1]!;
    const wallLow = h.layers.find((l) => l.z0 <= 2 && l.z1 >= 2)!;
    expect(top.z1).toBeCloseTo(h.totalMm, 6);
    expect(holes(top)).toBeGreaterThan(holes(wallLow));
    expect(clearanceLabel(0.15)).toBe('15');
  });

  it('the clearances are ordered: the tightest on the left', () => {
    const h = buildToleranceTest(none, T, [0.3, 0.1])!;
    const holes = h.wall[0]!.holes.map((ring) => ({
      cx: (Math.max(...ring.map((p) => p.x)) + Math.min(...ring.map((p) => p.x))) / 2,
      w: Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x)),
    }));
    holes.sort((a, b) => a.cx - b.cx);
    expect(holes[0]!.w).toBeLessThan(holes[1]!.w);
  });
});
