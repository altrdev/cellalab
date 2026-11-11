import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { addCell, applyLayout, clearPack, removeCells, replaceCells, setCellType, setGenerator } from './ops';
import { createProject } from './project';
import { computeStats } from './stats';

const base = { typeId: '21700-5000-10a', diameterMm: 21.4 };

describe('generateGrid', () => {
  it('quadrato 3S2P: passo = diametro + gap, un gruppo per colonna', () => {
    const cells = generateGrid({ ...base, series: 3, parallel: 2, kind: 'square', gapMm: 1 });
    expect(cells).toHaveLength(6);
    // passo 22,4 mm, origine in (0, 0)
    expect(cells[0]).toMatchObject({ x: 0, y: 0, group: 0 });
    expect(cells[1]).toMatchObject({ x: 0, y: 22.4, group: 0 });
    expect(cells[2]).toMatchObject({ x: 22.4, y: 0, group: 1 });
  });

  it('la polarità alterna da un gruppo all altro', () => {
    const cells = generateGrid({ ...base, series: 4, parallel: 1, kind: 'square', gapMm: 0 });
    expect(cells.map((c) => c.plusUp)).toEqual([true, false, true, false]);
  });

  it('esagonale: ogni cella ha vicini alla stessa distanza (= passo)', () => {
    const gap = 1;
    const pitch = base.diameterMm + gap;
    const cells = generateGrid({ ...base, series: 4, parallel: 4, kind: 'hex', gapMm: gap });
    const dist = (a: number, b: number) =>
      Math.hypot(cells[a]!.x - cells[b]!.x, cells[a]!.y - cells[b]!.y);
    // cella (g=0,k=1) con (g=1,k=0) e (g=1,k=1): colonna successiva sfalsata di mezzo passo
    expect(dist(1, 4)).toBeCloseTo(pitch, 2);
    expect(dist(1, 5)).toBeCloseTo(pitch, 2);
    // nessuna coppia più vicina del passo (niente sovrapposizioni)
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(dist(i, j)).toBeGreaterThanOrEqual(pitch - 0.01);
      }
    }
  });

  it('il pacco generato ha la configurazione richiesta nei calcoli', () => {
    const cells = generateGrid({ ...base, series: 13, parallel: 4, kind: 'hex', gapMm: 0.5 });
    const st = computeStats(replaceCells(createProject(), cells));
    expect(st.configLabel).toBe('13S4P');
    expect(st.ungroupedCount).toBe(0);
    expect(st.groupGaps).toBe(false);
  });

  it.each([
    ['S zero', { series: 0, parallel: 1 }],
    ['P non intero', { series: 2, parallel: 1.5 }],
    ['troppe celle', { series: 100, parallel: 100 }],
  ])('rifiuta: %s', (_n, extra) => {
    expect(() => generateGrid({ ...base, kind: 'square', gapMm: 1, ...extra })).toThrow(RangeError);
  });

  it('rifiuta gap negativo o diametro nullo', () => {
    expect(() => generateGrid({ ...base, series: 1, parallel: 1, kind: 'square', gapMm: -1 })).toThrow(RangeError);
    expect(() => generateGrid({ ...base, diameterMm: 0, series: 1, parallel: 1, kind: 'square', gapMm: 1 })).toThrow(RangeError);
  });
});

describe('replaceCells', () => {
  it('sostituisce le celle esistenti con id nuovi e unici', () => {
    let p = addCell(createProject(), { typeId: base.typeId, x: 0, y: 0, id: 'vecchia' });
    p = replaceCells(p, generateGrid({ ...base, series: 2, parallel: 2, kind: 'square', gapMm: 1 }));
    expect(p.cells).toHaveLength(4);
    expect(new Set(p.cells.map((c) => c.id)).size).toBe(4);
    expect(p.cells.some((c) => c.id === 'vecchia')).toBe(false);
  });
});

