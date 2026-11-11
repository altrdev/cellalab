import { findCellType } from './catalog';
import type { CellType, Chemistry, PackGenerator, PlacedCell, Project } from './types';

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

export function createProject(name = 'Nuovo pacco'): Project {
  return { version: 1, name, customCellTypes: [], cells: [] };
}

/**
 * Impostazioni che stanno nel file del progetto ma non nella sua cronologia (lamelle, portacelle): valori già
 * pronti da scrivere. Chi li legge li ripulisce: qui sono opachi.
 */
export interface ProjectSettings {
  lamella?: unknown;
  holder?: unknown;
}

export function serializeProject(project: Project, settings?: ProjectSettings): string {
  const out: Record<string, unknown> = { ...project };
  if (settings && (settings.lamella !== undefined || settings.holder !== undefined)) {
    out.settings = { ...(settings.lamella !== undefined && { lamella: settings.lamella }), ...(settings.holder !== undefined && { holder: settings.holder }) };
  }
  return JSON.stringify(out, null, 2);
}

/** Impostazioni di lamelle e portacelle salvate nel file, se ci sono (non validate: vanno ripulite da chi le usa). */
export function parseProjectSettings(json: string): ProjectSettings {
  try {
    const raw: unknown = JSON.parse(json);
    if (!isObj(raw) || !isObj(raw.settings)) return {};
    const out: ProjectSettings = {};
    if (isObj(raw.settings.lamella)) out.lamella = raw.settings.lamella;
    if (isObj(raw.settings.holder)) out.holder = raw.settings.holder;
    return out;
  } catch {
    return {};
  }
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') throw new ProjectParseError(`${where}: "${key}" deve essere un testo`);
  return v;
}
function num(o: Obj, key: string, where: string, { positive = false } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || (positive && v <= 0)) {
    throw new ProjectParseError(`${where}: "${key}" deve essere un numero${positive ? ' positivo' : ''}`);
  }
  return v;
}

function parseCellType(raw: unknown, index: number): CellType {
  const where = `customCellTypes[${index}]`;
  if (!isObj(raw)) throw new ProjectParseError(`${where}: oggetto atteso`);
  const chemistry = raw.chemistry;
  if (chemistry !== 'li-ion' && chemistry !== 'lifepo4') {
    throw new ProjectParseError(`${where}: chimica non valida`);
  }
  const type: CellType = {
    id: str(raw, 'id', where),
    name: str(raw, 'name', where),
    chemistry: chemistry as Chemistry,
    diameterMm: num(raw, 'diameterMm', where, { positive: true }),
    heightMm: num(raw, 'heightMm', where, { positive: true }),
    nominalV: num(raw, 'nominalV', where, { positive: true }),
    maxV: num(raw, 'maxV', where, { positive: true }),
    minV: num(raw, 'minV', where, { positive: true }),
    capacityAh: num(raw, 'capacityAh', where, { positive: true }),
    maxDischargeA: num(raw, 'maxDischargeA', where, { positive: true }),
    weightG: num(raw, 'weightG', where, { positive: true }),
  };
  if (raw.priceEur !== undefined) type.priceEur = num(raw, 'priceEur', where);
  if (raw.generic === true) type.generic = true;
  return type;
}

function parseCell(raw: unknown, index: number): PlacedCell {
  const where = `cells[${index}]`;
  if (!isObj(raw)) throw new ProjectParseError(`${where}: oggetto atteso`);
  if (typeof raw.plusUp !== 'boolean') throw new ProjectParseError(`${where}: "plusUp" deve essere vero/falso`);
  const g = raw.group;
  if (g !== null && (typeof g !== 'number' || !Number.isInteger(g) || g < 0)) {
    throw new ProjectParseError(`${where}: "group" deve essere un intero >= 0 oppure null`);
  }
  return {
    id: str(raw, 'id', where),
    typeId: str(raw, 'typeId', where),
    x: num(raw, 'x', where),
    y: num(raw, 'y', where),
    plusUp: raw.plusUp,
    group: g,
  };
}

/** La ricetta di generazione è facoltativa: se è malformata si ignora (il pacco resta valido, solo «a mano»). */
function parseGenerator(raw: unknown): PackGenerator | undefined {
  if (!isObj(raw)) return undefined;
  const { series, parallel, kind, gapMm, pitchMm, typeId } = raw;
  const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
  const posNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!posInt(series) || !posInt(parallel)) return undefined;
  if (kind !== 'hex' && kind !== 'square') return undefined;
  if (typeof gapMm !== 'number' || !Number.isFinite(gapMm) || gapMm < 0) return undefined;
  if (!posNum(pitchMm) || typeof typeId !== 'string' || typeId === '') return undefined;
  return { series, parallel, kind, gapMm, pitchMm, typeId };
}

/** Legge e valida un progetto salvato. Costruisce oggetti nuovi campo per campo: non copia chiavi sconosciute. */
export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectParseError('Il file non è un JSON valido');
  }
  if (!isObj(raw)) throw new ProjectParseError('Radice del progetto non valida');
  if (raw.version !== 1) throw new ProjectParseError(`Versione del progetto non supportata: ${String(raw.version)}`);
  if (typeof raw.name !== 'string') throw new ProjectParseError('"name" deve essere un testo');
  if (!Array.isArray(raw.customCellTypes)) throw new ProjectParseError('"customCellTypes" deve essere una lista');
  if (!Array.isArray(raw.cells)) throw new ProjectParseError('"cells" deve essere una lista');

  const customCellTypes = raw.customCellTypes.map(parseCellType);
  const cells = raw.cells.map(parseCell);
  const project: Project = { version: 1, name: raw.name, customCellTypes, cells };
  const generator = parseGenerator(raw.generator);
  if (generator && cells.length > 0) project.generator = generator;
  if (typeof raw.currentLimitA === 'number' && Number.isFinite(raw.currentLimitA) && raw.currentLimitA > 0) {
    project.currentLimitA = raw.currentLimitA;
  }

  const seen = new Set<string>();
  for (const cell of cells) {
    if (seen.has(cell.id)) throw new ProjectParseError(`Id cella duplicato: ${cell.id}`);
    seen.add(cell.id);
    if (!findCellType(project, cell.typeId)) {
      throw new ProjectParseError(`Tipo di cella sconosciuto: ${cell.typeId}`);
    }
  }
  return project;
}
