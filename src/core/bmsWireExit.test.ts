import { describe, expect, it } from 'vitest';
import { setBms } from './ops';
import { pointInRegions, regionArea } from './clip';
import { circlePoints } from './polygon';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from './holder';
import { buildHarness } from './harness';
import { findAroundExits, findWireExits, findWireRoutes } from './wireExit';
import { buildStrips } from './strips';
import { pack, samplePath, closestApart } from './bmsFixtures';

describe('wire exit from the holder, without tabs', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const ROUND = { ...DEFAULT_HOLDER_SETTINGS, shape: 'rounded' as const }; // with the rounded shape the plastic between the cells is enough
  const plain = buildHolder(p, ROUND, false)!;
  const strips = buildStrips(p, { tabs: { side: 'bottom', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, style: 'none' } });
  const exits = findWireExits(p, strips, plain.wall, 'bottom', 1.21, plain.totalMm, plain.floorMm);

  it('no balance tabs: each joint has its own hole in the holder', () => {
    expect(strips.some((x) => x.tab)).toBe(false);
    expect(exits).toHaveLength(5);
    expect(new Set(exits.map((e) => e.stripId)).size).toBe(5);
  });

  it('the hole is neither in a pocket nor under a strip of its face, and is close to the solder point', () => {
    for (const e of exits) {
      for (const hole of plain.wall.flatMap((r) => r.holes)) expect(pointInRegions(e.hole!, [{ outline: hole, holes: [] }])).toBe(false);
      const covering = strips.filter((x) => x.face === e.face).map((x) => ({ outline: x.outline, holes: x.holes }));
      expect(covering.some((c) => pointInRegions(e.hole!, [c]))).toBe(false);
      expect(Math.hypot(e.hole!.x - e.solder.x, e.hole!.y - e.solder.y)).toBeLessThanOrEqual(24);
    }
  });

  it('the holes are as close to the edge as possible: one printable wall from the outline', () => {
    const dist = (q: { x: number; y: number }, ring: { x: number; y: number }[]) => {
      let best = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((q.x - a.x) * ex + (q.y - a.y) * ey) / (ex * ex + ey * ey)));
        best = Math.min(best, Math.hypot(q.x - (a.x + t * ex), q.y - (a.y + t * ey)));
      }
      return best;
    };
    for (const e of exits) {
      const toEdge = Math.min(...plain.wall.map((r) => dist(e.hole!, r.outline)));
      // hole edge about 0.8 mm from the outline (a bit more where the outline is curved)
      expect(toEdge - e.diameterMm / 2).toBeLessThan(0.8 + 1.0);
    }
  });

  it('with a big chamfer the hole stays in plastic and the outline never changes (no bosses)', () => {
    for (const chamferMm of [0.6, 2]) {
      const st = { ...ROUND, chamferMm };
      const base = buildHolder(p, st, false)!;
      const ex = findWireExits(p, strips, base.wall, 'bottom', 1.21, base.totalMm, base.floorMm);
      expect(ex.length).toBe(5);
      for (const e of ex) {
        // at least the printable wall around the hole, inside the holder outline (which stays the one without holes)
        const r = e.diameterMm / 2 + 0.8 - 0.05;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          expect(pointInRegions({ x: e.hole!.x + Math.cos(a) * r, y: e.hole!.y + Math.sin(a) * r }, base.wall.map((rg) => ({ outline: rg.outline, holes: [] })))).toBe(true);
        }
      }
    }
  });

  it('with the cell profile where the plastic is thin the joint takes the around route: no wire is missing', () => {
    const prof = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, shape: 'profile' }, false)!;
    const routes = findWireRoutes(p, strips, prof.wall, 'bottom', 1.21, prof.totalMm, prof.floorMm, 0.3);
    expect(routes).toHaveLength(5);
    expect(routes.every((e) => e.hole || e.edge)).toBe(true);
    expect(new Set(routes.map((e) => e.stripId)).size).toBe(5);
  });

  it('with the cell profile and the boss every joint has its hole, surrounded by plastic', () => {
    for (const chamferMm of [0.6, 2]) {
      const st = { ...DEFAULT_HOLDER_SETTINGS, shape: 'profile' as const, chamferMm };
      const base = buildHolder(p, st, false)!;
      const routes = findWireRoutes(p, strips, base.wall, 'bottom', 1.21, base.totalMm, base.floorMm, 0.3, chamferMm, true);
      expect(routes).toHaveLength(5);
      expect(routes.every((e) => e.hole)).toBe(true); // no around route
      expect(routes.some((e) => (e.bossMm ?? 0) > 0)).toBe(true);
      const model = buildHolder(p, st, false, { addOuter: routes.filter((e) => (e.bossMm ?? 0) > 0).map((e) => circlePoints(e.hole!.x, e.hole!.y, e.bossMm!, 24)) })!;
      for (const e of routes) {
        const r = e.diameterMm / 2 + ((e.bossMm ?? 0) > 0 ? Math.max(0.8, chamferMm + 0.5) : 0.8) - 0.05;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          expect(pointInRegions({ x: e.hole!.x + Math.cos(a) * r, y: e.hole!.y + Math.sin(a) * r }, model.wall.map((rg) => ({ outline: rg.outline, holes: [] })))).toBe(true);
        }
      }
    }
  });

  it('with the rounded shape there is never a boss: the outline does not change', () => {
    const base = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, shape: 'rounded', chamferMm: 2 }, false)!;
    const routes = findWireRoutes(p, strips, base.wall, 'bottom', 1.21, base.totalMm, base.floorMm, 0.3, 2, false);
    expect(routes.every((e) => (e.bossMm ?? 0) === 0)).toBe(true);
  });

  it('the holes remove material from the plate and the wire passes through the hole without touching the others', () => {
    const holes = exits.map((e) => circlePoints(e.hole!.x, e.hole!.y, e.diameterMm / 2, 16));
    const vol = (m: { layers: { z0: number; z1: number; regions: Parameters<typeof regionArea>[0][] }[] }) =>
      m.layers.reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(vol(buildHolder(p, ROUND, true)!) - vol(buildHolder(p, ROUND, true, { throughHoles: holes })!)).toBeGreaterThan(0.5);
    // harness: the strips carry the exit
    for (const e of exits) strips.find((x) => x.id === e.stripId)!.wireExit = e;
    const h = buildHarness(p, strips, 0.1)!;
    expect(h.wires).toHaveLength(5);
    for (const w of h.wires) {
      const ex = exits.find((e) => e.stripId === w.stripId)!;
      expect(w.points[1]!.x).toBeCloseTo(ex.hole!.x, 6); // from the solder point to the hole…
      expect(w.points[2]!.x).toBeCloseTo(ex.hole!.x, 6); // …and through the plate
      expect(Math.abs(w.points[2]!.y - w.points[1]!.y)).toBeGreaterThanOrEqual(ex.plateMm - 1e-6); // crosses the whole thickness
    }
    const paths = h.wires.map((w) => samplePath(w.points));
    const closest = closestApart(paths);
    expect(closest).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });
});

