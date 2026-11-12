import { findCellType } from './catalog';
import { circlePolygon, intersectRegions, regionArea, type Region } from './clip';
import { circumcenter, SIDE_VECTOR, type Pt } from './polygon';
import type { Project } from './types';

/**
 * Place for the temperature sensor (NTC): the gap between three neighbouring cells, where the sensor touches the flanks of all
 * three. A central cell (the hottest) is chosen and, among the gaps that touch it, the one closest to the wire exit
 * side. The pocket is a round hole in the holder walls, opening onto the pockets of the three cells.
 */

export type NtcSide = 'top' | 'bottom' | 'left' | 'right';

export interface NtcSite {
  /** Centre of the gap between the three cells, mm. */
  x: number;
  y: number;
  /** Radius of the hole, mm. */
  radiusMm: number;
  polygon: Pt[];
  /** Through hole in the floor, as wide as the pocket: the sensor is pushed in from outside, after assembling the pack, and the wire exits there. */
  wirePolygon: Pt[];
  /** The hole falls under a strip: the sensor cannot be pushed in from outside (no other gap was free). */
  covered: boolean;
  /** The three cells the sensor touches. */
  cellIds: [string, string, string];
  /** Gap between four cells (square grid): with the "profile" outline it is already open and the hole removes nothing; with the rounded one the outline fills it and the hole is needed. */
  open: boolean;
}

/** Two cells are neighbours if their centres are at most 1.25 times the minimum distance in the pack apart. */
const NEIGHBOUR_FACTOR = 1.25;
/** In the square grid the two cells next to a third are diagonal: up to 1.5 times the pitch. */
const DIAGONAL_FACTOR = 1.5;

/**
 * The gaps suitable for the NTC, best first: those of a central cell first, and among equals those free of strips and closer to the
 * exit side. Empty if there are none (fewer than three neighbouring cells, all in a row…).
 */
export function ntcSites(project: Project, side: NtcSide, diameterMm: number, clearanceMm: number, avoid: readonly Region[] = []): NtcSite[] {
  const cells = project.cells.flatMap((c) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ id: c.id, x: c.x, y: c.y, pocket: t.diameterMm / 2 + clearanceMm }] : [];
  });
  if (cells.length < 3) return [];
  const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c.y, 0) / cells.length;
  let pitch = Infinity;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) pitch = Math.min(pitch, Math.hypot(cells[i]!.x - cells[j]!.x, cells[i]!.y - cells[j]!.y));
  }
  const near = pitch * NEIGHBOUR_FACTOR + 1e-6;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const d = SIDE_VECTOR[side];
  const radiusMm = diameterMm / 2;
  const central = [...cells].sort((a, b) => dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy }));
  const collect = (pairNear: number, open: boolean): NtcSite[] => {
    const out: NtcSite[] = [];
    const seen = new Set<string>();
    for (const c of central) {
      const around = cells.filter((o) => o !== c && dist(o, c) <= near);
      const mine: { p: Pt; ids: [string, string, string]; score: number; covered: boolean }[] = [];
      for (let i = 0; i < around.length; i++) {
        for (let j = i + 1; j < around.length; j++) {
          const a = around[i]!;
          const b = around[j]!;
          if (dist(a, b) > pairNear) continue;
          const p = circumcenter(c, a, b);
          if (!p) continue;
          // must be a real gap: outside the pockets of all the cells
          if (cells.some((o) => dist(o, p) < o.pocket - 1e-6)) continue;
          const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          // Free gaps (no strips over where the wire passes) win over covered ones; then the exit side counts.
          const covered = avoid.length > 0 && intersectRegions(avoid, [circlePolygon(p.x, p.y, radiusMm)]).some((r) => regionArea(r) > 0.01);
          mine.push({ p, ids: [c.id, a.id, b.id], score: p.x * d.x + p.y * d.y, covered });
        }
      }
      mine.sort((a, b) => Number(a.covered) - Number(b.covered) || b.score - a.score);
      for (const m of mine) {
        out.push({ x: m.p.x, y: m.p.y, radiusMm, polygon: circlePolygon(m.p.x, m.p.y, radiusMm), wirePolygon: circlePolygon(m.p.x, m.p.y, radiusMm), covered: m.covered, cellIds: m.ids, open });
      }
    }
    return out;
  };
  const triples = collect(near, false);
  // Square grid: no gap between three cells, but the one between four (already open) will do.
  return triples.length > 0 ? triples : collect(pitch * DIAGONAL_FACTOR + 1e-6, true);
}

/** The most suitable gap for the NTC, or null if there is none. */
export function ntcSite(project: Project, side: NtcSide, diameterMm: number, clearanceMm: number, avoid: readonly Region[] = []): NtcSite | null {
  const all = ntcSites(project, side, diameterMm, clearanceMm, avoid);
  // a central cell with free gaps wins over a more peripheral one with covered gaps
  return all.find((s) => !s.covered) ?? all[0] ?? null;
}
