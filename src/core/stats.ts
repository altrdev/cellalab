import { bmsOf } from './bms';
import { findCellType } from './catalog';
import type { PlacedCell, Project } from './types';

export interface PackStats {
  cellCount: number;
  /** Cells not yet assigned to a group: they do not enter the electrical calculations. */
  ungroupedCount: number;
  /** Number of groups in series (S), null if no cell is assigned. */
  series: number | null;
  /** Cells per group (P) if all groups have the same number, otherwise null. */
  parallel: number | null;
  /** E.g. "13S4P"; null if groups are missing or the groups are unequal. */
  configLabel: string | null;
  /** The group indices are not contiguous from 0 (e.g. 0,1,3): a group is missing. */
  groupGaps: boolean;
  /** There are different cell types in the same group. */
  mixedTypesInGroup: boolean;
  nominalV: number | null;
  maxV: number | null;
  minV: number | null;
  /** Pack capacity = that of the weakest group. */
  capacityAh: number | null;
  energyWh: number | null;
  /** Maximum continuous current of the cells alone = that of the weakest group. */
  cellCurrentA: number | null;
  /** Continuous pack current: the lower of the cells and the set design current. */
  maxCurrentA: number | null;
  /** true if the set design current is lower than that of the cells. */
  limitedByBms: boolean;
  weightG: number;
  /** Null if at least one cell has no price. */
  costEur: number | null;
  boundsMm: { width: number; depth: number; height: number } | null;
}

export function computeStats(project: Project): PackStats {
  const cells = project.cells;
  const types = new Map<string, NonNullable<ReturnType<typeof findCellType>>>();
  for (const c of cells) {
    if (!types.has(c.typeId)) {
      const t = findCellType(project, c.typeId);
      if (t) types.set(c.typeId, t);
    }
  }

  let weightG = 0;
  let costEur: number | null = 0;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    height = 0;
  const groups = new Map<number, PlacedCell[]>();
  let ungroupedCount = 0;

  for (const c of cells) {
    const t = types.get(c.typeId);
    if (!t) continue;
    weightG += t.weightG;
    costEur = costEur === null || t.priceEur === undefined ? null : costEur + t.priceEur;
    const r = t.diameterMm / 2;
    minX = Math.min(minX, c.x - r);
    maxX = Math.max(maxX, c.x + r);
    minY = Math.min(minY, c.y - r);
    maxY = Math.max(maxY, c.y + r);
    height = Math.max(height, t.heightMm);
    if (c.group === null) ungroupedCount++;
    else (groups.get(c.group) ?? groups.set(c.group, []).get(c.group)!).push(c);
  }

  const boundsMm =
    cells.length === 0 ? null : { width: maxX - minX, depth: maxY - minY, height };

  const base = {
    cellCount: cells.length,
    ungroupedCount,
    weightG,
    costEur: cells.length === 0 ? null : costEur,
    boundsMm,
  };

  if (groups.size === 0) {
    return {
      ...base,
      series: null,
      parallel: null,
      configLabel: null,
      groupGaps: false,
      mixedTypesInGroup: false,
      nominalV: null,
      maxV: null,
      minV: null,
      capacityAh: null,
      energyWh: null,
      cellCurrentA: null,
      maxCurrentA: null,
      limitedByBms: false,
    };
  }

  const indices = [...groups.keys()].sort((a, b) => a - b);
  const groupGaps = indices.some((g, i) => g !== i);
  let nominalV = 0,
    maxV = 0,
    minV = 0;
  let capacityAh = Infinity,
    maxCurrentA = Infinity;
  let mixedTypesInGroup = false;
  const sizes = new Set<number>();

  for (const g of indices) {
    const members = groups.get(g)!;
    sizes.add(members.length);
    const first = types.get(members[0]!.typeId)!;
    // In a parallel group the voltage is that of one cell; with mixed types the first is used.
    if (members.some((m) => m.typeId !== first.id)) mixedTypesInGroup = true;
    nominalV += first.nominalV;
    maxV += first.maxV;
    minV += first.minV;
    let groupAh = 0,
      groupA = 0;
    for (const m of members) {
      const t = types.get(m.typeId)!;
      groupAh += t.capacityAh;
      groupA += t.maxDischargeA;
    }
    capacityAh = Math.min(capacityAh, groupAh);
    maxCurrentA = Math.min(maxCurrentA, groupA);
  }

  // Current cap: the lower of the design current and that of the chosen BMS.
  const limits = [project.currentLimitA, bmsOf(project)?.maxCurrentA].filter((v): v is number => v !== undefined && v > 0);
  const limit = limits.length > 0 ? Math.min(...limits) : undefined;
  const series = indices.length;
  const parallel = sizes.size === 1 ? [...sizes][0]! : null;
  return {
    ...base,
    series,
    parallel,
    configLabel: parallel !== null && !groupGaps ? `${series}S${parallel}P` : null,
    groupGaps,
    mixedTypesInGroup,
    nominalV,
    maxV,
    minV,
    capacityAh,
    energyWh: nominalV * capacityAh,
    cellCurrentA: maxCurrentA,
    maxCurrentA: limit !== undefined ? Math.min(maxCurrentA, limit) : maxCurrentA,
    limitedByBms: limit !== undefined && limit < maxCurrentA,
  };
}
