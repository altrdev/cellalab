import { describe, expect, it } from 'vitest';
import { bmsOf } from '../core/bms';
import { generateGrid } from '../core/layout';
import { DEFAULT_LAMELLA_SETTINGS } from '../core/lamelle';
import { replaceCells, setBms } from '../core/ops';
import { createProject } from '../core/project';
import { freeTabSides, tabSideOf } from './lamelle';

const pack = (s: number, p: number) =>
  setBms(replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: s, parallel: p, kind: 'hex', gapMm: 1 })), 'bms-4s-30a-li-ion');

describe('lati delle linguette', () => {
  it('in un pacco a colonne sinistra e destra sono bloccate, alto e basso liberi', () => {
    const p = pack(4, 3);
    expect(bmsOf(p)).toBeDefined();
    expect(freeTabSides(p, DEFAULT_LAMELLA_SETTINGS)).toEqual({ top: true, bottom: true, left: false, right: false });
  });

  it('automatico sceglie il primo lato libero; il lato scelto a mano resta quello', () => {
    const p = pack(4, 3);
    expect(tabSideOf(p, DEFAULT_LAMELLA_SETTINGS)).toBe('top');
    expect(tabSideOf(p, { ...DEFAULT_LAMELLA_SETTINGS, tabSide: 'left' })).toBe('left');
  });

  it('senza BMS tutti i lati sono liberi', () => {
    const p = replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 4, parallel: 3, kind: 'hex', gapMm: 1 }));
    expect(Object.values(freeTabSides(p, DEFAULT_LAMELLA_SETTINGS))).toEqual([true, true, true, true]);
  });
});
