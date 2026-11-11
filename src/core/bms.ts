import { t } from '../i18n';
import type { BmsType, Chemistry, Project } from './types';

/**
 * Catalogo BMS predefinito: solo profili GENERICI (nessun modello commerciale). I valori sono tipici per la
 * classe: verificare sempre la scheda tecnica del BMS che si compra davvero.
 */
function generic(series: number, maxCurrentA: number, chemistry: Chemistry): BmsType {
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
    generic: true,
  };
}

export const BUILTIN_BMS_TYPES: readonly BmsType[] = [
  generic(4, 30, 'li-ion'),
  generic(7, 40, 'li-ion'),
  generic(10, 40, 'li-ion'),
  generic(13, 40, 'li-ion'),
  generic(14, 60, 'li-ion'),
  generic(20, 60, 'li-ion'),
  generic(4, 100, 'lifepo4'),
  generic(8, 100, 'lifepo4'),
  generic(16, 100, 'lifepo4'),
];

export function allBmsTypes(project: Pick<Project, 'customBmsTypes'>): BmsType[] {
  return [...(project.customBmsTypes ?? []), ...BUILTIN_BMS_TYPES];
}

export function findBmsType(project: Pick<Project, 'customBmsTypes'>, id: string): BmsType | undefined {
  return project.customBmsTypes?.find((b) => b.id === id) ?? BUILTIN_BMS_TYPES.find((b) => b.id === id);
}

/** Il BMS scelto per il pacco, se c'è ed esiste ancora. */
export function bmsOf(project: Pick<Project, 'customBmsTypes' | 'bmsId'>): BmsType | undefined {
  return project.bmsId === undefined ? undefined : findBmsType(project, project.bmsId);
}

/** Intervallo di S come testo: «13S» oppure «10S–14S». */
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
}

/** Messaggi di errore (vuoto se i dati vanno bene) per un BMS personalizzato. */
export function validateBms(d: BmsDraft): string[] {
  const errors: string[] = [];
  if (d.name.trim() === '') errors.push(t('bms.err.name'));
  const isInt = (n: number) => Number.isInteger(n) && n >= 1;
  if (!isInt(d.minSeries) || !isInt(d.maxSeries) || d.maxSeries < d.minSeries) errors.push(t('bms.err.series'));
  if (!(Number.isFinite(d.maxCurrentA) && d.maxCurrentA > 0)) errors.push(t('bms.err.current'));
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
  };
}
