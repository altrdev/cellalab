import { t, tn } from '../i18n';
import { len } from '../units';
import { bmsOf, seriesLabel } from './bms';
import { findCellType } from './catalog';
import { computeStats } from './stats';
import type { PlacedCell, Project } from './types';

/**
 * Pack checks (design rule check). Each problem carries the cells involved,
 * so the UI can highlight them.
 */

export type Severity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'overlap'
  | 'too-close'
  | 'parallel-polarity'
  | 'series-same-polarity'
  | 'ungrouped'
  | 'group-gap'
  | 'unequal-parallel'
  | 'mixed-types'
  | 'split-group'
  | 'current-over-cells'
  | 'bms-series'
  | 'bms-chemistry'
  | 'bms-current'
  | 'bms-wires';

export interface Issue {
  code: IssueCode;
  severity: Severity;
  message: string;
  cellIds: string[];
}

export interface DrcOptions {
  /** Minimum space between two cells, in mm: below this value the holder has no room for the wall. */
  minGapMm?: number;
}

export const DEFAULT_MIN_GAP_MM = 0.6;
/** Numeric tolerance: two tangent cells are not "overlapping". */
const EPS = 0.01;

const label = (group: number) => `S${group + 1}`;

function labelList(groups: number[], max = 6): string {
  const shown = groups.slice(0, max).map(label).join(', ');
  return groups.length > max ? `${shown} …` : shown;
}

/** Visits every pair of cells with less than `margin` mm of space between their edges (negative = overlapping). */
function forEachNearPair(
  cells: readonly PlacedCell[],
  radius: readonly number[],
  margin: number,
  visit: (i: number, j: number, gapMm: number) => void,
): void {
  let maxR = 0;
  for (const r of radius) maxR = Math.max(maxR, r);
  const size = 2 * maxR + margin;
  if (!(size > 0)) return;

  // Bucket grid: each cell is compared only with those in the neighbouring buckets.
  const key = (ix: number, iy: number) => `${ix},${iy}`;
  const buckets = new Map<string, number[]>();
  cells.forEach((c, i) => {
    const k = key(Math.floor(c.x / size), Math.floor(c.y / size));
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  });
  cells.forEach((c, i) => {
    const ix = Math.floor(c.x / size);
    const iy = Math.floor(c.y / size);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(key(ix + dx, iy + dy)) ?? []) {
          if (j <= i) continue; // each pair only once
          const o = cells[j]!;
          const gap = Math.hypot(c.x - o.x, c.y - o.y) - radius[i]! - radius[j]!;
          if (gap < margin) visit(i, j, gap);
        }
      }
    }
  });
}

