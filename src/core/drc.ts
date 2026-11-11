import { findCellType } from './catalog';
import { computeStats } from './stats';
import type { PlacedCell, Project } from './types';

/**
 * Verifiche sul pacco (design rule check). Ogni problema porta con sé le celle coinvolte,
 * così l'interfaccia può evidenziarle.
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
  | 'current-over-cells';

export interface Issue {
  code: IssueCode;
  severity: Severity;
  message: string;
  cellIds: string[];
}

export interface DrcOptions {
  /** Spazio minimo tra due celle, in mm: sotto questo valore il holder non ha spazio per la parete. */
  minGapMm?: number;
}

export const DEFAULT_MIN_GAP_MM = 0.6;
/** Tolleranza numerica: due celle tangenti non sono "sovrapposte". */
const EPS = 0.01;

const label = (group: number) => `S${group + 1}`;

function labelList(groups: number[], max = 6): string {
  const shown = groups.slice(0, max).map(label).join(', ');
  return groups.length > max ? `${shown} …` : shown;
}

/** Visita ogni coppia di celle con meno di `margin` mm di spazio tra i bordi (negativo = sovrapposte). */
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

  // Griglia di secchi: ogni cella si confronta solo con quelle dei secchi vicini.
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
          if (j <= i) continue; // ogni coppia una volta sola
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
      message:
        overlapPairs === 1 ? 'Due celle si sovrappongono.' : `${overlapPairs} coppie di celle si sovrappongono.`,
      cellIds: [...overlapIds],
    });
  }
  if (closePairs > 0) {
    issues.push({
      code: 'too-close',
      severity: 'warning',
      message:
        `${closePairs === 1 ? 'Una coppia di celle ha' : `${closePairs} coppie di celle hanno`} meno di ${minGap} mm di spazio: ` +
        'il holder non ha posto per la parete.',
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
      message: `${ungrouped.length} celle senza gruppo: non entrano nei calcoli elettrici.`,
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
        message: `Mancano i gruppi ${labelList(missing)}: gli indici di serie devono essere consecutivi.`,
        cellIds: [],
      });
    }
  }

  // Polarità in parallelo: celle del gruppo con facce opposte vanno in cortocircuito.
  const uniformPolarity = new Map<number, boolean>();
  for (const g of indices) {
    const members = groups.get(g)!;
    const up = members.filter((m) => m.plusUp).length;
    if (up > 0 && up < members.length) {
      issues.push({
        code: 'parallel-polarity',
        severity: 'error',
        message: `${label(g)} ha celle con polarità opposta in parallelo: andrebbero in cortocircuito.`,
        cellIds: members.map((m) => m.id),
      });
    } else {
      uniformPolarity.set(g, up > 0);
    }
  }

  // Numero di celle per gruppo: confronto con la taglia più comune.
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
        message:
          `Numero di celle diverso dagli altri gruppi (${mode}): ${labelList(odd)}. ` +
          'Capacità e corrente seguono il gruppo più debole.',
        cellIds: odd.flatMap((g) => groups.get(g)!.map((c) => c.id)),
      });
    }
  }

  const mixed = indices.filter((g) => new Set(groups.get(g)!.map((c) => c.typeId)).size > 1);
  if (mixed.length > 0) {
    issues.push({
      code: 'mixed-types',
      severity: 'warning',
      message: `Tipi di cella diversi nello stesso gruppo: ${labelList(mixed)}.`,
      cellIds: mixed.flatMap((g) => groups.get(g)!.map((c) => c.id)),
    });
  }

  // Un gruppo dovrebbe essere un blocco unico: celle separate da buchi si collegano male.
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
      message: `Celle separate dentro lo stesso gruppo (${labelList(split)}): la lamella di collegamento sarebbe lunga o impossibile.`,
      cellIds: split.flatMap((g) => groups.get(g)!.map((c) => c.id)),
    });
  }

  // Gruppi consecutivi con la stessa faccia in alto: il collegamento in serie deve unire facce opposte.
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
      message:
        `${samePolarity.length === 1 ? 'Due gruppi consecutivi hanno' : `${samePolarity.length} coppie di gruppi consecutivi hanno`} ` +
        'la stessa polarità verso l’alto: il collegamento in serie dovrà unire facce opposte. ' +
        'Con «Alterna polarità» i gruppi si alternano e le lamelle restano corte.',
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
        message:
          `Il limite di corrente (${limit} A) supera quello che reggono le celle (${cellA.toFixed(0)} A): ` +
          'ogni cella verrebbe usata oltre la corrente massima. Abbassa il limite o aggiungi celle in parallelo.',
        cellIds: [],
      });
    }
  }

  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
