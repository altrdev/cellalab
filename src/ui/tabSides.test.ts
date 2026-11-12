import { describe, expect, it } from 'vitest';
import { bmsOf } from '../core/bms';
import { generateGrid } from '../core/layout';
import { DEFAULT_LAMELLA_SETTINGS } from '../core/lamelle';
import { replaceCells, setBms } from '../core/ops';
import { createProject } from '../core/project';
import { buildStrips } from '../core/strips';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { circlePolygon, intersectRegions, pointInRegions, regionArea } from '../core/clip';
import { findCellType } from '../core/catalog';
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

  it('c’è una piastra con la strada libera e il solco è un percorso vero', () => {
    expect(plan.face).not.toBeNull();
    expect(plan.route?.found).toBe(true);
    expect(plan.site).not.toBeNull();
  });

  it('il foro del filo e il solco non toccano le lamelle della piastra scelta', () => {
    const face = plan.face!;
    const regions = strips.filter((s) => s.face === face).map((s) => ({ outline: s.outline, holes: s.holes }));
    expect(regions.length).toBeGreaterThan(0);
    const overlap = (poly: { x: number; y: number }[]) => intersectRegions(regions, [poly]).reduce((a, r) => a + regionArea(r), 0);
    expect(overlap(plan.site!.wirePolygon)).toBeLessThan(0.01);
    for (const g of plan.route!.polygons) expect(overlap(g)).toBeLessThan(0.01);
  });

  it('il solco lascia un po’ di fondo attorno alle aperture delle celle', () => {
    const ledge = DEFAULT_HOLDER_SETTINGS.ledgeMm;
    for (const c of p.cells) {
      const r = findCellType(p, c.typeId)!.diameterMm / 2 - ledge;
      const ring = circlePolygon(c.x, c.y, r + 0.4);
      for (const g of plan.route!.polygons) {
        // i punti del solco (a parte la parte finale oltre il bordo) stanno fuori dall'apertura allargata
        for (const q of g) expect(pointInRegions(q, [{ outline: ring, holes: [] }])).toBe(false);
      }
    }
  });

  it('la tasca e il solco sono solo sulla piastra scelta', () => {
    const half = plan.face!;
    const other = half === 'top' ? 'bottom' : 'top';
    const cut = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true, { extraPockets: [plan.site!.polygon], throughHoles: [plan.site!.wirePolygon], grooves: plan.route!.polygons, cutsHalf: half })!;
    const vol = (ls: typeof cut.layers) => ls.reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true)!;
    expect(vol(cut.halfLayers![half]!)).toBeLessThan(vol(plain.layers));
    expect(cut.halfLayers![other]).toBeUndefined();
    expect(vol(cut.layers)).toBeCloseTo(vol(plain.layers), 6);
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
