import { describe, expect, it } from 'vitest';
import { uniqueTypeId, validateCellType } from './celltype';
import { addCustomCellType } from './ops';
import { createProject } from './project';
import type { CellType } from './types';

const ok: CellType = {
  id: 'x',
  name: 'Mia cella',
  chemistry: 'li-ion',
  diameterMm: 21.4,
  heightMm: 70.4,
  nominalV: 3.6,
  maxV: 4.2,
  minV: 2.5,
  capacityAh: 5,
  maxDischargeA: 10,
  weightG: 69,
  priceEur: 3.5,
};

describe('validateCellType', () => {
  it('a correct cell has no problems', () => {
    expect(validateCellType(ok)).toEqual([]);
    expect(validateCellType({ ...ok, priceEur: undefined })).toEqual([]);
    expect(validateCellType({ ...ok, priceEur: 0 })).toEqual([]);
  });

  it.each([
    ['empty name', { name: '  ' }, /nome/],
    ['zero diameter', { diameterMm: 0 }, /diametro/],
    ['negative height', { heightMm: -1 }, /altezza/i],
    ['NaN capacity', { capacityAh: NaN }, /capacità/],
    ['huge weight', { weightG: 99999 }, /troppo grande/],
    ['voltages out of order', { minV: 4.3 }, /in ordine/],
    ['nominal equal to the maximum', { nominalV: 4.2 }, /in ordine/],
    ['negative price', { priceEur: -1 }, /prezzo/],
  ])('flags: %s', (_n, change, expected) => {
    const problems = validateCellType({ ...ok, ...change });
    expect(problems.some((p) => expected.test(p))).toBe(true);
  });

  it('lists all the problems together', () => {
    expect(validateCellType({ ...ok, name: '', diameterMm: 0, priceEur: -2 }).length).toBeGreaterThanOrEqual(3);
  });
});

describe('uniqueTypeId', () => {
  it('derives a readable id from the name, without accents', () => {
    expect(uniqueTypeId(createProject(), 'Cella Più Forte!')).toBe('mia-cella-piu-forte');
    expect(uniqueTypeId(createProject(), '###')).toBe('mia-cella');
  });

  it('avoids duplicates among the project\'s types', () => {
    let p = createProject();
    p = addCustomCellType(p, { ...ok, id: uniqueTypeId(p, 'Prova') });
    expect(p.customCellTypes[0]!.id).toBe('mia-prova');
    expect(uniqueTypeId(p, 'Prova')).toBe('mia-prova-2');
  });
});
