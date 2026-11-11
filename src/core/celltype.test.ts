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
  it('una cella corretta non ha problemi', () => {
    expect(validateCellType(ok)).toEqual([]);
    expect(validateCellType({ ...ok, priceEur: undefined })).toEqual([]);
    expect(validateCellType({ ...ok, priceEur: 0 })).toEqual([]);
  });

  it.each([
    ['nome vuoto', { name: '  ' }, /nome/],
    ['diametro zero', { diameterMm: 0 }, /diametro/],
    ['altezza negativa', { heightMm: -1 }, /altezza/i],
    ['capacità NaN', { capacityAh: NaN }, /capacità/],
    ['peso enorme', { weightG: 99999 }, /troppo grande/],
    ['tensioni fuori ordine', { minV: 4.3 }, /in ordine/],
    ['nominale uguale al massimo', { nominalV: 4.2 }, /in ordine/],
    ['prezzo negativo', { priceEur: -1 }, /prezzo/],
  ])('segnala: %s', (_n, change, expected) => {
    const problems = validateCellType({ ...ok, ...change });
    expect(problems.some((p) => expected.test(p))).toBe(true);
  });

  it('elenca tutti i problemi insieme', () => {
    expect(validateCellType({ ...ok, name: '', diameterMm: 0, priceEur: -2 }).length).toBeGreaterThanOrEqual(3);
  });
});

describe('uniqueTypeId', () => {
  it('ricava un id leggibile dal nome, senza accenti', () => {
    expect(uniqueTypeId(createProject(), 'Cella Più Forte!')).toBe('mia-cella-piu-forte');
    expect(uniqueTypeId(createProject(), '###')).toBe('mia-cella');
  });

  it('evita i duplicati tra i tipi del progetto', () => {
    let p = createProject();
    p = addCustomCellType(p, { ...ok, id: uniqueTypeId(p, 'Prova') });
    expect(p.customCellTypes[0]!.id).toBe('mia-prova');
    expect(uniqueTypeId(p, 'Prova')).toBe('mia-prova-2');
  });
});
