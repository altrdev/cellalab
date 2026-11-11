import { slotIndexOf, slotPosition } from './lattice';
import { findBmsType } from './bms';
import type { BmsType, CellType, PackGenerator, PlacedCell, Project } from './types';
import { t } from '../i18n';

/** Operazioni pure sul progetto: ricevono un Project e ne restituiscono uno nuovo. */

let counter = 0;
export function newId(prefix = 'c'): string {
  // randomUUID è disponibile nei browser moderni e in Node; il contatore evita collisioni nei test.
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
  // senza celle non c'è più un pacco generato da ricordare
  return cells.length === 0 ? clearPack(project) : { ...project, cells };
}

/** Toglie tutte le celle e la ricetta di generazione. */
export function clearPack(project: Project): Project {
  const { generator: _generator, ...rest } = project;
  return { ...rest, cells: [] };
}

/** Ricorda come è stato generato il pacco (o lo dimentica con `undefined`). */
export function setGenerator(project: Project, generator: PackGenerator | undefined): Project {
  if (generator) return { ...project, generator };
  const { generator: _generator, ...rest } = project;
  return rest;
}

/**
 * Adegua un pacco generato a un nuovo passo/disposizione: ogni cella resta nel suo slot (colonna, riga)
 * ma sul nuovo reticolo. Gruppi, polarità e modifiche restano. Null se il pacco non ha una ricetta
 * oppure se qualche cella non sta più sul reticolo con cui era stato generato.
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

/** Sostituisce tutte le celle del progetto (es. dopo aver generato un nuovo pacco). */
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

/** Assegna i gruppi in blocco: `groups` associa l'id di una cella al suo nuovo indice di gruppo. */
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
 * Alterna la polarità tra gruppi consecutivi (gruppo pari: + sopra, dispari: − sopra),
 * così le lamelle di serie collegano celle vicine sulla stessa faccia. Salta le celle senza gruppo.
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

/** Sostituisce un tipo di cella personalizzato (stesso id). */
export function updateCustomCellType(project: Project, type: CellType): Project {
  if (!project.customCellTypes.some((t) => t.id === type.id)) {
    throw new Error(t('ops.err.noCustom', { id: type.id }));
  }
  return { ...project, customCellTypes: project.customCellTypes.map((t) => (t.id === type.id ? type : t)) };
}

/** Elimina un tipo personalizzato, se nessuna cella del progetto lo usa. */
export function removeCustomCellType(project: Project, id: string): Project {
  if (!project.customCellTypes.some((t) => t.id === id)) return project;
  const used = project.cells.filter((c) => c.typeId === id).length;
  if (used > 0) throw new Error(t('ops.err.used', { n: used }));
  return { ...project, customCellTypes: project.customCellTypes.filter((t) => t.id !== id) };
}

/**
 * Assegna le celle a un gruppo (la "serie a pennello"). Con `alternatePolarity` imposta anche la
 * polarità secondo la parità del gruppo (pari: + sopra), come «Alterna polarità tra gruppi».
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

/** Imposta la corrente continua di progetto del pacco (il tuo uso, tetto del BMS); `undefined` o valore non valido lo toglie. */
export function setCurrentLimit(project: Project, limitA: number | undefined): Project {
  if (limitA !== undefined && Number.isFinite(limitA) && limitA > 0) return { ...project, currentLimitA: limitA };
  const { currentLimitA: _limit, ...rest } = project;
  return rest;
}

/** Sceglie il BMS del pacco; `undefined` lo toglie. */
export function setBms(project: Project, id: string | undefined): Project {
  if (id === undefined || id === '') {
    const { bmsId: _id, ...rest } = project;
    return rest;
  }
  return project.bmsId === id ? project : { ...project, bmsId: id };
}

export function addCustomBms(project: Project, type: BmsType): Project {
  if (findBmsType(project, type.id)) throw new Error(t('ops.err.dupBms', { id: type.id }));
  return { ...project, customBmsTypes: [...(project.customBmsTypes ?? []), type] };
}

/** Toglie un BMS personalizzato; se era quello scelto, il pacco resta senza BMS. */
export function removeCustomBms(project: Project, id: string): Project {
  if (!project.customBmsTypes?.some((b) => b.id === id)) return project;
  const { bmsId, customBmsTypes, ...rest } = project;
  const left = customBmsTypes.filter((b) => b.id !== id);
  return { ...rest, ...(left.length > 0 && { customBmsTypes: left }), ...(bmsId !== undefined && bmsId !== id && { bmsId }) };
}

/** Cambia il tipo di cella delle celle indicate (tutte se `ids` è omesso). Posizioni, gruppi e polarità restano. */
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