export function runDrc(project: Project, options: DrcOptions = {}): Issue[] {
  const minGap = options.minGapMm ?? DEFAULT_MIN_GAP_MM;
  const cells = project.cells;
  const radius = cells.map((c) => (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2);
  const radiusById = new Map(cells.map((c, i) => [c.id, radius[i]!]));
  const issues: Issue[] = [];

  // --- Geometria ---------------------------------------------------------
  const overlapIds = new Set<string>();
  const closeIds = new Set<string>();
  let overlapPairs = 0;
  let closePairs = 0;
  forEachNearPair(cells, radius, minGap, (i, j, gap) => {
    const ids = [cells[i]!.id, cells[j]!.id];
    if (gap < -EPS) {
      overlapPairs++;
      ids.forEach((id) => overlapIds.add(id));
    } else {
      closePairs++;
      ids.forEach((id) => closeIds.add(id));
    }
  });
  if (overlapPairs > 0) {
    issues.push({
      code: 'overlap',
      severity: 'error',
      message: tn('drc.overlap', overlapPairs),
      cellIds: [...overlapIds],
    });
  }
  if (closePairs > 0) {
    issues.push({
      code: 'too-close',
      severity: 'warning',
      message: tn('drc.tooClose', closePairs, { gap: len(minGap, 1) }),
      cellIds: [...closeIds],
    });
  }

  // --- Topologia ---------------------------------------------------------
  const groups = new Map<number, PlacedCell[]>();
  const ungrouped: PlacedCell[] = [];
  for (const c of cells) {
    if (c.group === null) ungrouped.push(c);
    else {
      const list = groups.get(c.group);
      if (list) list.push(c);
      else groups.set(c.group, [c]);
    }
  }
  const indices = [...groups.keys()].sort((a, b) => a - b);

  if (ungrouped.length > 0) {
    issues.push({
      code: 'ungrouped',
      severity: 'warning',
      message: t('drc.ungrouped', { n: ungrouped.length }),
      cellIds: ungrouped.map((c) => c.id),
    });
  }

  if (indices.length > 0) {
    const last = indices[indices.length - 1]!;
    const missing: number[] = [];
    for (let g = 0; g <= last; g++) if (!groups.has(g)) missing.push(g);
    if (missing.length > 0) {
      issues.push({
        code: 'group-gap',
        severity: 'error',
        message: t('drc.missingGroups', { list: labelList(missing) }),
        cellIds: [],
      });
    }
  }

  // Parallel polarity: cells of the group with opposite faces get shorted.
  const uniformPolarity = new Map<number, boolean>();
  for (const g of indices) {
    const members = groups.get(g)!;
    const up = members.filter((m) => m.plusUp).length;
    if (up > 0 && up < members.length) {
      issues.push({
        code: 'parallel-polarity',
        severity: 'error',
        message: t('drc.oppositePolarity', { group: label(g) }),
        cellIds: members.map((m) => m.id),
      });
    } else {
      uniformPolarity.set(g, up > 0);
    }
  }

  // Number of cells per group: compared with the most common size.
  if (indices.length > 1) {
    const freq = new Map<number, number>();
    for (const g of indices) {
      const n = groups.get(g)!.length;
      freq.set(n, (freq.get(n) ?? 0) + 1);
    }
    let mode = 0;
    let best = 0;
    for (const [size, count] of freq) {
      if (count > best || (count === best && size > mode)) {
        mode = size;
        best = count;
      }
    }
    const odd = indices.filter((g) => groups.get(g)!.length !== mode);
    if (odd.length > 0) {
      issues.push({
        code: 'unequal-parallel',
        severity: 'warning',
        message: t('drc.groupSize', { mode, list: labelList(odd) }),
        cellIds: odd.flatMap((g) => groups.get(g)!.map((c) => c.id)),
      });
    }
  }

  const mixed = indices.filter((g) => new Set(groups.get(g)!.map((c) => c.typeId)).size > 1);
  if (mixed.length > 0) {
    issues.push({
      code: 'mixed-types',
      severity: 'warning',
      message: t('drc.mixedTypes', { list: labelList(mixed) }),
      cellIds: mixed.flatMap((g) => groups.get(g)!.map((c) => c.id)),
    });
  }

  // A group should be a single block: cells separated by gaps connect poorly.
  const split: number[] = [];
  for (const g of indices) {
    const members = groups.get(g)!;
    if (members.length < 2) continue;
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length > 0) {
      const a = members[queue.pop()!]!;
      for (let b = 0; b < members.length; b++) {
        if (seen.has(b)) continue;
        const o = members[b]!;
        const ra = radiusById.get(a.id)!;
        const rb = radiusById.get(o.id)!;
        const gap = Math.hypot(a.x - o.x, a.y - o.y) - ra - rb;
        if (gap <= Math.min(ra, rb)) {
          seen.add(b);
          queue.push(b);
        }
      }
    }
    if (seen.size < members.length) split.push(g);
  }
  if (split.length > 0) {
    issues.push({
      code: 'split-group',
      severity: 'warning',
      message: t('drc.splitGroup', { list: labelList(split) }),
      cellIds: split.flatMap((g) => groups.get(g)!.map((c) => c.id)),
    });
  }

  // Consecutive groups with the same face up: the series connection must join opposite faces.
  const samePolarity: number[] = [];
  for (let g = 0; g + 1 <= (indices[indices.length - 1] ?? -1); g++) {
    const a = uniformPolarity.get(g);
    const b = uniformPolarity.get(g + 1);
    if (a !== undefined && a === b) samePolarity.push(g);
  }
  if (samePolarity.length > 0) {
    const involved = new Set<number>();
    samePolarity.forEach((g) => {
      involved.add(g);
      involved.add(g + 1);
    });
    issues.push({
      code: 'series-same-polarity',
      severity: 'info',
      message: tn('drc.samePolarity', samePolarity.length),
      cellIds: [...involved].flatMap((g) => groups.get(g)?.map((c) => c.id) ?? []),
    });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const limit = project.currentLimitA;
  if (limit !== undefined && cells.length > 0) {
    const cellA = computeStats(project).cellCurrentA;
    if (cellA !== null && limit > cellA + 1e-9) {
      issues.push({
        code: 'current-over-cells',
        severity: 'warning',
        message: t('drc.currentOverCells', { limit, cells: cellA.toFixed(0) }),
        cellIds: [],
      });
    }
  }

  const bms = bmsOf(project);
  if (bms && cells.length > 0) {
    const series = computeStats(project).series ?? 0;
    if (series > 0 && (series < bms.minSeries || series > bms.maxSeries)) {
      issues.push({
        code: 'bms-series',
        severity: 'error',
        message: t('drc.bmsSeries', { bms: seriesLabel(bms), pack: `${series}S` }),
        cellIds: [],
      });
    }
    const wrong = new Set<string>();
    for (const c of cells) {
      const type = findCellType(project, c.typeId);
      if (type && !bms.chemistries.includes(type.chemistry)) wrong.add(c.id);
    }
    if (wrong.size > 0) {
      issues.push({ code: 'bms-chemistry', severity: 'error', message: t('drc.bmsChemistry', { bms: bms.name }), cellIds: [...wrong] });
    }
    if (limit !== undefined && limit > bms.maxCurrentA + 1e-9) {
      issues.push({
        code: 'bms-current',
        severity: 'warning',
        message: t('drc.bmsCurrent', { limit, bms: bms.maxCurrentA }),
        cellIds: [],
      });
    }
    if (series > 0) {
      issues.push({ code: 'bms-wires', severity: 'info', message: t('drc.bmsWires', { n: series + 1 }), cellIds: [] });
    }
  }

  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
