import { BUILTIN_CELL_TYPES } from './catalog';
import type { CellType, Project } from './types';

/** Controlli sui tipi di cella inseriti dall'utente. Restituisce l'elenco dei problemi (vuoto = valido). */
export function validateCellType(t: CellType): string[] {
  const problems: string[] = [];
  if (t.name.trim() === '') problems.push('Il nome non può essere vuoto.');
  if (t.chemistry !== 'li-ion' && t.chemistry !== 'lifepo4') problems.push('Chimica non valida.');

  const positive: [string, number, number][] = [
    ['Il diametro', t.diameterMm, 100],
    ['L’altezza', t.heightMm, 500],
    ['La tensione nominale', t.nominalV, 10],
    ['La tensione massima', t.maxV, 10],
    ['La tensione minima', t.minV, 10],
    ['La capacità', t.capacityAh, 1000],
    ['La corrente massima di scarica', t.maxDischargeA, 1000],
    ['Il peso', t.weightG, 5000],
  ];
  for (const [label, value, max] of positive) {
    if (!Number.isFinite(value) || value <= 0) problems.push(`${label} deve essere un numero maggiore di zero.`);
    else if (value > max) problems.push(`${label} sembra troppo grande (massimo ${max}).`);
  }
  if (
    Number.isFinite(t.minV) && Number.isFinite(t.nominalV) && Number.isFinite(t.maxV) &&
    !(t.minV < t.nominalV && t.nominalV < t.maxV)
  ) {
    problems.push('Le tensioni devono essere in ordine: minima < nominale < massima.');
  }
  if (t.priceEur !== undefined && (!Number.isFinite(t.priceEur) || t.priceEur < 0)) {
    problems.push('Il prezzo non può essere negativo.');
  }
  return problems;
}

/** Id leggibile ricavato dal nome, unico tra catalogo e tipi del progetto. */
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
