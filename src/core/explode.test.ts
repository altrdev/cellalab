import { describe, expect, it } from 'vitest';
import { explodeOffsets } from './explode';
import { generateGrid } from './layout';
import { addCell, replaceCells } from './ops';
import { createProject } from './project';

const T = '21700-5000-10a';
const pack = () =>
  replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: 4, parallel: 3, kind: 'square', gapMm: 1 }));

describe('explodeOffsets', () => {
  it('zero distance or empty pack: no offset', () => {
    expect(explodeOffsets(pack(), 0).size).toBe(0);
    expect(explodeOffsets(pack(), -5).size).toBe(0);
    expect(explodeOffsets(createProject(), 20).size).toBe(0);
  });

  it('a single cell does not move', () => {
    const p = addCell(createProject(), { typeId: T, x: 50, y: 50 });
    expect(explodeOffsets(p, 30).size).toBe(0);
  });

  it('the cell farthest from the centre moves exactly the requested distance', () => {
    const p = pack();
    const offsets = explodeOffsets(p, 25);
    const lengths = [...offsets.values()].map((o) => Math.hypot(o.dx, o.dy));
    expect(Math.max(...lengths)).toBeCloseTo(25, 6);
  });

  it('the cells move away from the centre, in proportion to their distance', () => {
    const p = pack();
    const xs = p.cells.map((c) => c.x);
    const ys = p.cells.map((c) => c.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const offsets = explodeOffsets(p, 20);
    for (const c of p.cells) {
      const o = offsets.get(c.id)!;
      // same direction: the cross product with (cell - centre) is zero
      expect(o.dx * (c.y - cy) - o.dy * (c.x - cx)).toBeCloseTo(0, 6);
      // outwards: the dot product is not negative
      expect(o.dx * (c.x - cx) + o.dy * (c.y - cy)).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('the distance between neighbouring cells grows, never shrinks', () => {
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
