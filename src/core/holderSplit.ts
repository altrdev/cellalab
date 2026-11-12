import { findCellType } from './catalog';
import { intersectRegions, pointInRegions, unionAll, type Region } from './clip';
import { buildHolder, fitsBed, type BuildOptions, type HolderModel, type HolderSettings } from './holder';
import type { Pt } from './polygon';
import type { Project } from './types';

/**
 * Splitting a holder larger than the print bed into pieces to glue together.
 *
 * The cells are divided into groups with a grid of vertical and horizontal cuts (the fewest pieces that
 * fit the bed). A group's piece is the holder outline intersected with the region of its cells,
 * computed with the "power diagram" of the pocket circles: the boundary between two cells is the line (radical axis)
 * that runs through the wall between the two pockets, so **a cut never crosses a pocket**, not even in the honeycomb.
 * The pieces are made with the stepped chamfer (the smooth ramp cannot be cut along the joints); the cut
 * faces are flat and unchamfered, to be glued.
 */

export interface HolderPiece {
  /** Piece label: row (A, B, …) and column (1, 2, …), for example "B2". */
  id: string;
  cellIds: string[];
  /** The two plates of this piece (same shape top and bottom), ready for the mesh and the STL. */
  model: HolderModel;
  widthMm: number;
  depthMm: number;
  /** The piece fits the bed only rotated by 90°. */
  rotated: boolean;
  /** Fits the print bed (even rotated). */
  fits: boolean;
}

export interface HolderSplit {
  pieces: HolderPiece[];
  /** Segments of the cut lines inside the material (to draw them). */
  seams: [Pt, Pt][];
  /** All the pieces fit the bed. */
  allFit: boolean;
}

const MAX_SPLITS_PER_AXIS = 8;

interface Disc {
  id: string;
  x: number;
  y: number;
  /** Pocket radius. */
  r: number;
}

/** Clips a convex polygon with the half-plane `nx·x + ny·y ≤ k` (Sutherland–Hodgman). */
function clipHalfPlane(poly: readonly Pt[], nx: number, ny: number, k: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = nx * a.x + ny * a.y - k;
    const db = nx * b.x + ny * b.y - k;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}

