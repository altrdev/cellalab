import { findCellType } from './catalog';
import type { PlacedCell, Project } from './types';

export interface PackStats {
  cellCount: number;
  /** Celle non ancora assegnate a un gruppo: non entrano nei calcoli elettrici. */
  ungroupedCount: number;
  /** Numero di gruppi in serie (S), null se nessuna cella è assegnata. */
  series: number | null;
  /** Celle per gruppo (P) se tutti i gruppi ne hanno lo stesso numero, altrimenti null. */
  parallel: number | null;
  /** Es. "13S4P"; null se mancano gruppi o i gruppi sono disuguali. */
  configLabel: string | null;
  /** Gli indici di gruppo non sono contigui da 0 (es. 0,1,3): manca un gruppo. */
  groupGaps: boolean;
  /** Nello stesso gruppo ci sono tipi di cella diversi. */
  mixedTypesInGroup: boolean;
  nominalV: number | null;
  maxV: number | null;
  minV: number | null;
  /** Capacità del pacco = quella del gruppo più debole. */
  capacityAh: number | null;
  energyWh: number | null;
  /** Corrente continua massima delle sole celle = quella del gruppo più debole. */
  cellCurrentA: number | null;
  /** Corrente continua del pacco: la più bassa tra celle e corrente di progetto impostata. */
  maxCurrentA: number | null;
  /** true se la corrente di progetto impostata è più bassa di quello delle celle. */
  limitedByBms: boolean;
  weightG: number;
  /** Null se almeno una cella non ha prezzo. */
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
    // In un gruppo in parallelo la tensione è quella di una cella; con tipi misti si usa la prima.
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

  const limit = project.currentLimitA !== undefined && project.currentLimitA > 0 ? project.currentLimitA : undefined;
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
