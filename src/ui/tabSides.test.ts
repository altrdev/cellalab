import { describe, expect, it } from 'vitest';
import { bmsOf } from '../core/bms';
import { generateGrid } from '../core/layout';
import { DEFAULT_LAMELLA_SETTINGS } from '../core/lamelle';
import { replaceCells, setBms } from '../core/ops';
import { createProject } from '../core/project';
import { buildStrips } from '../core/strips';
import { DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { intersectRegions, regionArea } from '../core/clip';
import { freeTabSides, ntcPlanOf, stripsOf, tabSideOf } from './lamelle';

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

describe('NTC sotto le lamelle', () => {
  const p = pack(4, 3);
  const plan = ntcPlanOf(p, DEFAULT_LAMELLA_SETTINGS, DEFAULT_HOLDER_SETTINGS);
  const strips = buildStrips(p, { tabs: { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3, powerHoleMm: 2.85 } });

  it('c’è un vuoto per il sensore', () => {
    expect(plan.site).not.toBeNull();
  });

  it('il foro del filo non tocca le lamelle di nessuna faccia', () => {
    const regions = strips.map((s) => ({ outline: s.outline, holes: s.holes }));
    expect(regions.length).toBeGreaterThan(0);
    expect(intersectRegions(regions, [plan.site!.wirePolygon]).reduce((a, r) => a + regionArea(r), 0)).toBeLessThan(0.01);
  });

  it('stripsOf usa gli stessi lati', () => {
    expect(stripsOf(p, DEFAULT_LAMELLA_SETTINGS).some((s) => s.tab)).toBe(true);
  });
});

describe('impostazioni NTC nel portacelle', () => {
  it('si leggono dal file con valori validi e tornano al default se mancano o sono sbagliate', async () => {
    const { sanitizeHolderSettings } = await import('./holder');
    expect(sanitizeHolderSettings({ ntc: false, ntcMm: 6 })).toMatchObject({ ntc: false, ntcMm: 6 });
    expect(sanitizeHolderSettings({})).toMatchObject({ ntc: true, ntcMm: 5 });
    expect(sanitizeHolderSettings({ ntc: 'sì', ntcMm: 99 })).toMatchObject({ ntc: true, ntcMm: 12 });
  });
});