describe('applyLayout', () => {
  const recipe = (series: number, parallel: number, kind: 'hex' | 'square', gapMm: number) => ({
    series,
    parallel,
    kind,
    gapMm,
    pitchMm: base.diameterMm + gapMm,
    typeId: base.typeId,
  });
  const generated = (series: number, parallel: number, kind: 'hex' | 'square', gapMm: number) =>
    setGenerator(
      replaceCells(createProject(), generateGrid({ ...base, series, parallel, kind, gapMm })),
      recipe(series, parallel, kind, gapMm),
    );

  it('cambiando cella cambia il tipo di tutte le celle e il passo, come una nuova generazione', () => {
    const p = generated(3, 2, 'hex', 1.5);
    const big = { typeId: '32700-lfp-6000', diameterMm: 32.2 };
    const r = applyLayout(p, { kind: 'hex', gapMm: 1.5, pitchMm: big.diameterMm + 1.5, typeId: big.typeId })!;
    const fresh = generateGrid({ ...big, series: 3, parallel: 2, kind: 'hex', gapMm: 1.5 });
    expect(r.cells.every((c) => c.typeId === big.typeId)).toBe(true);
    expect(r.generator!.typeId).toBe(big.typeId);
    r.cells.forEach((c, i) => {
      expect(c.x).toBeCloseTo(fresh[i]!.x, 3);
      expect(c.y).toBeCloseTo(fresh[i]!.y, 3);
    });
  });

  it('cambiare lo spazio dà le stesse posizioni di una nuova generazione', () => {
    const p = generated(4, 3, 'hex', 1);
    const r = applyLayout(p, { kind: 'hex', gapMm: 2.5, pitchMm: base.diameterMm + 2.5 })!;
    const fresh = generateGrid({ ...base, series: 4, parallel: 3, kind: 'hex', gapMm: 2.5 });
    r.cells.forEach((c, i) => {
      expect(c.x).toBeCloseTo(fresh[i]!.x, 3);
      expect(c.y).toBeCloseTo(fresh[i]!.y, 3);
    });
    expect(r.generator).toMatchObject({ gapMm: 2.5, kind: 'hex' });
  });

  it('esagonale → quadrata come rigenerare', () => {
    const p = generated(3, 2, 'hex', 1);
    const r = applyLayout(p, { kind: 'square', gapMm: 1, pitchMm: base.diameterMm + 1 })!;
    const fresh = generateGrid({ ...base, series: 3, parallel: 2, kind: 'square', gapMm: 1 });
    r.cells.forEach((c, i) => {
      expect(c.x).toBeCloseTo(fresh[i]!.x, 3);
      expect(c.y).toBeCloseTo(fresh[i]!.y, 3);
    });
  });

  it('mantiene id, gruppi, polarità e le celle tolte a mano', () => {
    let p = generated(3, 2, 'hex', 1);
    p = { ...p, cells: p.cells.map((c, i) => (i === 0 ? { ...c, plusUp: !c.plusUp } : c)) };
    const removed = p.cells[5]!.id;
    p = removeCells(p, [removed]);
    const r = applyLayout(p, { kind: 'hex', gapMm: 3, pitchMm: base.diameterMm + 3 })!;
    expect(r.cells).toHaveLength(5);
    expect(r.cells.map((c) => c.id)).toEqual(p.cells.map((c) => c.id));
    expect(r.cells.map((c) => [c.group, c.plusUp])).toEqual(p.cells.map((c) => [c.group, c.plusUp]));
  });

  it('null se una cella è fuori dal reticolo o non c\'è la ricetta', () => {
    const p = generated(3, 2, 'hex', 1);
    const moved = { ...p, cells: p.cells.map((c, i) => (i === 0 ? { ...c, x: c.x + 3.3 } : c)) };
    expect(applyLayout(moved, { kind: 'hex', gapMm: 2, pitchMm: 23.4 })).toBeNull();
    expect(applyLayout(clearPack(p), { kind: 'hex', gapMm: 2, pitchMm: 23.4 })).toBeNull();
  });

  it('togliere tutte le celle dimentica la ricetta', () => {
    const p = generated(2, 1, 'square', 1);
    expect(removeCells(p, p.cells.map((c) => c.id)).generator).toBeUndefined();
    expect(clearPack(p).generator).toBeUndefined();
  });
});

describe('setCellType', () => {
  const p = replaceCells(createProject(), generateGrid({ ...base, series: 2, parallel: 2, kind: 'square', gapMm: 1 }));

  it('cambia il tipo di tutte le celle o solo di quelle indicate', () => {
    expect(setCellType(p, '18650-3000-10a').cells.every((c) => c.typeId === '18650-3000-10a')).toBe(true);
    const some = setCellType(p, '18650-3000-10a', [p.cells[0]!.id]);
    expect(some.cells[0]!.typeId).toBe('18650-3000-10a');
    expect(some.cells[1]!.typeId).toBe(base.typeId);
    expect(some.cells[0]!.x).toBe(p.cells[0]!.x);
    expect(some.cells[0]!.group).toBe(p.cells[0]!.group);
  });

  it('senza cambiamenti restituisce lo stesso progetto', () => {
    expect(setCellType(p, base.typeId)).toBe(p);
  });
});
