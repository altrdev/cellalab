import { t } from '../i18n';
import { BUILTIN_CELL_TYPES } from './catalog';
import type { CellType, Project } from './types';

/** Checks on user-entered cell types. Returns the list of problems (empty = valid). */
export function validateCellType(type: CellType): string[] {
  const problems: string[] = [];
  if (type.name.trim() === '') problems.push(t('celltype.name'));
  if (type.chemistry !== 'li-ion' && type.chemistry !== 'lifepo4') problems.push(t('celltype.chemistry'));

  const positive: [string, number, number][] = [
    [t('celltype.label.diameter'), type.diameterMm, 100],
    [t('celltype.label.height'), type.heightMm, 500],
    [t('celltype.label.nominalV'), type.nominalV, 10],
    [t('celltype.label.maxV'), type.maxV, 10],
    [t('celltype.label.minV'), type.minV, 10],
    [t('celltype.label.capacity'), type.capacityAh, 1000],
    [t('celltype.label.discharge'), type.maxDischargeA, 1000],
    [t('celltype.label.weight'), type.weightG, 5000],
  ];
  for (const [label, value, max] of positive) {
    if (!Number.isFinite(value) || value <= 0) problems.push(t('celltype.positive', { label }));
    else if (value > max) problems.push(t('celltype.tooBig', { label, max }));
  }
  if (
    Number.isFinite(type.minV) && Number.isFinite(type.nominalV) && Number.isFinite(type.maxV) &&
    !(type.minV < type.nominalV && type.nominalV < type.maxV)
  ) {
    problems.push(t('celltype.voltages'));
  }
  if (type.priceEur !== undefined && (!Number.isFinite(type.priceEur) || type.priceEur < 0)) {
    problems.push(t('celltype.price'));
  }
  return problems;
}

/** Readable id derived from the name, unique among the catalogue and the project's types. */
export function uniqueTypeId(project: Pick<Project, 'customCellTypes'>, name: string): string {
  const base =
    'mia-' +
    (name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'cella');
  const taken = new Set([...BUILTIN_CELL_TYPES, ...project.customCellTypes].map((t) => t.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
