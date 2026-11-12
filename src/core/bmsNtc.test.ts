import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { replaceCells, setBms } from './ops';
import { createProject } from './project';
import { regionArea } from './clip';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from './holder';
import { ntcSite } from './ntc';
import { T, pack } from './bmsFixtures';

describe('posto dell’NTC', () => {
  const p = pack(4, 3);

  it('sta nel vuoto tra tre celle, fuori dalle loro tasche', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    expect(site).not.toBeNull();
    expect(site.cellIds).toHaveLength(3);
    for (const id of site.cellIds) {
      const c = p.cells.find((x) => x.id === id)!;
      const dist = Math.hypot(c.x - site.x, c.y - site.y);
      expect(dist).toBeGreaterThan(10.7 + 0.15 - 1e-6); // fuori dalla tasca
      expect(dist - (10.7 + 0.15)).toBeLessThan(site.radiusMm); // ma il foro la tocca: si apre sulla cella
    }
  });

  it('il lato di uscita sposta la scelta verso quel lato', () => {
    const top = ntcSite(p, 'top', 5, 0.15)!;
    const bottom = ntcSite(p, 'bottom', 5, 0.15)!;
    expect(top.y).toBeLessThan(bottom.y);
  });

  it('con meno di tre celle o tutte in fila non c’è', () => {
    expect(ntcSite(pack(2, 1), 'top', 5, 0.15)).toBeNull();
    expect(ntcSite(replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: 4, parallel: 1, kind: 'square', gapMm: 1 })), 'top', 5, 0.15)).toBeNull();
  });

  it('la tasca apre le pareti ma non il fondo', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true)!;
    const cut = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true, { extraPockets: [site.polygon] })!;
    const vol = (m: typeof plain, inFloor: boolean) =>
      m.layers.filter((l) => (inFloor ? l.z1 <= m.floorMm + 1e-9 : l.z0 >= m.floorMm - 1e-9)).reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(vol(cut, false)).toBeLessThan(vol(plain, false));
    expect(vol(cut, true)).toBeCloseTo(vol(plain, true), 6);
  });
});

describe('NTC in una griglia quadrata', () => {
  const sq = (s: number, pp: number) =>
    setBms(replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: s, parallel: pp, kind: 'square', gapMm: 1.5 })), 'bms-4s-30a-li-ion');

  it('usa il vuoto tra quattro celle, già aperto, e non scava nulla', () => {
    const p = sq(4, 3);
    const site = ntcSite(p, 'top', 5, 0.15)!;
    expect(site).not.toBeNull();
    expect(site.open).toBe(true);
    // il centro è equidistante da quattro celle
    const ds = p.cells.map((c) => Math.hypot(c.x - site.x, c.y - site.y)).sort((a, b) => a - b);
    expect(ds[3]! - ds[0]!).toBeLessThan(1e-6);
  });

  it('con la sagoma arrotondata il vuoto è riempito e il foro toglie materiale; con quella a profilo no', () => {
    const p = sq(4, 3);
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const volume = (m: { layers: { z0: number; z1: number; regions: Parameters<typeof regionArea>[0][] }[] }) =>
      m.layers.reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    const removed = (shape: 'profile' | 'rounded') => {
      const st = { ...DEFAULT_HOLDER_SETTINGS, shape };
      return volume(buildHolder(p, st, true)!) - volume(buildHolder(p, st, true, { extraPockets: [site.polygon], throughHoles: [site.wirePolygon] })!);
    };
    expect(removed('rounded')).toBeGreaterThan(10);
    expect(removed('profile')).toBeLessThan(1e-6);
  });

  it('con celle esagonali resta il vuoto tra tre celle', () => {
    expect(ntcSite(pack(4, 3), 'top', 5, 0.15)!.open).toBe(false);
  });
});

describe('filo dell’NTC', () => {
  const p = pack(4, 3);

  it('il foro del filo passa anche nel fondo', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true)!;
    const cut = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true, { extraPockets: [site.polygon], throughHoles: [site.wirePolygon] })!;
    const floorVol = (m: typeof plain) => m.layers.filter((l) => l.z1 <= m.floorMm + 1e-9).reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(floorVol(cut)).toBeLessThan(floorVol(plain));
  });

  it('preferisce i vuoti non coperti da una lamella', () => {
    const free = ntcSite(p, 'top', 5, 0.15)!;
    expect(free.covered).toBe(false);
    // una lamella finta che copre il vuoto scelto: il sito si sposta
    const cover = [{ outline: [{ x: free.x - 6, y: free.y - 6 }, { x: free.x + 6, y: free.y - 6 }, { x: free.x + 6, y: free.y + 6 }, { x: free.x - 6, y: free.y + 6 }], holes: [] }];
    const moved = ntcSite(p, 'top', 5, 0.15, cover)!;
    expect(Math.hypot(moved.x - free.x, moved.y - free.y)).toBeGreaterThan(6);
    expect(moved.covered).toBe(false);
  });

  it('se tutti i vuoti sono coperti lo dice', () => {
    const all = [{ outline: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }], holes: [] }];
    expect(ntcSite(p, 'top', 5, 0.15, all)!.covered).toBe(true);
  });
});
