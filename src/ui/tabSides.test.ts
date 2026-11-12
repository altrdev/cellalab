import { describe, expect, it } from 'vitest';
import { bmsOf } from '../core/bms';
import { generateGrid } from '../core/layout';
import { DEFAULT_BUSBAR_SETTINGS } from '../core/busbar';
import { replaceCells, setBms } from '../core/ops';
import { createProject } from '../core/project';
import { buildStrips } from '../core/strips';
import { DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { intersectRegions, regionArea } from '../core/clip';
import { bindHolderSettings, freeTabSides, holderCutsOf, ntcPlanOf, stripsOf, tabSideOf } from './busbar';
import { bindHolderCuts, holderOf } from './holder';
import { tabsOf } from '../core/strips';

const pack = (s: number, p: number) =>
  setBms(replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: s, parallel: p, kind: 'hex', gapMm: 1 })), 'bms-4s-30a-li-ion');

describe('tab sides', () => {
  it('in a column pack left and right are blocked, top and bottom free', () => {
    const p = pack(4, 3);
    expect(bmsOf(p)).toBeDefined();
    expect(freeTabSides(p, DEFAULT_BUSBAR_SETTINGS)).toEqual({ top: true, bottom: true, left: false, right: false });
  });

  it('automatic picks the first free side; the side chosen by hand stays', () => {
    const p = pack(4, 3);
    expect(tabSideOf(p, DEFAULT_BUSBAR_SETTINGS)).toBe('top');
    expect(tabSideOf(p, { ...DEFAULT_BUSBAR_SETTINGS, tabSide: 'left' })).toBe('left');
  });

  it('without a BMS all the sides are free', () => {
    const p = replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 4, parallel: 3, kind: 'hex', gapMm: 1 }));
    expect(Object.values(freeTabSides(p, DEFAULT_BUSBAR_SETTINGS))).toEqual([true, true, true, true]);
  });
});

describe('NTC under the strips', () => {
  const p = pack(4, 3);
  const plan = ntcPlanOf(p, DEFAULT_BUSBAR_SETTINGS, DEFAULT_HOLDER_SETTINGS);
  const strips = buildStrips(p, { tabs: { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3 } });

  it('there is a gap for the sensor', () => {
    expect(plan.site).not.toBeNull();
  });

  it('the wire hole does not touch the strips of any face', () => {
    const regions = strips.map((s) => ({ outline: s.outline, holes: s.holes }));
    expect(regions.length).toBeGreaterThan(0);
    expect(intersectRegions(regions, [plan.site!.wirePolygon]).reduce((a, r) => a + regionArea(r), 0)).toBeLessThan(0.01);
  });

  it('stripsOf uses the same sides', () => {
    expect(stripsOf(p, DEFAULT_BUSBAR_SETTINGS).some((s) => s.tab)).toBe(true);
  });
});

describe('NTC settings in the holder', () => {
  it('they are read from the file with valid values and go back to the default if missing or wrong', async () => {
    const { sanitizeHolderSettings } = await import('./holder');
    expect(sanitizeHolderSettings({ ntc: false, ntcMm: 6 })).toMatchObject({ ntc: false, ntcMm: 6 });
    expect(sanitizeHolderSettings({})).toMatchObject({ ntc: true, ntcMm: 5 });
    expect(sanitizeHolderSettings({ ntc: 'sì', ntcMm: 99 })).toMatchObject({ ntc: true, ntcMm: 12 });
  });
});

describe('grooves only where the tabs pass', () => {
  const p = pack(4, 3);
  bindHolderSettings(() => DEFAULT_HOLDER_SETTINGS);
  bindHolderCuts((pr, st) => holderCutsOf(pr, DEFAULT_BUSBAR_SETTINGS, st));
  const area = (m: { wall: { outline: { x: number; y: number }[]; holes: { x: number; y: number }[][] }[] }) => m.wall.reduce((a, r) => a + regionArea(r), 0);

  it('the plate without tabs has no grooves', () => {
    const strips = stripsOf(p, DEFAULT_BUSBAR_SETTINGS);
    const facesWithTabs = new Set(strips.flatMap((st) => (tabsOf(st).length > 0 ? [st.face] : [])));
    const { model } = holderOf(p, DEFAULT_HOLDER_SETTINGS);
    expect(model).not.toBeNull();
    if (facesWithTabs.size === 2) {
      // tabs on both faces: two models, each with its own grooves
      expect(model!.halves).toBeDefined();
      return;
    }
    // tabs on one face only: the other plate stays whole (more material)
    const withTabs = [...facesWithTabs][0]!;
    const without = withTabs === 'top' ? 'bottom' : 'top';
    expect(model!.halves).toBeDefined();
    expect(area(model!.halves![without]!)).toBeGreaterThan(area(model!.halves![withTabs]!));
  });
});
