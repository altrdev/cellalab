import { slotIndexOf, slotPosition } from './lattice';
import { findBmsType } from './bms';
import { DEFAULT_BMS_MOUNT, type BmsMount, type BmsType, type CellType, type PackGenerator, type PlacedCell, type Project } from './types';
import { t } from '../i18n';

/** Pure operations on the project: they receive a Project and return a new one. */

let counter = 0;
export function newId(prefix = 'c'): string {
  // randomUUID is available in modern browsers and in Node; the counter avoids collisions in tests.
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${(counter++).toString(36)}${rand}`;
}

export interface NewCell {
  typeId: string;
  x: number;
  y: number;
  plusUp?: boolean;
  group?: number | null;
  id?: string;
}

export function addCell(project: Project, cell: NewCell): Project {
  const placed: PlacedCell = {
    id: cell.id ?? newId(),
    typeId: cell.typeId,
    x: cell.x,
    y: cell.y,
    plusUp: cell.plusUp ?? true,
    group: cell.group ?? null,
  };
  return { ...project, cells: [...project.cells, placed] };
}

function mapSelected(
  project: Project,
  ids: Iterable<string>,
  change: (cell: PlacedCell) => PlacedCell,
): Project {
  const selected = new Set(ids);
  if (selected.size === 0) return project;
  let touched = false;
  const cells = project.cells.map((c) => {
    if (!selected.has(c.id)) return c;
    const next = change(c);
    if (next !== c) touched = true;
    return next;
  });
  return touched ? { ...project, cells } : project;
}

export function moveCells(project: Project, ids: Iterable<string>, dx: number, dy: number): Project {
  if (dx === 0 && dy === 0) return project;
  return mapSelected(project, ids, (c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
}

export function removeCells(project: Project, ids: Iterable<string>): Project {
  const selected = new Set(ids);
  if (selected.size === 0) return project;
  const cells = project.cells.filter((c) => !selected.has(c.id));
  if (cells.length === project.cells.length) return project;
  // with no cells there is no generated pack to remember any more
  return cells.length === 0 ? clearPack(project) : { ...project, cells };
}

/** Removes all the cells and the generation recipe. */
export function clearPack(project: Project): Project {
  const { generator: _generator, ...rest } = project;
  return { ...rest, cells: [] };
}

/** Remembers how the pack was generated (or forgets it with `undefined`). */
export function setGenerator(project: Project, generator: PackGenerator | undefined): Project {
  if (generator) return { ...project, generator };
  const { generator: _generator, ...rest } = project;
  return rest;
}

/**
 * Adapts a generated pack to a new pitch/layout: each cell stays in its slot (column, row)
 * but on the new lattice. Groups, polarities and edits stay. Null if the pack has no recipe
 * or if some cell is no longer on the lattice it was generated with.
 */
export function applyLayout(
  project: Project,
  to: { kind: 'hex' | 'square'; gapMm: number; pitchMm: number; typeId?: string },
): Project | null {
  const g = project.generator;
  if (!g) return null;
  const from = { kind: g.kind, pitchMm: g.pitchMm };
  const next = { kind: to.kind, pitchMm: to.pitchMm };
  const cells: PlacedCell[] = [];
  for (const c of project.cells) {
    const idx = slotIndexOf(from, c.x, c.y);
    if (!idx) return null;
    const p = slotPosition(next, idx.col, idx.row);
    cells.push({ ...c, x: p.x, y: p.y, ...(to.typeId ? { typeId: to.typeId } : {}) });
  }
  return {
    ...project,
    cells,
    generator: { ...g, kind: to.kind, gapMm: to.gapMm, pitchMm: to.pitchMm, typeId: to.typeId ?? g.typeId },
  };
}

export function flipPolarity(project: Project, ids: Iterable<string>): Project {
  return mapSelected(project, ids, (c) => ({ ...c, plusUp: !c.plusUp }));
}

export function setGroup(project: Project, ids: Iterable<string>, group: number | null): Project {
  return mapSelected(project, ids, (c) => (c.group === group ? c : { ...c, group }));
}

export function addCustomCellType(project: Project, type: CellType): Project {
  if (project.customCellTypes.some((t) => t.id === type.id)) {
    throw new Error(t('ops.err.dupType', { id: type.id }));
  }
  return { ...project, customCellTypes: [...project.customCellTypes, type] };
}

/** Replaces all the project's cells (e.g. after generating a new pack). */
export function replaceCells(project: Project, cells: readonly Omit<NewCell, 'id'>[]): Project {
  return {
    ...project,
    cells: cells.map((c) => ({
      id: newId(),
      typeId: c.typeId,
      x: c.x,
      y: c.y,
      plusUp: c.plusUp ?? true,
      group: c.group ?? null,
    })),
  };
}

export function renameProject(project: Project, name: string): Project {
  return name === project.name ? project : { ...project, name };
}

/** Assigns groups in bulk: `groups` maps a cell id to its new group index. */
export function assignGroups(project: Project, groups: ReadonlyMap<string, number>): Project {
  let touched = false;
  const cells = project.cells.map((c) => {
    const g = groups.get(c.id);
    if (g === undefined || g === c.group) return c;
    touched = true;
    return { ...c, group: g };
  });
  return touched ? { ...project, cells } : project;
}

/**
 * Alternates the polarity between consecutive groups (even group: + up, odd: − up),
 * so the series strips connect nearby cells on the same face. Skips cells with no group.
 */
export function alternateGroupPolarity(project: Project, ids?: Iterable<string>): Project {
  const only = ids ? new Set(ids) : null;
  let touched = false;
  const cells = project.cells.map((c) => {
    if (c.group === null || (only && !only.has(c.id))) return c;
    const plusUp = c.group % 2 === 0;
    if (plusUp === c.plusUp) return c;
    touched = true;
    return { ...c, plusUp };
  });
  return touched ? { ...project, cells } : project;
}

/** Replaces a custom cell type (same id). */
export function updateCustomCellType(project: Project, type: CellType): Project {
  if (!project.customCellTypes.some((t) => t.id === type.id)) {
    throw new Error(t('ops.err.noCustom', { id: type.id }));
  }
  return { ...project, customCellTypes: project.customCellTypes.map((t) => (t.id === type.id ? type : t)) };
}

/** Deletes a custom type, if no cell of the project uses it. */
export function removeCustomCellType(project: Project, id: string): Project {
  if (!project.customCellTypes.some((t) => t.id === id)) return project;
  const used = project.cells.filter((c) => c.typeId === id).length;
  if (used > 0) throw new Error(t('ops.err.used', { n: used }));
  return { ...project, customCellTypes: project.customCellTypes.filter((t) => t.id !== id) };
}

/**
 * Assigns cells to a group (the "series brush"). With `alternatePolarity` it also sets the
 * polarity by the group's parity (even: + up), like "Alternate polarity between groups".
 */
export function paintGroup(
  project: Project,
  ids: Iterable<string>,
  group: number,
  options: { alternatePolarity?: boolean } = {},
): Project {
  return mapSelected(project, ids, (c) => {
    const plusUp = options.alternatePolarity ? group % 2 === 0 : c.plusUp;
    return c.group === group && c.plusUp === plusUp ? c : { ...c, group, plusUp };
  });
}

/** Sets the pack's continuous design current (your use, the BMS cap); `undefined` or an invalid value removes it. */
export function setCurrentLimit(project: Project, limitA: number | undefined): Project {
  if (limitA !== undefined && Number.isFinite(limitA) && limitA > 0) return { ...project, currentLimitA: limitA };
  const { currentLimitA: _limit, ...rest } = project;
  return rest;
}

/** Chooses the pack's BMS; `undefined` removes it. */
export function setBms(project: Project, id: string | undefined): Project {
  if (id === undefined || id === '') {
    const { bmsId: _id, ...rest } = project;
    return rest;
  }
  return project.bmsId === id ? project : { ...project, bmsId: id };
}

/** Changes the BMS mounting position (out-of-range values are brought back into the limits). */
export function setBmsMount(project: Project, mount: Partial<BmsMount>): Project {
  const cur = { ...DEFAULT_BMS_MOUNT, ...project.bmsMount, ...mount };
  const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  return {
    ...project,
    bmsMount: { mode: cur.mode, place: cur.place === 'head' ? 'head' : 'flank', along: clamp(cur.along, 0, 1), connector: cur.connector === 'end' ? 'end' : 'top', connectorEnd: cur.connectorEnd === 'end' ? 'end' : 'start', slackMm: clamp(cur.slackMm, 0, 200), tailMm: clamp(cur.tailMm, 0, 2000) },
  };
}

export function addCustomBms(project: Project, type: BmsType): Project {
  if (findBmsType(project, type.id)) throw new Error(t('ops.err.dupBms', { id: type.id }));
  return { ...project, customBmsTypes: [...(project.customBmsTypes ?? []), type] };
}

/** Removes a custom BMS; if it was the chosen one, the pack is left without a BMS. */
export function removeCustomBms(project: Project, id: string): Project {
  if (!project.customBmsTypes?.some((b) => b.id === id)) return project;
  const { bmsId, customBmsTypes, ...rest } = project;
  const left = customBmsTypes.filter((b) => b.id !== id);
  return { ...rest, ...(left.length > 0 && { customBmsTypes: left }), ...(bmsId !== undefined && bmsId !== id && { bmsId }) };
}

/** Changes the cell type of the given cells (all if `ids` is omitted). Positions, groups and polarities stay. */
export function setCellType(project: Project, typeId: string, ids?: Iterable<string>): Project {
  const only = ids ? new Set(ids) : null;
  let changed = false;
  const cells = project.cells.map((c) => {
    if ((only && !only.has(c.id)) || c.typeId === typeId) return c;
    changed = true;
    return { ...c, typeId };
  });
  return changed ? { ...project, cells } : project;
}
