import { describe, expect, it } from 'vitest';
import { setBms } from './ops';
import { pointInRegions, regionArea } from './clip';
import { circlePoints } from './polygon';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from './holder';
import { buildHarness } from './harness';
import { findAroundExits, findWireExits, findWireRoutes } from './wireExit';
import { buildStrips } from './strips';
import { pack, samplePath, closestApart } from './bmsFixtures';

describe('uscita dei fili dal portacelle, senza linguette', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const ROUND = { ...DEFAULT_HOLDER_SETTINGS, shape: 'rounded' as const }; // con la forma arrotondata la plastica tra le celle basta
  const plain = buildHolder(p, ROUND, false)!;
  const strips = buildStrips(p, { tabs: { side: 'bottom', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, style: 'none' } });
  const exits = findWireExits(p, strips, plain.wall, 'bottom', 1.21, plain.totalMm, plain.floorMm);

  it('niente linguette di bilanciamento: ogni giunzione ha il suo foro nel portacelle', () => {
    expect(strips.some((x) => x.tab)).toBe(false);
    expect(exits).toHaveLength(5);
    expect(new Set(exits.map((e) => e.stripId)).size).toBe(5);
  });

  it('il foro non sta in una tasca né sotto una lamella della sua faccia, ed è vicino al punto di saldatura', () => {
    for (const e of exits) {
      for (const hole of plain.wall.flatMap((r) => r.holes)) expect(pointInRegions(e.hole!, [{ outline: hole, holes: [] }])).toBe(false);
      const covering = strips.filter((x) => x.face === e.face).map((x) => ({ outline: x.outline, holes: x.holes }));
      expect(covering.some((c) => pointInRegions(e.hole!, [c]))).toBe(false);
      expect(Math.hypot(e.hole!.x - e.solder.x, e.hole!.y - e.solder.y)).toBeLessThanOrEqual(24);
    }
  });

  it('i fori stanno il più possibile sul bordo: a una parete stampabile dal contorno', () => {
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
      // bordo del foro a circa 0,8 mm dal contorno (un po' di più dove il contorno è curvo)
      expect(toEdge - e.diameterMm / 2).toBeLessThan(0.8 + 1.0);
    }
  });

  it('con uno smusso grande il foro resta in plastica e il contorno non cambia mai (niente rinforzi)', () => {
    for (const chamferMm of [0.6, 2]) {
      const st = { ...ROUND, chamferMm };
      const base = buildHolder(p, st, false)!;
      const ex = findWireExits(p, strips, base.wall, 'bottom', 1.21, base.totalMm, base.floorMm);
      expect(ex.length).toBe(5);
      for (const e of ex) {
        // almeno la parete stampabile attorno al foro, dentro il contorno del portacelle (che resta quello senza fori)
        const r = e.diameterMm / 2 + 0.8 - 0.05;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          expect(pointInRegions({ x: e.hole!.x + Math.cos(a) * r, y: e.hole!.y + Math.sin(a) * r }, base.wall.map((rg) => ({ outline: rg.outline, holes: [] })))).toBe(true);
        }
      }
    }
  });

  it('con il profilo della cella dove la plastica è sottile il giunto fa il giro esterno: nessun filo manca', () => {
    const prof = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, shape: 'profile' }, false)!;
    const routes = findWireRoutes(p, strips, prof.wall, 'bottom', 1.21, prof.totalMm, prof.floorMm, 0.3);
    expect(routes).toHaveLength(5);
    expect(routes.every((e) => e.hole || e.edge)).toBe(true);
    expect(new Set(routes.map((e) => e.stripId)).size).toBe(5);
  });

  it('con il profilo della cella e il rinforzo ogni giunto ha il suo foro, circondato da plastica', () => {
    for (const chamferMm of [0.6, 2]) {
      const st = { ...DEFAULT_HOLDER_SETTINGS, shape: 'profile' as const, chamferMm };
      const base = buildHolder(p, st, false)!;
      const routes = findWireRoutes(p, strips, base.wall, 'bottom', 1.21, base.totalMm, base.floorMm, 0.3, chamferMm, true);
      expect(routes).toHaveLength(5);
      expect(routes.every((e) => e.hole)).toBe(true); // nessun giro esterno
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

  it('con la forma arrotondata il rinforzo non c’è mai: il contorno non cambia', () => {
    const base = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, shape: 'rounded', chamferMm: 2 }, false)!;
    const routes = findWireRoutes(p, strips, base.wall, 'bottom', 1.21, base.totalMm, base.floorMm, 0.3, 2, false);
    expect(routes.every((e) => (e.bossMm ?? 0) === 0)).toBe(true);
  });

  it('i fori tolgono materiale alla piastra e il filo passa per il foro senza toccare gli altri', () => {
    const holes = exits.map((e) => circlePoints(e.hole!.x, e.hole!.y, e.diameterMm / 2, 16));
    const vol = (m: { layers: { z0: number; z1: number; regions: Parameters<typeof regionArea>[0][] }[] }) =>
      m.layers.reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(vol(buildHolder(p, ROUND, true)!) - vol(buildHolder(p, ROUND, true, { throughHoles: holes })!)).toBeGreaterThan(0.5);
    // cablaggio: le lamelle portano l'uscita
    for (const e of exits) strips.find((x) => x.id === e.stripId)!.wireExit = e;
    const h = buildHarness(p, strips, 0.1)!;
    expect(h.wires).toHaveLength(5);
    for (const w of h.wires) {
      const ex = exits.find((e) => e.stripId === w.stripId)!;
      expect(w.points[1]!.x).toBeCloseTo(ex.hole!.x, 6); // dal punto di saldatura al foro…
      expect(w.points[2]!.x).toBeCloseTo(ex.hole!.x, 6); // …e attraverso la piastra
      expect(Math.abs(w.points[2]!.y - w.points[1]!.y)).toBeGreaterThanOrEqual(ex.plateMm - 1e-6); // attraversa tutto lo spessore
    }
    const paths = h.wires.map((w) => samplePath(w.points));
    const closest = closestApart(paths);
    expect(closest).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });
});