describe('holder around route, without tabs or holes', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, false)!;
  const strips = buildStrips(p, { tabs: { side: 'bottom', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, style: 'none' } });
  const exits = findAroundExits(p, strips, plain.wall, 'bottom', plain.totalMm, plain.floorMm, 0.3);

  it('each joint has its solder point and the edge the wire goes down from, without a hole', () => {
    expect(exits).toHaveLength(5);
    for (const e of exits) {
      expect(e.hole).toBeUndefined();
      // side 'bottom': d = (0, 1): the edge lies beyond the solder point
      expect(e.edge!.y).toBeGreaterThan(e.solder.y);
      expect(e.edge!.x).toBeCloseTo(e.solder.x, 6); // in linea retta
      // the solder point is on the strip
      const st = strips.find((x) => x.id === e.stripId)!;
      expect(pointInRegions(e.solder, [{ outline: st.outline, holes: st.holes }])).toBe(true);
    }
  });

  it('the corridor is free in the 4S3P: no wire passes over another strip', () => {
    expect(exits.every((e) => !e.blocked)).toBe(true);
  });

  it('the wires start from the plane, go to the edge and go down; without touching each other or entering the box', () => {
    for (const e of exits) strips.find((x) => x.id === e.stripId)!.wireExit = e;
    const h = buildHarness(p, strips, 0.1)!;
    expect(h.wires).toHaveLength(5);
    for (const w of h.wires) {
      expect(w.points[0]!.y).toBeCloseTo(w.points[1]!.y, 6); // on the plane of the strip up to the edge
      expect(w.points[2]!.y).not.toBeCloseTo(w.points[1]!.y, 3); // then goes down
    }
    const paths = h.wires.map((w) => samplePath(w.points));
    const closest = closestApart(paths);
    expect(closest).toBeGreaterThanOrEqual(0.9 - 1e-6);
    const box = h.box!;
    for (const path of paths) for (const q of path) {
      const inside = Math.abs(q.x - box.center.x) < box.size.x / 2 - 1e-6 && Math.abs(q.y - box.center.y) < box.size.y / 2 - 1e-6 && Math.abs(q.z - box.center.z) < box.size.z / 2 - 1e-6;
      expect(inside).toBe(false);
    }
  });
});
