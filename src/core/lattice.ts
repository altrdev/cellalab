import type { Rect } from './geometry';

/**
 * Lattice of "slots": the positions where a cell fits exactly next to the others.
 * It is the same lattice used by the S×P generator, the editor (snap and grid) and the checks,
 * so hand-placed cells end up aligned with generated ones. Fixed origin at (0, 0).
 *
 *  - `square`: quadrato, passo = diametro + spazio.
 *  - `hex`: horizontal rows with vertical pitch pitch·√3/2, and odd rows offset by half a pitch
 *    horizontally: every cell has 6 neighbours at the same distance (compact packing).
 */

export type LatticeKind = 'square' | 'hex';

export interface Lattice {
  kind: LatticeKind;
  /** Distance between the centres of two neighbouring cells, in mm. */
  pitchMm: number;
}

export interface Point {
  x: number;
  y: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0; // "+ 0" avoids -0
const isOdd = (n: number) => Math.abs(n) % 2 === 1;

const yStep = (l: Lattice) => (l.kind === 'hex' ? (l.pitchMm * Math.sqrt(3)) / 2 : l.pitchMm);
const xOffset = (l: Lattice, row: number) => (l.kind === 'hex' && isOdd(row) ? l.pitchMm / 2 : 0);

/** Centre of the slot at column `col` and row `row` (integer indices, even negative). */
export function slotPosition(l: Lattice, col: number, row: number): Point {
  return {
    x: round3(col * l.pitchMm + xOffset(l, row)),
    y: round3(row * yStep(l)),
  };
}

/** Indices (column, row) of the slot the point is on; null if it is not on a slot (within `tolMm`). */
export function slotIndexOf(l: Lattice, x: number, y: number, tolMm = 0.02): { col: number; row: number } | null {
  if (!(l.pitchMm > 0)) return null;
  const row = Math.round(y / yStep(l));
  const col = Math.round((x - xOffset(l, row)) / l.pitchMm);
  const p = slotPosition(l, col, row);
  return Math.hypot(p.x - x, p.y - y) <= tolMm ? { col, row } : null;
}

/** Slot closest to the given point. */
export function snapToSlot(l: Lattice, x: number, y: number): Point {
  const ys = yStep(l);
  const r0 = Math.round(y / ys);
  let best: Point | null = null;
  let bestD = Infinity;
  // In the hexagonal lattice the closest one may be in a row next to the rounded one.
  for (let row = r0 - 1; row <= r0 + 1; row++) {
    const col = Math.round((x - xOffset(l, row)) / l.pitchMm);
    const p = slotPosition(l, col, row);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = p;
    }
  }
  return best!;
}

/**
 * All the slots inside the rectangle (to draw the grid). Returns null if there are
 * more than `max`: when zoomed far out it makes no sense to draw them.
 */
export function slotsInRect(l: Lattice, rect: Rect, max: number): Point[] | null {
  if (!(l.pitchMm > 0)) return null;
  const ys = yStep(l);
  const rowMin = Math.floor(rect.minY / ys) - 1;
  const rowMax = Math.ceil(rect.maxY / ys) + 1;
  const estimate = ((rowMax - rowMin + 1) * (rect.maxX - rect.minX + 2 * l.pitchMm)) / l.pitchMm;
  if (estimate > max * 1.5) return null;
  const out: Point[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    const off = xOffset(l, row);
    const colMin = Math.floor((rect.minX - off) / l.pitchMm) - 1;
    const colMax = Math.ceil((rect.maxX - off) / l.pitchMm) + 1;
    for (let col = colMin; col <= colMax; col++) {
      const p = slotPosition(l, col, row);
      if (p.x >= rect.minX - l.pitchMm && p.x <= rect.maxX + l.pitchMm && p.y >= rect.minY - l.pitchMm && p.y <= rect.maxY + l.pitchMm) {
        out.push(p);
        if (out.length > max) return null;
      }
    }
  }
  return out;
}
