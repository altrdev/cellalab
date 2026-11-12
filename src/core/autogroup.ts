import type { PlacedCell } from './types';
import { t } from '../i18n';

/**
 * Suggests how to divide a set of cells into groups of P cells (in parallel)
 * and their series order. It is a heuristic: it proposes, the user can always fix it by hand.
 *
 * Strategie:
 *  - `x`: groups in columns, ordered left to right. Straight columns (square) or, if the
 *    cells form exactly P rows, the k-th cell of each row (diagonals of the hexagonal);
 *  - `y`: righe regolari, ordinate dall'alto in basso;
 *  - `blob`: compact blocks (start from the leftmost cell and take the P-1 nearest),
 *    put in series following the nearest group.
 *  - `auto`: if the columns are all aligned use `x`; otherwise, if the rows are aligned,
 *    use `y`; in every other case (irregular layouts, 2D blocks) use `blob`.
 */

export type GroupStrategy = 'auto' | 'x' | 'y' | 'blob';

export interface AutoGroupResult {
  /** cell id → group index (already with the initial offset). */
  groups: Map<string, number>;
  /** Strategia effettivamente usata. */
  strategy: Exclude<GroupStrategy, 'auto'>;
  groupCount: number;
}

/** A group counts as "aligned" if its cells are on the same column/row within this tolerance. */
export const ALIGN_TOLERANCE_MM = 1;

type Cell = Pick<PlacedCell, 'id' | 'x' | 'y'>;

const q = (n: number) => Math.round(n * 1000); // quantise to the micron: numeric noise does not change the order
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

/** True if in every group all cells have the same `axis` coordinate (within the tolerance). */
function isAligned(groups: readonly (readonly Cell[])[], axis: 'x' | 'y'): boolean {
  return groups.every((g) => {
    const values = g.map((c) => c[axis]);
    return Math.max(...values) - Math.min(...values) <= ALIGN_TOLERANCE_MM;
  });
}

/**
 * If the cells form exactly `parallel` horizontal rows with the same number of cells,
 * each group is the k-th cell of each row (from the left): straight columns in the square grid,
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

/** Minimum distance between two cells (to judge whether a group is compact). */
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
  // Series order: start from the first block and always move to the nearest one not yet visited.
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
  if (!Number.isInteger(parallel) || parallel < 1) throw new RangeError(t('autogroup.err.p'));
  if (cells.length === 0) throw new RangeError(t('autogroup.err.none'));
  if (cells.length % parallel !== 0) {
    throw new RangeError(t('autogroup.err.multiple', { n: cells.length, p: parallel }));
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

/** First free group index after those used by the cells NOT in `exclude`. */
export function nextFreeGroup(cells: readonly PlacedCell[], exclude: ReadonlySet<string>): number {
  let max = -1;
  for (const c of cells) if (!exclude.has(c.id) && c.group !== null) max = Math.max(max, c.group);
  return max + 1;
}
