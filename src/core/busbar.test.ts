import { describe, expect, it } from 'vitest';
import { analyzeBusbars, DEFAULT_BUSBAR_SETTINGS, worstRequiredMm, type BusbarSettings } from './busbar';
import { generateGrid } from './layout';
import { findMaterial } from './materials';
import { replaceCells } from './ops';
import { createProject } from './project';
import { buildStrips } from './strips';

function setup(series: number, parallel: number, kind: 'hex' | 'square' = 'hex', gap = 1) {
  const cells = generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series, parallel, kind, gapMm: gap });
  const project = replaceCells(createProject(), cells);
  return { project, strips: buildStrips(project) };
}
/** Brings the columns closer by scaling x: used to test strips that are too close or overlapping. */
function squeezed(series: number, parallel: number, fx: number, widthMm = 14) {
  const base = setup(series, parallel, 'square', 0).project;
  const project = { ...base, cells: base.cells.map((c) => ({ ...c, x: c.x * fx })) };
  return { project, strips: buildStrips(project, { widthMm }) };
}
const cfg = (over: Partial<BusbarSettings> = {}): BusbarSettings => ({ ...DEFAULT_BUSBAR_SETTINGS, ...over });

describe('analyzeBusbars', () => {
  it('without strips: "empty" state with a hint', () => {
    const r = analyzeBusbars(createProject(), [], cfg(), 20);
    expect(r.status).toBe('empty');
    expect(r.issues[0]!.severity).toBe('info');
  });

  it('low current: the thinnest nickel thickness is enough and the pack is ok', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeBusbars(project, strips, cfg(), 5);
    expect(r.currentA).toBe(5);
    expect(r.thicknessMm).toBe(0.1);
    expect(r.status).toBe('ok');
    expect(r.strips).toHaveLength(strips.length);
    expect(r.massG).toBeGreaterThan(0);
  });

  it('the design current is the pack current', () => {
    const { project, strips } = setup(4, 3);
    expect(analyzeBusbars(project, strips, cfg(), 30).currentA).toBe(30);
  });

  it('high current with nickel and a hobby welder: error, with alternatives', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeBusbars(project, strips, cfg(), 150);
    expect(r.status).toBe('error');
    expect(r.issues.some((i) => /spessore/i.test(i.message))).toBe(true);
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives.some((a) => /due livelli/i.test(a))).toBe(true);
  });

  it('3S2P of 18650 at 3 Ah (20 A, 10 A per band): the defaults are enough, with a thin nickel', () => {
    const cells = generateGrid({ typeId: '18650-3000-10a', diameterMm: 18.4, series: 3, parallel: 2, kind: 'hex', gapMm: 1.5 });
    const project = replaceCells(createProject(), cells);
    const strips = buildStrips(project);
    const r = analyzeBusbars(project, strips, cfg(), 20);
    expect(r.status).toBe('ok');
    expect(r.thicknessMm).toBeLessThanOrEqual(0.15);
    // the bands are short (distance between cells minus the contact areas), not infinite
    for (const s of strips) expect(s.bandLengthMm).toBeGreaterThan(5);
    for (const s of strips) expect(s.bandLengthMm).toBeLessThan(20);
  });

  it('hotter cells: thicker strips are needed', () => {
    const { project, strips } = setup(4, 3);
    const cold = worstRequiredMm(strips, findMaterial('nichel-puro')!, cfg({ cellRiseK: 0 }), 60);
    const hot = worstRequiredMm(strips, findMaterial('nichel-puro')!, cfg({ cellRiseK: 20 }), 60);
    expect(hot).toBeGreaterThan(cold);
    expect(project.cells.length).toBe(12);
  });

  it('more layers: if two layers are enough, the thickness is chosen among the commercial ones', () => {
    const { project, strips } = setup(4, 3);
    const material = findMaterial('nichel-puro')!;
    const need = worstRequiredMm(strips, material, cfg(), 20);
    const r = analyzeBusbars(project, strips, cfg({ layers: 2 }), 20);
    expect(r.totalThicknessMm).toBe(r.thicknessMm! * 2);
    expect(r.totalThicknessMm!).toBeGreaterThanOrEqual(need - 1e-9);
  });

  it('imposed thickness too thin: error with the expected ΔT', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeBusbars(project, strips, cfg({ thicknessMm: 0.1 }), 90);
    expect(r.auto).toBe(false);
    expect(r.status).toBe('error');
    const worst = Math.max(...r.strips.map((s) => s.deltaTK ?? 0));
    expect(worst).toBeGreaterThan(25);
  });

  describe('weld spots', () => {
    // 4S3P of 21700: 6 spots fit on the button (2 mm, 3 mm pitch); with 3 cells in parallel the current per cell is I/3
    const spots = (over: Partial<BusbarSettings>, packA: number) => {
      const { project, strips } = setup(4, 3);
      const r = analyzeBusbars(project, strips, cfg(over), packA);
      return { r, s: r.strips[0]! };
    };

    it('automatic: the spots follow the current, in pairs', () => {
      expect(spots({}, 15).s.spotsNeeded).toBe(2); // 5 A per cell → 1 spot → minimum 2
      expect(spots({}, 30).s.spotsNeeded).toBe(2); // 10 A per cell → 2 spots
      expect(spots({}, 36).s.spotsNeeded).toBe(4); // 12 A → 3 punti → a coppie: 4
      expect(spots({}, 60).s.spotsNeeded).toBe(4); // 20 A → 4 punti
      expect(spots({}, 60).s.spotsForCurrent).toBe(4);
    });

    it('chosen number: it is used and shows the current they carry', () => {
      const { s, r } = spots({ spotsPerTerminal: 4 }, 30);
      expect(s.spotsNeeded).toBe(4);
      expect(s.spotsCarryA).toBe(20);
      expect(r.issues.some((i) => /punti/.test(i.message))).toBe(false);
    });

    it('chosen number too low for the current: error', () => {
      const { r } = spots({ spotsPerTerminal: 2 }, 60); // 20 A per cell, 2 spots = 10 A
      expect(r.status).toBe('error');
      expect(r.issues.some((i) => /reggono circa 10 A/.test(i.message))).toBe(true);
    });

    it("the message says why 4 spots do not fit: weld area Ø 6 = radius 3", () => {
      const { project } = setup(4, 3);
      const strips = buildStrips(project, { contactDiameterMm: 6 });
      const r = analyzeBusbars(project, strips, cfg({ spotsPerTerminal: 4, contactDiameterMm: 6 }), 30);
      const msg = r.issues.find((i) => /hai scelto 4 punti/.test(i.message))!.message;
      expect(msg).toMatch(/raggio 3,0 mm/);
      expect(msg).toMatch(/almeno 3,2/);
      expect(msg).toMatch(/\(Ø 6,4 mm\)/);
    });

    it('the rim takes no room from the spots: with Ø 7, 4 spots fit whatever the rim', () => {
      const { project } = setup(4, 3);
      const check = (contactDiameterMm: number, marginMm: number) => {
        const strips = buildStrips(project, { contactDiameterMm, marginMm });
        return analyzeBusbars(project, strips, cfg({ spotsPerTerminal: 4, contactDiameterMm }), 30).strips[0]!.spotCapacity;
      };
      expect(check(7, 1)).toBeGreaterThanOrEqual(4);
      expect(check(7, 4)).toBe(check(7, 1));
      expect(check(4, 1)).toBeLessThan(4); // Ø 4 area: only 1 spot
    });

    it('chosen number that does not fit on the contact: error', () => {
      const { r } = spots({ spotsPerTerminal: 12 }, 30);
      expect(r.issues.some((i) => /hai scelto 12 punti/.test(i.message))).toBe(true);
    });

    it('editable current per spot and distance: the spots and the report\'s welder change', () => {
      const a = spots({ spotCurrentA: 10 }, 60); // 20 A per cell at 10 A per spot → 2 spots
      expect(a.s.spotsNeeded).toBe(2);
      expect(a.r.welder.spotCurrentA).toBe(10);
      const b = spots({ spotSpacingMm: 5 }, 30);
      expect(b.r.welder.spotSpacingMm).toBe(5);
      expect(b.s.spotCapacity).toBeLessThan(spots({}, 30).s.spotCapacity);
    });
  });

  it('above the welder\'s maximum thickness: warning', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeBusbars(project, strips, cfg({ thicknessMm: 0.3 }), 5);
    expect(r.issues.some((i) => i.severity === 'warning' && /saldatrice/.test(i.message))).toBe(true);
  });

  it('bare copper: weldability warning', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeBusbars(project, strips, cfg({ materialId: 'rame' }), 5);
    expect(r.issues.some((i) => i.severity === 'warning' && /male/.test(i.message))).toBe(true);
  });

  it('weld spots: a lot of current per cell on the small button → capacity error', () => {
    const { project, strips } = setup(4, 1); // P=1: all the current on a single cell
    const r = analyzeBusbars(project, strips, cfg(), 60);
    expect(r.issues.some((i) => i.severity === 'error' && /punti/.test(i.message))).toBe(true);
    const plus = r.strips.find((s) => s.spotsNeeded > s.spotCapacity)!;
    expect(plus.cellCurrentA).toBe(60);
  });

  it('more cells in parallel → less current per cell and fewer spots needed', () => {
    const a = setup(4, 1);
    const b = setup(4, 4);
    const ra = analyzeBusbars(a.project, a.strips, cfg(), 20);
    const rb = analyzeBusbars(b.project, b.strips, cfg(), 20);
    expect(Math.max(...rb.strips.map((s) => s.cellCurrentA))).toBeLessThan(Math.max(...ra.strips.map((s) => s.cellCurrentA)));
  });

  it('strips that touch (very close columns): short-circuit error', () => {
    const { project, strips } = squeezed(4, 3, 0.55);
    const r = analyzeBusbars(project, strips, cfg(), 5);
    expect(r.issues.some((i) => i.severity === 'error' && /cortocircuito/.test(i.message))).toBe(true);
  });

  it('milling cut (minimum 2 mm): warning if the strips are closer than that, without touching', () => {
    const { project, strips } = squeezed(4, 3, 0.7);
    const cnc = analyzeBusbars(project, strips, cfg({ cutterId: 'cnc' }), 5);
    expect(cnc.issues.some((i) => i.severity === 'warning' && /distano/.test(i.message))).toBe(true);
    expect(cnc.issues.some((i) => /cortocircuito/.test(i.message))).toBe(false);
    const manual = analyzeBusbars(project, strips, cfg({ cutterId: 'manual' }), 5);
    expect(manual.issues.some((i) => /distano/.test(i.message))).toBe(true); // 0.98 mm < 1 mm even by hand
  });

  it('better cooling → smaller required thickness', () => {
    const { strips } = setup(4, 3);
    const m = findMaterial('nichel-puro')!;
    expect(worstRequiredMm(strips, m, cfg({ cooling: 'ventilated' }), 30)).toBeLessThan(
      worstRequiredMm(strips, m, cfg({ cooling: 'free' }), 30),
    );
    expect(worstRequiredMm(strips, m, cfg({ cooling: 'enclosed' }), 30)).toBeGreaterThan(
      worstRequiredMm(strips, m, cfg({ cooling: 'free' }), 30),
    );
  });

  it('copper needs less thickness than nickel at the same current', () => {
    const { strips } = setup(4, 3);
    expect(worstRequiredMm(strips, findMaterial('rame')!, cfg(), 30)).toBeLessThan(
      worstRequiredMm(strips, findMaterial('nichel-puro')!, cfg(), 30),
    );
  });
});
