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
    const r = analyzeLamelle(project, strips, cfg({ currentA: 5 }), 30);
    expect(r.currentA).toBe(5);
    expect(r.thicknessMm).toBe(0.1);
    expect(r.status).toBe('ok');
    expect(r.strips).toHaveLength(strips.length);
    expect(r.massG).toBeGreaterThan(0);
  });

  it('usa la corrente max del pacco quando non è impostata', () => {
    const { project, strips } = setup(4, 3);
    expect(analyzeLamelle(project, strips, cfg({ currentA: null }), 30).currentA).toBe(30);
  });

  it('corrente alta con nichel e saldatrice hobby: errore, con alternative', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg({ currentA: 60 }), 30);
    expect(r.status).toBe('error');
    expect(r.issues.some((i) => /spessore/i.test(i.message))).toBe(true);
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives.some((a) => /due livelli/i.test(a))).toBe(true);
  });

  it('più strati: se due strati bastano, lo spessore è scelto tra i commerciali', () => {
    const { project, strips } = setup(4, 3);
    const material = findMaterial('nichel-puro')!;
    const need = worstRequiredMm(strips, material, cfg(), 20);
    const r = analyzeLamelle(project, strips, cfg({ currentA: 20, layers: 2 }), 30);
    expect(r.totalThicknessMm).toBe(r.thicknessMm! * 2);
    expect(r.totalThicknessMm!).toBeGreaterThanOrEqual(need - 1e-9);
  });

  it('spessore imposto troppo sottile: errore con il ΔT previsto', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg({ currentA: 30, thicknessMm: 0.1 }), 30);
    expect(r.auto).toBe(false);
    expect(r.status).toBe('error');
    const worst = Math.max(...r.strips.map((s) => s.deltaTK ?? 0));
    expect(worst).toBeGreaterThan(25);
  });

  it('oltre lo spessore massimo della saldatrice: avviso', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg({ currentA: 5, thicknessMm: 0.3 }), 30);
    expect(r.issues.some((i) => i.severity === 'warning' && /saldatrice/.test(i.message))).toBe(true);
  });

  it('rame nudo: avviso sulla saldabilità', () => {
    const { project, strips } = setup(4, 3);
    const r = analyzeLamelle(project, strips, cfg({ currentA: 5, materialId: 'rame' }), 30);
    expect(r.issues.some((i) => i.severity === 'warning' && /male/.test(i.message))).toBe(true);
  });

  it('punti di saldatura: tanta corrente per cella sul bottone piccolo → errore di capacità', () => {
    const { project, strips } = setup(4, 1); // P=1: tutta la corrente su una sola cella
    const r = analyzeLamelle(project, strips, cfg({ currentA: 60 }), 60);
    expect(r.issues.some((i) => i.severity === 'error' && /punti/.test(i.message))).toBe(true);
    const plus = r.strips.find((s) => s.spotsNeeded > s.spotCapacity)!;
    expect(plus.cellCurrentA).toBe(60);
  });

  it('più celle in parallelo → meno corrente per cella e meno punti necessari', () => {
    const a = setup(4, 1);
    const b = setup(4, 4);
    const ra = analyzeLamelle(a.project, a.strips, cfg({ currentA: 20 }), 20);
    const rb = analyzeLamelle(b.project, b.strips, cfg({ currentA: 20 }), 20);
    expect(Math.max(...rb.strips.map((s) => s.cellCurrentA))).toBeLessThan(Math.max(...ra.strips.map((s) => s.cellCurrentA)));
  });

  it('lamelle che si toccano (colonne molto vicine): errore di cortocircuito', () => {
    const { project, strips } = squeezed(4, 3, 0.55);
    const r = analyzeLamelle(project, strips, cfg({ currentA: 5 }), 30);
    expect(r.issues.some((i) => i.severity === 'error' && /cortocircuito/.test(i.message))).toBe(true);
  });

  it('taglio a fresa (minimo 2 mm): avviso se le lamelle distano meno, senza toccarsi', () => {
    const { project, strips } = squeezed(4, 3, 0.7);
    const cnc = analyzeLamelle(project, strips, cfg({ currentA: 5, cutterId: 'cnc' }), 30);
    expect(cnc.issues.some((i) => i.severity === 'warning' && /distano/.test(i.message))).toBe(true);
    expect(cnc.issues.some((i) => /cortocircuito/.test(i.message))).toBe(false);
    const manual = analyzeLamelle(project, strips, cfg({ currentA: 5, cutterId: 'manual' }), 30);
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
