import type { Rect } from './geometry';

/**
 * Reticolo degli "slot": le posizioni dove una cella si incastra esattamente accanto alle altre.
 * È lo stesso reticolo usato dal generatore S×P, dall'editor (snap e griglia) e dalle verifiche,
 * così le celle piazzate a mano risultano allineate a quelle generate. Origine fissa in (0, 0).
 *
 *  - `square`: quadrato, passo = diametro + spazio.
 *  - `hex`: file orizzontali con passo verticale passo·√3/2, e file dispari sfalsate di mezzo passo
 *    in orizzontale: ogni cella ha 6 vicini alla stessa distanza (impacchettamento compatto).
 */

export type LatticeKind = 'square' | 'hex';

export interface Lattice {
  kind: LatticeKind;
  /** Distanza tra i centri di due celle vicine, in mm. */
  pitchMm: number;
}

export interface Point {
  x: number;
  y: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0; // "+ 0" evita il -0
const isOdd = (n: number) => Math.abs(n) % 2 === 1;

const yStep = (l: Lattice) => (l.kind === 'hex' ? (l.pitchMm * Math.sqrt(3)) / 2 : l.pitchMm);
const xOffset = (l: Lattice, row: number) => (l.kind === 'hex' && isOdd(row) ? l.pitchMm / 2 : 0);

/** Centro dello slot in colonna `col` e riga `row` (indici interi, anche negativi). */
export function slotPosition(l: Lattice, col: number, row: number): Point {
  return {
    x: round3(col * l.pitchMm + xOffset(l, row)),
    y: round3(row * yStep(l)),
  };
}

/** Indici (colonna, riga) dello slot in cui sta il punto; null se non sta su uno slot (entro `tolMm`). */
export function slotIndexOf(l: Lattice, x: number, y: number, tolMm = 0.02): { col: number; row: number } | null {
  if (!(l.pitchMm > 0)) return null;
  const row = Math.round(y / yStep(l));
  const col = Math.round((x - xOffset(l, row)) / l.pitchMm);
  const p = slotPosition(l, col, row);
  return Math.hypot(p.x - x, p.y - y) <= tolMm ? { col, row } : null;
}

/** Slot più vicino al punto dato. */
export function snapToSlot(l: Lattice, x: number, y: number): Point {
  const ys = yStep(l);
  const r0 = Math.round(y / ys);
  let best: Point | null = null;
  let bestD = Infinity;
  // Nel reticolo esagonale il più vicino può stare in una fila accanto a quella arrotondata.
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
 * Tutti gli slot dentro il rettangolo (per disegnare la griglia). Restituisce null se sono
 * più di `max`: a zoom molto lontano non ha senso disegnarli.
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
