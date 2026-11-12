import { describe, expect, it } from 'vitest';
import { bmsOf } from '../core/bms';
import { generateGrid } from '../core/layout';
import { DEFAULT_LAMELLA_SETTINGS } from '../core/lamelle';
import { replaceCells, setBms } from '../core/ops';
import { createProject } from '../core/project';
import { buildStrips } from '../core/strips';
import { DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { intersectRegions, regionArea } from '../core/clip';
import { bindHolderSettings, freeTabSides, holderCutsOf, ntcPlanOf, stripsOf, tabSideOf } from './lamelle';
import { bindHolderCuts, holderOf } from './holder';
import { tabsOf } from '../core/strips';

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
  const strips = buildStrips(p, { tabs: { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3 } });

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

describe('scanalature solo dove passano le linguette', () => {
  const p = pack(4, 3);
  bindHolderSettings(() => DEFAULT_HOLDER_SETTINGS);
  bindHolderCuts((pr, st) => holderCutsOf(pr, DEFAULT_LAMELLA_SETTINGS, st));
  const area = (m: { wall: { outline: { x: number; y: number }[]; holes: { x: number; y: number }[][] }[] }) => m.wall.reduce((a, r) => a + regionArea(r), 0);

  it('la piastra senza linguette non ha scanalature', () => {
    const strips = stripsOf(p, DEFAULT_LAMELLA_SETTINGS);
    const facesWithTabs = new Set(strips.flatMap((st) => (tabsOf(st).length > 0 ? [st.face] : [])));
    const { model } = holderOf(p, DEFAULT_HOLDER_SETTINGS);
    expect(model).not.toBeNull();
    if (facesWithTabs.size === 2) {
      // linguette su entrambe le facce: due modelli, ognuno con le sue scanalature
      expect(model!.halves).toBeDefined();
      return;
    }
    // linguette su una faccia sola: l'altra piastra resta intera (più materiale)
    const withTabs = [...facesWithTabs][0]!;
    const without = withTabs === 'top' ? 'bottom' : 'top';
    expect(model!.halves).toBeDefined();
    expect(area(model!.halves![without]!)).toBeGreaterThan(area(model!.halves![withTabs]!));
  });
});
