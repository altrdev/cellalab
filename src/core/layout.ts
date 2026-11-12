import { slotPosition, type LatticeKind } from './lattice';
import type { NewCell } from './ops';
import { t } from '../i18n';

export type LayoutKind = LatticeKind;

export const MAX_GENERATED_CELLS = 2000;

export interface GridSpec {
  typeId: string;
  diameterMm: number;
  /** Number of groups in series (S). */
  series: number;
  /** Cells per group in parallel (P). */
  parallel: number;
  kind: LayoutKind;
  /** Free space between one cell and the next, in mm. */
  gapMm: number;
}

/**
 * Generates an S×P pack: P rows of S cells. Each parallel group is a column of P cells
 * (in the hexagonal one a diagonal, with the cells touching); the groups follow one another along x, on the
 * slots of the shared lattice (see lattice.ts; origin at 0,0).
 * The polarity alternates from one group to the next (+ up, then − up, ...): it is the
 * typical arrangement to connect the series groups with short strips.
 */
export function generateGrid(spec: GridSpec): Omit<NewCell, 'id'>[] {
  const { typeId, diameterMm, series, parallel, kind, gapMm } = spec;
  if (!Number.isInteger(series) || series < 1) throw new RangeError(t('layout.err.s'));
  if (!Number.isInteger(parallel) || parallel < 1) throw new RangeError(t('layout.err.p'));
  if (series * parallel > MAX_GENERATED_CELLS) {
    throw new RangeError(t('layout.err.tooMany', { max: MAX_GENERATED_CELLS }));
  }
  if (!(diameterMm > 0)) throw new RangeError(t('layout.err.diameter'));
  if (!(gapMm >= 0) || !Number.isFinite(gapMm)) throw new RangeError(t('layout.err.gap'));

  const lattice = { kind, pitchMm: diameterMm + gapMm };
  const cells: Omit<NewCell, 'id'>[] = [];
  for (let g = 0; g < series; g++) {
    for (let k = 0; k < parallel; k++) {
      const { x, y } = slotPosition(lattice, g, k);
      cells.push({ typeId, x, y, plusUp: g % 2 === 0, group: g });
    }
  }
  return cells;
}
