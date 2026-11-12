import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { replaceCells, setBms } from './ops';
import { createProject } from './project';
import { regionArea } from './clip';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from './holder';
import { ntcSite } from './ntc';
import { T, pack } from './bmsFixtures';

describe('NTC place', () => {
  const p = pack(4, 3);

  it('it is in the gap between three cells, outside their pockets', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    expect(site).not.toBeNull();
    expect(site.cellIds).toHaveLength(3);
    for (const id of site.cellIds) {
      const c = p.cells.find((x) => x.id === id)!;
      const dist = Math.hypot(c.x - site.x, c.y - site.y);
      expect(dist).toBeGreaterThan(10.7 + 0.15 - 1e-6); // outside the pocket
      expect(dist - (10.7 + 0.15)).toBeLessThan(site.radiusMm); // but the hole touches it: it opens onto the cell
    }
  });

  it('the exit side shifts the choice towards that side', () => {
    const top = ntcSite(p, 'top', 5, 0.15)!;
    const bottom = ntcSite(p, 'bottom', 5, 0.15)!;
    expect(top.y).toBeLessThan(bottom.y);
  });

  it('with fewer than three cells or all in a row there is none', () => {
    expect(ntcSite(pack(2, 1), 'top', 5, 0.15)).toBeNull();
    expect(ntcSite(replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: 4, parallel: 1, kind: 'square', gapMm: 1 })), 'top', 5, 0.15)).toBeNull();
  });

  it('the pocket opens the walls but not the floor', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true)!;
    const cut = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true, { extraPockets: [site.polygon] })!;
    const vol = (m: typeof plain, inFloor: boolean) =>
      m.layers.filter((l) => (inFloor ? l.z1 <= m.floorMm + 1e-9 : l.z0 >= m.floorMm - 1e-9)).reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(vol(cut, false)).toBeLessThan(vol(plain, false));
    expect(vol(cut, true)).toBeCloseTo(vol(plain, true), 6);
  });
});

describe('NTC in a square grid', () => {
  const sq = (s: number, pp: number) =>
    setBms(replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: s, parallel: pp, kind: 'square', gapMm: 1.5 })), 'bms-4s-30a-li-ion');

  it('uses the gap between four cells, already open, and digs nothing', () => {
    const p = sq(4, 3);
    const site = ntcSite(p, 'top', 5, 0.15)!;
    expect(site).not.toBeNull();
    expect(site.open).toBe(true);
    // the centre is equidistant from four cells
    const ds = p.cells.map((c) => Math.hypot(c.x - site.x, c.y - site.y)).sort((a, b) => a - b);
    expect(ds[3]! - ds[0]!).toBeLessThan(1e-6);
  });

  it('with the rounded outline the gap is filled and the hole removes material; with the profile one it does not', () => {
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

  it('with hexagonal cells the gap between three cells remains', () => {
    expect(ntcSite(pack(4, 3), 'top', 5, 0.15)!.open).toBe(false);
  });
});

describe('NTC wire', () => {
  const p = pack(4, 3);

  it('the wire hole also goes through the floor', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true)!;
    const cut = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true, { extraPockets: [site.polygon], throughHoles: [site.wirePolygon] })!;
    const floorVol = (m: typeof plain) => m.layers.filter((l) => l.z1 <= m.floorMm + 1e-9).reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(floorVol(cut)).toBeLessThan(floorVol(plain));
  });

  it('prefers gaps not covered by a strip', () => {
    const free = ntcSite(p, 'top', 5, 0.15)!;
    expect(free.covered).toBe(false);
    // a fake strip covering the chosen gap: the site moves
    const cover = [{ outline: [{ x: free.x - 6, y: free.y - 6 }, { x: free.x + 6, y: free.y - 6 }, { x: free.x + 6, y: free.y + 6 }, { x: free.x - 6, y: free.y + 6 }], holes: [] }];
    const moved = ntcSite(p, 'top', 5, 0.15, cover)!;
    expect(Math.hypot(moved.x - free.x, moved.y - free.y)).toBeGreaterThan(6);
    expect(moved.covered).toBe(false);
  });

  it('if all the gaps are covered it says so', () => {
    const all = [{ outline: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }], holes: [] }];
    expect(ntcSite(p, 'top', 5, 0.15, all)!.covered).toBe(true);
  });
});
