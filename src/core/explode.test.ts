import { describe, expect, it } from 'vitest';
import { explodeOffsets } from './explode';
import { generateGrid } from './layout';
import { addCell, replaceCells } from './ops';
import { createProject } from './project';

const T = '21700-5000-10a';
const pack = () =>
  replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: 4, parallel: 3, kind: 'square', gapMm: 1 }));

describe('explodeOffsets', () => {
  it('distanza zero o pacco vuoto: nessuno spostamento', () => {
    expect(explodeOffsets(pack(), 0).size).toBe(0);
    expect(explodeOffsets(pack(), -5).size).toBe(0);
    expect(explodeOffsets(createProject(), 20).size).toBe(0);
  });

  it('una cella sola non si sposta', () => {
    const p = addCell(createProject(), { typeId: T, x: 50, y: 50 });
    expect(explodeOffsets(p, 30).size).toBe(0);
  });

  it('la cella più lontana dal centro si sposta esattamente della distanza richiesta', () => {
    const p = pack();
    const offsets = explodeOffsets(p, 25);
    const lengths = [...offsets.values()].map((o) => Math.hypot(o.dx, o.dy));
    expect(Math.max(...lengths)).toBeCloseTo(25, 6);
  });

  it('le celle si allontanano dal centro, in proporzione alla loro distanza', () => {
    const p = pack();
    const xs = p.cells.map((c) => c.x);
    const ys = p.cells.map((c) => c.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const offsets = explodeOffsets(p, 20);
    for (const c of p.cells) {
      const o = offsets.get(c.id)!;
      // stessa direzione: il prodotto vettoriale con (cella - centro) è nullo
      expect(o.dx * (c.y - cy) - o.dy * (c.x - cx)).toBeCloseTo(0, 6);
      // verso l'esterno: il prodotto scalare non è negativo
      expect(o.dx * (c.x - cx) + o.dy * (c.y - cy)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('la distanza tra celle vicine cresce, non si accorcia mai', () => {
    const p = pack();
    const offsets = explodeOffsets(p, 20);
    const [a, b] = [p.cells[0]!, p.cells[1]!];
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    const oa = offsets.get(a.id)!;
    const ob = offsets.get(b.id)!;
    const after = Math.hypot(a.x + oa.dx - (b.x + ob.dx), a.y + oa.dy - (b.y + ob.dy));
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