/** Thresholds separating `parts` groups along an axis: close to equal values, halfway between two different values. */
function thresholds(values: readonly number[], parts: number): number[] {
  const u = [...new Set(values.map((v) => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);
  if (parts <= 1 || u.length <= 1) return [];
  const lo = u[0]!;
  const hi = u[u.length - 1]!;
  const out = new Set<number>();
  for (let k = 1; k < parts; k++) {
    const ideal = lo + ((hi - lo) * k) / parts;
    let i = 0;
    while (i + 1 < u.length && u[i + 1]! <= ideal) i++;
    if (i + 1 < u.length) out.add((u[i]! + u[i + 1]!) / 2);
  }
  return [...out].sort((a, b) => a - b);
}

const indexOf = (v: number, cuts: readonly number[]) => cuts.filter((c) => c < v).length;
const rowLetter = (i: number) => String.fromCharCode(65 + i);

function bounds(regions: readonly Region[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of regions) {
    for (const p of r.outline) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Splits the holder into pieces that fit the print bed. Null if there are no cells or if the whole plate
 * already fits the bed (nothing to split).
 */
export function splitHolder(project: Project, settings: HolderSettings, opts: BuildOptions = {}): HolderSplit | null {
  const full = buildHolder(project, settings, false, opts);
  if (!full) return null;
  const width = full.bounds.maxX - full.bounds.minX;
  const depth = full.bounds.maxY - full.bounds.minY;
  if (fitsBed(width, depth, settings)) return null;

  const discs: Disc[] = project.cells.flatMap((c) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ id: c.id, x: c.x, y: c.y, r: t.diameterMm / 2 + settings.clearanceMm }] : [];
  });
  if (discs.length < 2) return null;
  const reach = Math.max(...discs.map((d) => d.r)) + settings.wallMm; // how far the outline extends from the centre of a cell

  // candidates (columns × rows) from the fewest pieces up, ties going to the most "square"
  const candidates: [number, number][] = [];
  for (let nx = 1; nx <= MAX_SPLITS_PER_AXIS; nx++) for (let ny = 1; ny <= MAX_SPLITS_PER_AXIS; ny++) if (nx * ny > 1) candidates.push([nx, ny]);
  candidates.sort((a, b) => a[0] * a[1] - b[0] * b[1] || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]));

  const box = { minX: full.bounds.minX - 2, minY: full.bounds.minY - 2, maxX: full.bounds.maxX + 2, maxY: full.bounds.maxY + 2 };
  const rect: Pt[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];

  const build = (nx: number, ny: number): HolderSplit => {
    const cx = thresholds(discs.map((d) => d.x), nx);
    const cy = thresholds(discs.map((d) => d.y), ny);
    const groups = new Map<string, { row: number; col: number; cells: Disc[] }>();
    for (const d of discs) {
      const row = indexOf(d.y, cy);
      const col = indexOf(d.x, cx);
      const key = `${row}:${col}`;
      const g = groups.get(key) ?? { row, col, cells: [] };
      g.cells.push(d);
      groups.set(key, g);
    }
    const ordered = [...groups.values()].sort((a, b) => a.row - b.row || a.col - b.col);
    const pieces: HolderPiece[] = [];
    const seams: [Pt, Pt][] = [];
    for (const g of ordered) {
      const inGroup = new Set(g.cells);
      const others = discs.filter((d) => !inGroup.has(d));
      // region of each cell of the group: the points "closer" (in power) to it than to a cell of another group
      const masks: Pt[][] = g.cells.map((c) => {
        let poly = rect;
        for (const o of others) {
          const nxp = o.x - c.x;
          const nyp = o.y - c.y;
          const k = (o.x * o.x + o.y * o.y - c.x * c.x - c.y * c.y + c.r * c.r - o.r * o.r) / 2;
          poly = clipHalfPlane(poly, nxp, nyp, k);
          if (poly.length < 3) break;
        }
        return poly;
      });
      const layers = full.layers
        .map((l) => ({ z0: l.z0, z1: l.z1, regions: intersectRegions(l.regions, masks) }))
        .filter((l) => l.regions.length > 0);
      const wall = intersectRegions(full.wall, masks);
      const slab = intersectRegions(full.slab, masks);
      const b = bounds(wall.length ? wall : layers.flatMap((l) => l.regions));
      const model: HolderModel = { ...full, layers, wall, slab, ramp: null, bounds: b };
      const w = b.maxX - b.minX;
      const d = b.maxY - b.minY;
      const fits = fitsBed(w, d, settings);
      pieces.push({
        id: `${rowLetter(g.row)}${g.col + 1}`,
        cellIds: g.cells.map((c) => c.id),
        model,
        widthMm: w,
        depthMm: d,
        rotated: fits && !(w <= settings.bedXMm && d <= settings.bedYMm),
        fits,
      });
      // cut lines: the sides of the group's region that lie inside the material
      for (const region of unionAll(masks)) {
        const ring = region.outline;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]!;
          const q = ring[(i + 1) % ring.length]!;
          if (pointInRegions({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, full.wall)) seams.push([p, q]);
        }
      }
    }
    return { pieces, seams, allFit: pieces.every((p) => p.fits) };
  };

  let best: HolderSplit | null = null;
  for (const [nx, ny] of candidates) {
    // conservative estimate before building: box of the group's cells + how far the outline extends
    const cx = thresholds(discs.map((d) => d.x), nx);
    const cy = thresholds(discs.map((d) => d.y), ny);
    const boxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const d of discs) {
      const key = `${indexOf(d.y, cy)}:${indexOf(d.x, cx)}`;
      const b = boxes.get(key) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      b.minX = Math.min(b.minX, d.x);
      b.maxX = Math.max(b.maxX, d.x);
      b.minY = Math.min(b.minY, d.y);
      b.maxY = Math.max(b.maxY, d.y);
      boxes.set(key, b);
    }
    if (![...boxes.values()].every((b) => fitsBed(b.maxX - b.minX + 2 * reach, b.maxY - b.minY + 2 * reach, settings))) continue;
    const attempt = build(nx, ny);
    if (attempt.pieces.length < 2) continue;
    if (attempt.allFit) return attempt;
    best ??= attempt;
  }
  // no grid is enough: the finest split tried is returned, with the pieces that do not fit flagged
  return best ?? build(MAX_SPLITS_PER_AXIS, MAX_SPLITS_PER_AXIS);
}
