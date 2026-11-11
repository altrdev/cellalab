import { slotPosition, type LatticeKind } from './lattice';
import type { NewCell } from './ops';

export type LayoutKind = LatticeKind;

export const MAX_GENERATED_CELLS = 2000;

export interface GridSpec {
  typeId: string;
  diameterMm: number;
  /** Numero di gruppi in serie (S). */
  series: number;
  /** Celle per gruppo in parallelo (P). */
  parallel: number;
  kind: LayoutKind;
  /** Spazio libero tra una cella e l'altra, in mm. */
  gapMm: number;
}

/**
 * Genera un pacco S×P: P file di S celle. Ogni gruppo in parallelo è una colonna di P celle
 * (nell'esagonale una diagonale, con le celle a contatto); i gruppi si susseguono lungo x, sugli
 * slot del reticolo condiviso (vedi lattice.ts; origine in 0,0).
 * La polarità alterna da un gruppo all'altro (+ sopra, poi − sopra, ...): è la
 * disposizione tipica per collegare i gruppi in serie con lamelle corte.
 */
export function generateGrid(spec: GridSpec): Omit<NewCell, 'id'>[] {
  const { typeId, diameterMm, series, parallel, kind, gapMm } = spec;
  if (!Number.isInteger(series) || series < 1) throw new RangeError('S deve essere un intero >= 1');
  if (!Number.isInteger(parallel) || parallel < 1) throw new RangeError('P deve essere un intero >= 1');
  if (series * parallel > MAX_GENERATED_CELLS) {
    throw new RangeError(`Troppe celle (massimo ${MAX_GENERATED_CELLS})`);
  }
  if (!(diameterMm > 0)) throw new RangeError('Diametro cella non valido');
  if (!(gapMm >= 0) || !Number.isFinite(gapMm)) throw new RangeError('Lo spazio tra le celle non può essere negativo');

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
