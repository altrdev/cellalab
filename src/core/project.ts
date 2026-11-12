import { findBmsType } from './bms';
import { findCellType } from './catalog';
import { DEFAULT_BMS_MOUNT, type BmsType, type CellType, type Chemistry, type PackGenerator, type PlacedCell, type Project } from './types';
import { t } from '../i18n';

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

export function createProject(name = t('project.defaultName')): Project {
  return { version: 1, name, customCellTypes: [], cells: [] };
}

/**
 * Settings that live in the project file but not in its history (strips, holder): values ready
 * to be written. Whoever reads them cleans them up: here they are opaque.
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

/** Strip and holder settings saved in the file, if any (not validated: whoever uses them must clean them up). */
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
  if (typeof v !== 'string' || v === '') throw new ProjectParseError(t('project.err.text', { where, key }));
  return v;
}
function num(o: Obj, key: string, where: string, { positive = false } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || (positive && v <= 0)) {
    throw new ProjectParseError(t(positive ? 'project.err.numberPositive' : 'project.err.number', { where, key }));
  }
  return v;
}

function parseCellType(raw: unknown, index: number): CellType {
  const where = `customCellTypes[${index}]`;
  if (!isObj(raw)) throw new ProjectParseError(t('project.err.object', { where }));
  const chemistry = raw.chemistry;
  if (chemistry !== 'li-ion' && chemistry !== 'lifepo4') {
    throw new ProjectParseError(t('project.err.chemistry', { where }));
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

/** A malformed custom BMS is discarded (the rest of the project stays valid). */
function parseBms(raw: unknown): BmsType | undefined {
  if (!isObj(raw)) return undefined;
  const { id, name, minSeries, maxSeries, maxCurrentA, chemistries, ntc } = raw;
  const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name === '') return undefined;
  if (!posInt(minSeries) || !posInt(maxSeries) || maxSeries < minSeries) return undefined;
  if (typeof maxCurrentA !== 'number' || !Number.isFinite(maxCurrentA) || maxCurrentA <= 0) return undefined;
  if (!Array.isArray(chemistries)) return undefined;
  const chems = chemistries.filter((c): c is Chemistry => c === 'li-ion' || c === 'lifepo4');
  if (chems.length === 0) return undefined;
  const sz = raw.sizeMm;
  const okSize = isObj(sz) && [sz.lengthMm, sz.widthMm, sz.thicknessMm].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return {
    id,
    name,
    minSeries,
    maxSeries,
    maxCurrentA,
    chemistries: chems,
    ntc: ntc === true,
    ...(okSize && { sizeMm: { lengthMm: (sz as Obj).lengthMm as number, widthMm: (sz as Obj).widthMm as number, thicknessMm: (sz as Obj).thicknessMm as number } }),
  };
}

function parseCell(raw: unknown, index: number): PlacedCell {
  const where = `cells[${index}]`;
  if (!isObj(raw)) throw new ProjectParseError(t('project.err.object', { where }));
  if (typeof raw.plusUp !== 'boolean') throw new ProjectParseError(t('project.err.plusUp', { where }));
  const g = raw.group;
  if (g !== null && (typeof g !== 'number' || !Number.isInteger(g) || g < 0)) {
    throw new ProjectParseError(t('project.err.group', { where }));
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

/** The generation recipe is optional: if it is malformed it is ignored (the pack stays valid, just "by hand"). */
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

/** Reads and validates a saved project. Builds new objects field by field: it does not copy unknown keys. */
export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectParseError(t('project.err.json'));
  }
  if (!isObj(raw)) throw new ProjectParseError(t('project.err.root'));
  if (raw.version !== 1) throw new ProjectParseError(t('project.err.version', { version: String(raw.version) }));
  if (typeof raw.name !== 'string') throw new ProjectParseError(t('project.err.name'));
  if (!Array.isArray(raw.customCellTypes)) throw new ProjectParseError(t('project.err.cellTypes'));
  if (!Array.isArray(raw.cells)) throw new ProjectParseError(t('project.err.cells'));

  const customCellTypes = raw.customCellTypes.map(parseCellType);
  const cells = raw.cells.map(parseCell);
  const project: Project = { version: 1, name: raw.name, customCellTypes, cells };
  const generator = parseGenerator(raw.generator);
  if (generator && cells.length > 0) project.generator = generator;
  if (typeof raw.currentLimitA === 'number' && Number.isFinite(raw.currentLimitA) && raw.currentLimitA > 0) {
    project.currentLimitA = raw.currentLimitA;
  }

  if (Array.isArray(raw.customBmsTypes)) {
    const list = raw.customBmsTypes.map(parseBms).filter((b): b is BmsType => b !== undefined);
    if (list.length > 0) project.customBmsTypes = list;
  }
  if (isObj(raw.bmsMount)) {
    const m = raw.bmsMount;
    const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
    project.bmsMount = {
      mode: m.mode === 'external' ? 'external' : 'pack',
      place: m.place === 'head' ? 'head' : 'flank',
      along: num(m.along, 0, 1, DEFAULT_BMS_MOUNT.along),
      // old files: 'back' no longer exists, 'start'/'end' were the ends
      connector: m.connector === 'end' || m.connector === 'start' ? 'end' : 'top',
      connectorEnd: m.connectorEnd === 'end' || m.connector === 'end' ? 'end' : 'start',
      slackMm: num(m.slackMm, 0, 200, DEFAULT_BMS_MOUNT.slackMm),
      tailMm: num(m.tailMm, 0, 2000, DEFAULT_BMS_MOUNT.tailMm),
    };
  }
  // A chosen BMS that no longer exists (file edited by hand) is ignored.
  if (typeof raw.bmsId === 'string' && findBmsType(project, raw.bmsId)) project.bmsId = raw.bmsId;

  const seen = new Set<string>();
  for (const cell of cells) {
    if (seen.has(cell.id)) throw new ProjectParseError(t('project.err.dupId', { id: cell.id }));
    seen.add(cell.id);
    if (!findCellType(project, cell.typeId)) {
      throw new ProjectParseError(t('project.err.unknownType', { id: cell.typeId }));
    }
  }
  return project;
}