describe('giro esterno del portacelle, senza linguette né fori', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, false)!;
  const strips = buildStrips(p, { tabs: { side: 'bottom', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, style: 'none' } });
  const exits = findAroundExits(p, strips, plain.wall, 'bottom', plain.totalMm, plain.floorMm, 0.3);

  it('ogni giunzione ha il suo punto di saldatura e il bordo da cui il filo scende, senza foro', () => {
    expect(exits).toHaveLength(5);
    for (const e of exits) {
      expect(e.hole).toBeUndefined();
      // lato 'bottom': d = (0, 1): il bordo sta oltre il punto di saldatura
      expect(e.edge!.y).toBeGreaterThan(e.solder.y);
      expect(e.edge!.x).toBeCloseTo(e.solder.x, 6); // in linea retta
      // il punto di saldatura sta sulla lamella
      const st = strips.find((x) => x.id === e.stripId)!;
      expect(pointInRegions(e.solder, [{ outline: st.outline, holes: st.holes }])).toBe(true);
    }
  });

  it('il corridoio è libero nel 4S3P: nessun filo passa sopra un’altra lamella', () => {
    expect(exits.every((e) => !e.blocked)).toBe(true);
  });

  it('i fili partono dal piano, vanno al bordo e scendono; senza toccarsi né entrare nella scatola', () => {
    for (const e of exits) strips.find((x) => x.id === e.stripId)!.wireExit = e;
    const h = buildHarness(p, strips, 0.1)!;
    expect(h.wires).toHaveLength(5);
    for (const w of h.wires) {
      expect(w.points[0]!.y).toBeCloseTo(w.points[1]!.y, 6); // sul piano della lamella fino al bordo
      expect(w.points[2]!.y).not.toBeCloseTo(w.points[1]!.y, 3); // poi scende
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
