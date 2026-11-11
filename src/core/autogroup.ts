import type { PlacedCell } from './types';

/**
 * Suggerisce la divisione di un insieme di celle in gruppi da P celle (in parallelo)
 * e il loro ordine in serie. È un'euristica: propone, l'utente può sempre correggere a mano.
 *
 * Strategie:
 *  - `x`: gruppi in colonna, ordinati da sinistra a destra. Colonne dritte (quadrato) oppure, se le
 *    celle formano esattamente P file, la k-esima cella di ogni fila (diagonali dell'esagonale);
 *  - `y`: righe regolari, ordinate dall'alto in basso;
 *  - `blob`: blocchi compatti (si parte dalla cella più a sinistra e si prendono le P-1 più vicine),
 *    messi in serie seguendo il gruppo più vicino.
 *  - `auto`: se le colonne risultano tutte allineate usa `x`; altrimenti, se le righe sono allineate,
 *    usa `y`; in tutti gli altri casi (layout irregolari, blocchi 2D) usa `blob`.
 */

export type GroupStrategy = 'auto' | 'x' | 'y' | 'blob';

export interface AutoGroupResult {
  /** id cella → indice di gruppo (già con l'offset iniziale). */
  groups: Map<string, number>;
  /** Strategia effettivamente usata. */
  strategy: Exclude<GroupStrategy, 'auto'>;
  groupCount: number;
}

/** Un gruppo conta come "allineato" se le sue celle stanno sulla stessa colonna/riga entro questa tolleranza. */
export const ALIGN_TOLERANCE_MM = 1;

type Cell = Pick<PlacedCell, 'id' | 'x' | 'y'>;

const q = (n: number) => Math.round(n * 1000); // quantizza al micron: il rumore numerico non altera l'ordine
const byXY = (a: Cell, b: Cell) => q(a.x) - q(b.x) || q(a.y) - q(b.y) || a.id.localeCompare(b.id);
const byYX = (a: Cell, b: Cell) => q(a.y) - q(b.y) || q(a.x) - q(b.x) || a.id.localeCompare(b.id);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function centroid(group: readonly Cell[]) {
  let x = 0;
  let y = 0;
  for (const c of group) {
    x += c.x;
    y += c.y;
  }
  return { x: x / group.length, y: y / group.length };
}

/** Vero se in ogni gruppo tutte le celle hanno la stessa coordinata `axis` (entro la tolleranza). */
function isAligned(groups: readonly (readonly Cell[])[], axis: 'x' | 'y'): boolean {
  return groups.every((g) => {
    const values = g.map((c) => c[axis]);
    return Math.max(...values) - Math.min(...values) <= ALIGN_TOLERANCE_MM;
  });
}

/**
 * Se le celle formano esattamente `parallel` file orizzontali con lo stesso numero di celle,
 * ogni gruppo è la k-esima cella di ciascuna fila (da sinistra): colonne dritte nel quadrato,
 * coppie/terne in diagonale nell'esagonale. Altrimenti null.
 */
function rowRankGroups<T extends Cell>(cells: readonly T[], parallel: number): T[][] | null {
  const ROW_GAP_MM = 3;
  const sorted = [...cells].sort(byYX);
  const rows: T[][] = [];
  for (const c of sorted) {
    const last = rows[rows.length - 1];
    if (last && c.y - last[0]!.y <= ROW_GAP_MM) last.push(c);
    else rows.push([c]);
  }
  if (rows.length !== parallel) return null;
  const size = cells.length / parallel;
  if (!rows.every((r) => r.length === size)) return null;
  for (const r of rows) r.sort(byXY);
  return Array.from({ length: size }, (_, k) => rows.map((r) => r[k]!));
}

/** Distanza minima tra due celle (per giudicare se un gruppo è compatto). */
function minPairDistance(cells: readonly Cell[]): number {
  let best = Infinity;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      best = Math.min(best, Math.hypot(cells[i]!.x - cells[j]!.x, cells[i]!.y - cells[j]!.y));
    }
  }
  return best;
}

function blobGroups<T extends Cell>(cells: readonly T[], parallel: number): T[][] {
  const sorted = [...cells].sort(byXY);
  const used = new Set<string>();
  const groups: T[][] = [];
  for (const seed of sorted) {
    if (used.has(seed.id)) continue;
    const near = sorted
      .filter((c) => !used.has(c.id) && c.id !== seed.id)
      .map((c) => ({ c, d: q(Math.hypot(c.x - seed.x, c.y - seed.y)) }))
      .sort((a, b) => a.d - b.d || byXY(a.c, b.c))
      .slice(0, parallel - 1)
      .map((n) => n.c);
    const group = [seed, ...near];
    group.forEach((c) => used.add(c.id));
    groups.push(group);
  }
  // Ordine in serie: si parte dal primo blocco e si passa sempre al più vicino non ancora visitato.
  const centers = groups.map(centroid);
  const order = [0];
  const left = new Set(groups.map((_, i) => i).slice(1));
  while (left.size > 0) {
    const from = centers[order[order.length - 1]!]!;
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const d = Math.hypot(centers[i]!.x - from.x, centers[i]!.y - from.y);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
  }
  return order.map((i) => groups[i]!);
}

export function suggestGroups<T extends Cell>(
  cells: readonly T[],
  parallel: number,
  options: { strategy?: GroupStrategy; startGroup?: number } = {},
): AutoGroupResult {
  const { strategy = 'auto', startGroup = 0 } = options;
  if (!Number.isInteger(parallel) || parallel < 1) throw new RangeError('P deve essere un intero >= 1');
  if (cells.length === 0) throw new RangeError('Non ci sono celle da raggruppare');
  if (cells.length % parallel !== 0) {
    throw new RangeError(
      `Le ${cells.length} celle non si dividono in gruppi da ${parallel}: ne servono multipli di ${parallel}`,
    );
  }

  const candidates: Record<Exclude<GroupStrategy, 'auto'>, () => T[][]> = {
    x: () => rowRankGroups(cells, parallel) ?? chunk([...cells].sort(byXY), parallel),
    y: () => chunk([...cells].sort(byYX), parallel),
    blob: () => blobGroups(cells, parallel),
  };

  let chosen: Exclude<GroupStrategy, 'auto'>;
  if (strategy === 'auto') {
    const rr = rowRankGroups(cells, parallel);
    const diagonalOk =
      rr !== null &&
      cells.length > 1 &&
      rr.every((g) => Math.max(...g.map((c) => c.x)) - Math.min(...g.map((c) => c.x)) <= 0.6 * minPairDistance(cells));
    if (isAligned(candidates.x(), 'x') || diagonalOk) chosen = 'x';
    else if (isAligned(candidates.y(), 'y')) chosen = 'y';
    else chosen = 'blob';
  } else {
    chosen = strategy;
  }

  const groups = new Map<string, number>();
  candidates[chosen]().forEach((group, index) => {
    for (const c of group) groups.set(c.id, startGroup + index);
  });
  return { groups, strategy: chosen, groupCount: cells.length / parallel };
}

/** Primo indice di gruppo libero dopo quelli usati dalle celle NON in `exclude`. */
export function nextFreeGroup(cells: readonly PlacedCell[], exclude: ReadonlySet<string>): number {
  let max = -1;
  for (const c of cells) if (!exclude.has(c.id) && c.group !== null) max = Math.max(max, c.group);
  return max + 1;
}
