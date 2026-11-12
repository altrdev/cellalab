import { t } from '../i18n';
import type { BmsSize, BmsType, Chemistry, Project } from './types';

/**
 * Default BMS catalogue: GENERIC profiles only (no commercial model). Values are typical for the
 * class: always check the datasheet of the BMS you actually buy.
 */
function generic(series: number, maxCurrentA: number, chemistry: Chemistry, sizeMm: BmsSize): BmsType {
  const chem = chemistry === 'li-ion' ? 'Li-ion' : 'LiFePO4';
  return {
    id: `bms-${series}s-${maxCurrentA}a-${chemistry}`,
    get name() {
      return t('bms.generic.name', { s: series, a: maxCurrentA, chem });
    },
    minSeries: series,
    maxSeries: series,
    maxCurrentA,
    chemistries: [chemistry],
    ntc: true,
    sizeMm,
    generic: true,
  };
}

const size = (lengthMm: number, widthMm: number, thicknessMm: number): BmsSize => ({ lengthMm, widthMm, thicknessMm });

/** Dimensions are estimates per class, not measurements: overwrite them on the real BMS. */
export const BUILTIN_BMS_TYPES: readonly BmsType[] = [
  generic(4, 30, 'li-ion', size(60, 20, 4)),
  generic(7, 40, 'li-ion', size(70, 30, 5)),
  generic(10, 40, 'li-ion', size(80, 40, 5)),
  generic(13, 40, 'li-ion', size(90, 45, 6)),
  generic(14, 60, 'li-ion', size(100, 45, 8)),
  generic(20, 60, 'li-ion', size(120, 55, 10)),
  generic(4, 100, 'lifepo4', size(100, 50, 12)),
  generic(8, 100, 'lifepo4', size(120, 60, 12)),
  generic(16, 100, 'lifepo4', size(150, 70, 14)),
];

export function allBmsTypes(project: Pick<Project, 'customBmsTypes'>): BmsType[] {
  return [...(project.customBmsTypes ?? []), ...BUILTIN_BMS_TYPES];
}

export function findBmsType(project: Pick<Project, 'customBmsTypes'>, id: string): BmsType | undefined {
  return project.customBmsTypes?.find((b) => b.id === id) ?? BUILTIN_BMS_TYPES.find((b) => b.id === id);
}

/** The BMS chosen for the pack, if there is one and it still exists. */
export function bmsOf(project: Pick<Project, 'customBmsTypes' | 'bmsId'>): BmsType | undefined {
  return project.bmsId === undefined ? undefined : findBmsType(project, project.bmsId);
}

/** Range of S as text: "13S" or "10S–14S". */
export function seriesLabel(b: Pick<BmsType, 'minSeries' | 'maxSeries'>): string {
  return b.minSeries === b.maxSeries ? `${b.minSeries}S` : `${b.minSeries}S–${b.maxSeries}S`;
}

export interface BmsDraft {
  name: string;
  minSeries: number;
  maxSeries: number;
  maxCurrentA: number;
  chemistry: Chemistry;
  ntc: boolean;
  /** Dimensions: all three zero (or empty) = not specified. */
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
}

/** Error messages (empty if the data is fine) for a custom BMS. */
export function validateBms(d: BmsDraft): string[] {
  const errors: string[] = [];
  if (d.name.trim() === '') errors.push(t('bms.err.name'));
  const isInt = (n: number) => Number.isInteger(n) && n >= 1;
  if (!isInt(d.minSeries) || !isInt(d.maxSeries) || d.maxSeries < d.minSeries) errors.push(t('bms.err.series'));
  if (!(Number.isFinite(d.maxCurrentA) && d.maxCurrentA > 0)) errors.push(t('bms.err.current'));
  const dims = [d.lengthMm, d.widthMm, d.thicknessMm];
  const some = dims.some((v) => v > 0);
  if (some && !dims.every((v) => Number.isFinite(v) && v > 0)) errors.push(t('bms.err.size'));
  return errors;
}

export function uniqueBmsId(project: Pick<Project, 'customBmsTypes'>, name: string): string {
  const base = 'bms-' + (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom');
  let id = base;
  for (let n = 2; findBmsType(project, id); n++) id = `${base}-${n}`;
  return id;
}

export function bmsFromDraft(project: Pick<Project, 'customBmsTypes'>, d: BmsDraft): BmsType {
  return {
    id: uniqueBmsId(project, d.name),
    name: d.name.trim(),
    minSeries: d.minSeries,
    maxSeries: d.maxSeries,
    maxCurrentA: d.maxCurrentA,
    chemistries: [d.chemistry],
    ntc: d.ntc,
    ...(d.lengthMm > 0 && d.widthMm > 0 && d.thicknessMm > 0 && { sizeMm: size(d.lengthMm, d.widthMm, d.thicknessMm) }),
  };
}
