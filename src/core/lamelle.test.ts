import { describe, expect, it } from 'vitest';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS, worstRequiredMm, type LamellaSettings } from './lamelle';
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
/** Avvicina le colonne scalando le x: serve a provare lamelle troppo vicine o sovrapposte. */
function squeezed(series: number, parallel: number, fx: number, widthMm = 14) {
  const base = setup(series, parallel, 'square', 0).project;
  const project = { ...base, cells: base.cells.map((c) => ({ ...c, x: c.x * fx })) };
  return { project, strips: buildStrips(project, { widthMm }) };
}
const cfg = (over: Partial<LamellaSettings> = {}): LamellaSettings => ({ ...DEFAULT_LAMELLA_SETTINGS, ...over });

describe('analyzeLamelle', () => {
  it('senza lamelle: stato "empty" con un suggerimento', () => {
    const r = analyzeLamelle(createProject(), [], cfg(), 20);
    expect(r.status).toBe('empty');
    expect(r.issues[0]!.severity).toBe('info');
  });

  it('corrente bassa: il più sottile spessore di nichel basta e il pacco è ok', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg(), 5);
    expect(r.currentA).toBe(5);
    expect(r.thicknessMm).toBe(0.1);
    expect(r.status).toBe('ok');
    expect(r.strips).toHaveLength(strips.length);
    expect(r.massG).toBeGreaterThan(0);
  });

  it('la corrente di progetto è quella del pacco', () => {
    const { project, strips } = setup(4, 3);
    expect(analyzeLamelle(project, strips, cfg(), 30).currentA).toBe(30);
  });

  it('corrente alta con nichel e saldatrice hobby: errore, con alternative', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg(), 150);
    expect(r.status).toBe('error');
    expect(r.issues.some((i) => /spessore/i.test(i.message))).toBe(true);
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives.some((a) => /due livelli/i.test(a))).toBe(true);
  });

  it('3S2P di 18650 da 3 Ah (20 A, 10 A per banda): i default bastano, con un nichel sottile', () => {
    const cells = generateGrid({ typeId: '18650-3000-10a', diameterMm: 18.4, series: 3, parallel: 2, kind: 'hex', gapMm: 1.5 });
    const project = replaceCells(createProject(), cells);
    const strips = buildStrips(project);
    const r = analyzeLamelle(project, strips, cfg(), 20);
    expect(r.status).toBe('ok');
    expect(r.thicknessMm).toBeLessThanOrEqual(0.15);
    // le bande sono corte (distanza tra le celle meno gli appoggi), non infinite
    for (const s of strips) expect(s.bandLengthMm).toBeGreaterThan(5);
    for (const s of strips) expect(s.bandLengthMm).toBeLessThan(20);
  });

  it('celle più calde: servono lamelle più spesse', () => {
    const { project, strips } = setup(4, 3);
    const cold = worstRequiredMm(strips, findMaterial('nichel-puro')!, cfg({ cellRiseK: 0 }), 60);
    const hot = worstRequiredMm(strips, findMaterial('nichel-puro')!, cfg({ cellRiseK: 20 }), 60);
    expect(hot).toBeGreaterThan(cold);
    expect(project.cells.length).toBe(12);
  });

  it('più strati: se due strati bastano, lo spessore è scelto tra i commerciali', () => {
    const { project, strips } = setup(4, 3);
    const material = findMaterial('nichel-puro')!;
    const need = worstRequiredMm(strips, material, cfg(), 20);
    const r = analyzeLamelle(project, strips, cfg({ layers: 2 }), 20);
    expect(r.totalThicknessMm).toBe(r.thicknessMm! * 2);
    expect(r.totalThicknessMm!).toBeGreaterThanOrEqual(need - 1e-9);
  });

  it('spessore imposto troppo sottile: errore con il ΔT previsto', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg({ thicknessMm: 0.1 }), 90);
    expect(r.auto).toBe(false);
    expect(r.status).toBe('error');
    const worst = Math.max(...r.strips.map((s) => s.deltaTK ?? 0));
    expect(worst).toBeGreaterThan(25);
  });

  describe('punti di saldatura', () => {
    // 4S3P di 21700: sul bottone entrano 6 punti (2 mm, passo 3 mm); con 3 celle in parallelo la corrente per cella è I/3
    const spots = (over: Partial<LamellaSettings>, packA: number) => {
      const { project, strips } = setup(4, 3);
      const r = analyzeLamelle(project, strips, cfg(over), packA);
      return { r, s: r.strips[0]! };
    };

    it('automatico: i punti seguono la corrente, a coppie', () => {
      expect(spots({}, 15).s.spotsNeeded).toBe(2); // 5 A per cella → 1 punto → minimo 2
      expect(spots({}, 30).s.spotsNeeded).toBe(2); // 10 A per cella → 2 punti
      expect(spots({}, 36).s.spotsNeeded).toBe(4); // 12 A → 3 punti → a coppie: 4
      expect(spots({}, 60).s.spotsNeeded).toBe(4); // 20 A → 4 punti
      expect(spots({}, 60).s.spotsForCurrent).toBe(4);
    });

    it('numero scelto: viene usato e mostra la corrente che reggono', () => {
      const { s, r } = spots({ spotsPerTerminal: 4 }, 30);
      expect(s.spotsNeeded).toBe(4);
      expect(s.spotsCarryA).toBe(20);
      expect(r.issues.some((i) => /punti/.test(i.message))).toBe(false);
    });

    it('numero scelto troppo basso per la corrente: errore', () => {
      const { r } = spots({ spotsPerTerminal: 2 }, 60); // 20 A per cella, 2 punti = 10 A
      expect(r.status).toBe('error');
      expect(r.issues.some((i) => /reggono circa 10 A/.test(i.message))).toBe(true);
    });

    it('numero scelto che non entra sul contatto: errore', () => {
      const { r } = spots({ spotsPerTerminal: 12 }, 30);
      expect(r.issues.some((i) => /hai scelto 12 punti/.test(i.message))).toBe(true);
    });

    it('corrente per punto e distanza modificabili: cambiano i punti e la saldatrice del rapporto', () => {
      const a = spots({ spotCurrentA: 10 }, 60); // 20 A per cella a 10 A a punto → 2 punti
      expect(a.s.spotsNeeded).toBe(2);
      expect(a.r.welder.spotCurrentA).toBe(10);
      const b = spots({ spotSpacingMm: 5 }, 30);
      expect(b.r.welder.spotSpacingMm).toBe(5);
      expect(b.s.spotCapacity).toBeLessThan(spots({}, 30).s.spotCapacity);
    });
  });

  it('oltre lo spessore massimo della saldatrice: avviso', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg({ thicknessMm: 0.3 }), 5);
    expect(r.issues.some((i) => i.severity === 'warning' && /saldatrice/.test(i.message))).toBe(true);
  });

  it('rame nudo: avviso sulla saldabilità', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg({ materialId: 'rame' }), 5);
    expect(r.issues.some((i) => i.severity === 'warning' && /male/.test(i.message))).toBe(true);
  });

  it('punti di saldatura: tanta corrente per cella sul bottone piccolo → errore di capacità', () => {
    const { project, strips } = setup(4, 1); // P=1: tutta la corrente su una sola cella
    const r = analyzeLamelle(project, strips, cfg(), 60);
    expect(r.issues.some((i) => i.severity === 'error' && /punti/.test(i.message))).toBe(true);
    const plus = r.strips.find((s) => s.spotsNeeded > s.spotCapacity)!;
    expect(plus.cellCurrentA).toBe(60);
  });

  it('più celle in parallelo → meno corrente per cella e meno punti necessari', () => {
    const a = setup(4, 1);
    const b = setup(4, 4);
    const ra = analyzeLamelle(a.project, a.strips, cfg(), 20);
    const rb = analyzeLamelle(b.project, b.strips, cfg(), 20);
    expect(Math.max(...rb.strips.map((s) => s.cellCurrentA))).toBeLessThan(Math.max(...ra.strips.map((s) => s.cellCurrentA)));
  });

  it('lamelle che si toccano (colonne molto vicine): errore di cortocircuito', () => {
    const { project, strips } = squeezed(4, 3, 0.55);
    const r = analyzeLamelle(project, strips, cfg(), 5);
    expect(r.issues.some((i) => i.severity === 'error' && /cortocircuito/.test(i.message))).toBe(true);
  });

  it('taglio a fresa (minimo 2 mm): avviso se le lamelle distano meno, senza toccarsi', () => {
    const { project, strips } = squeezed(4, 3, 0.7);
    const cnc = analyzeLamelle(project, strips, cfg({ cutterId: 'cnc' }), 5);
    expect(cnc.issues.some((i) => i.severity === 'warning' && /distano/.test(i.message))).toBe(true);
    expect(cnc.issues.some((i) => /cortocircuito/.test(i.message))).toBe(false);
    const manual = analyzeLamelle(project, strips, cfg({ cutterId: 'manual' }), 5);
    expect(manual.issues.some((i) => /distano/.test(i.message))).toBe(true); // 0,98 mm < 1 mm anche a mano
  });

  it('raffreddamento migliore → spessore richiesto minore', () => {
    const { strips } = setup(4, 3);
    const m = findMaterial('nichel-puro')!;
    expect(worstRequiredMm(strips, m, cfg({ cooling: 'ventilated' }), 30)).toBeLessThan(
      worstRequiredMm(strips, m, cfg({ cooling: 'free' }), 30),
    );
    expect(worstRequiredMm(strips, m, cfg({ cooling: 'enclosed' }), 30)).toBeGreaterThan(
      worstRequiredMm(strips, m, cfg({ cooling: 'free' }), 30),
    );
  });

  it('il rame richiede meno spessore del nichel a pari corrente', () => {
    const { strips } = setup(4, 3);
    expect(worstRequiredMm(strips, findMaterial('rame')!, cfg(), 30)).toBeLessThan(
      worstRequiredMm(strips, findMaterial('nichel-puro')!, cfg(), 30),
    );
  });
});
