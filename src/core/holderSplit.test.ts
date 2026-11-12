import { describe, expect, it } from 'vitest';
import { regionArea } from './clip';
import { buildHolder, DEFAULT_HOLDER_SETTINGS, fitsBed } from './holder';
import { splitHolder } from './holderSplit';
import { generateGrid } from './layout';
import { replaceCells } from './ops';
import { createProject } from './project';

const pack = (series: number, parallel: number, kind: 'hex' | 'square' = 'hex', gapMm = 1.5) =>
  replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series, parallel, kind, gapMm }));
const bed = (x: number, y = x) => ({ ...DEFAULT_HOLDER_SETTINGS, bedXMm: x, bedYMm: y });
const area = (rs: { outline: unknown[]; holes: unknown[][] }[]) => rs.reduce((a, r) => a + regionArea(r as never), 0);

describe('splitHolder', () => {
  it('if the plate fits the bed there is nothing to split', () => {
    expect(splitHolder(pack(4, 3), bed(220))).toBeNull();
    expect(splitHolder(createProject(), bed(50))).toBeNull();
  });

  it('4S3P (105 × 65 mm) on a 70 × 70 bed: several pieces, all within the bed', () => {
    const p = pack(4, 3);
    const s = splitHolder(p, bed(70))!;
    expect(s.pieces.length).toBeGreaterThanOrEqual(2);
    expect(s.allFit).toBe(true);
    for (const piece of s.pieces) {
      expect(piece.fits).toBe(true);
      expect(fitsBed(piece.widthMm, piece.depthMm, bed(70))).toBe(true);
    }
  });

  it('uses the fewest pieces: 4S3P on 70 mm splits in two', () => {
    expect(splitHolder(pack(4, 3), bed(70))!.pieces).toHaveLength(2);
  });

  it('each cell is in a single piece', () => {
    const p = pack(6, 4);
    const s = splitHolder(p, bed(80))!;
    const all = s.pieces.flatMap((x) => x.cellIds);
    expect(all).toHaveLength(p.cells.length);
    expect(new Set(all).size).toBe(p.cells.length);
  });

  it('a cut never crosses a pocket: each cell of the piece has its whole pocket (a hole)', () => {
    for (const kind of ['hex', 'square'] as const) {
      const p = pack(6, 4, kind);
      const s = splitHolder(p, bed(80))!;
      for (const piece of s.pieces) {
        const holes = piece.model.wall.flatMap((r) => r.holes);
        const centres = holes.map((h) => ({ x: h.reduce((a, q) => a + q.x, 0) / h.length, y: h.reduce((a, q) => a + q.y, 0) / h.length }));
        for (const id of piece.cellIds) {
          const c = p.cells.find((x) => x.id === id)!;
          // a closed hole centred on the cell: if the cut crossed it, it would be a recess, not a hole
          expect(centres.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 0.5), `${kind} ${piece.id} ${id}`).toBe(true);
        }
      }
    }
  });

  it('the pieces together cover the whole holder, without overlapping', () => {
    const p = pack(6, 4);
    const settings = bed(80);
    const full = buildHolder(p, settings, false)!;
    const s = splitHolder(p, settings)!;
    const sum = s.pieces.reduce((a, piece) => a + area(piece.model.wall), 0);
    expect(sum / area(full.wall)).toBeCloseTo(1, 2);
  });

  it('the pieces\' chamfer is stepped and has no ramp', () => {
    const s = splitHolder(pack(4, 3), bed(70))!;
    for (const piece of s.pieces) {
      expect(piece.model.ramp).toBeNull();
      expect(piece.model.layers.length).toBeGreaterThan(2);
    }
  });

  it('row+column labels, all different', () => {
    const s = splitHolder(pack(8, 4), bed(80))!;
    const ids = s.pieces.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-H][1-8]$/);
  });

  it('the cut lines exist and lie in the material', () => {
    const s = splitHolder(pack(4, 3), bed(70))!;
    expect(s.seams.length).toBeGreaterThan(0);
    const xs = s.seams.flatMap(([a, b]) => [a.x, b.x]);
    // a single vertical line in the middle: x between the cells
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(30);
  });

  it('non-square bed: a wide piece can fit rotated', () => {
    const settings = bed(120, 60); // 4S3P is 105 × 65: does it fit rotated? 65 > 60 no -> needs splitting
    const s = splitHolder(pack(4, 3), settings)!;
    for (const piece of s.pieces) expect(fitsBed(piece.widthMm, piece.depthMm, settings)).toBe(true);
  });

  it('if a piece never fits (cells larger than the bed) it flags it', () => {
    const s = splitHolder(pack(3, 2), bed(15))!; // 21.4 mm cells do not fit in a 15 bed
    expect(s.allFit).toBe(false);
    expect(s.pieces.some((x) => !x.fits)).toBe(true);
  });
});
