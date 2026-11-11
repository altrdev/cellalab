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
  it('se la piastra entra nel piano non c\'è niente da dividere', () => {
    expect(splitHolder(pack(4, 3), bed(220))).toBeNull();
    expect(splitHolder(createProject(), bed(50))).toBeNull();
  });

  it('4S3P (105 × 65 mm) su un piano da 70 × 70: più pezzi, tutti nel piano', () => {
    const p = pack(4, 3);
    const s = splitHolder(p, bed(70))!;
    expect(s.pieces.length).toBeGreaterThanOrEqual(2);
    expect(s.allFit).toBe(true);
    for (const piece of s.pieces) {
      expect(piece.fits).toBe(true);
      expect(fitsBed(piece.widthMm, piece.depthMm, bed(70))).toBe(true);
    }
  });

  it('usa il minor numero di pezzi: 4S3P su 70 mm si divide in due', () => {
    expect(splitHolder(pack(4, 3), bed(70))!.pieces).toHaveLength(2);
  });

  it('ogni cella sta in un solo pezzo', () => {
    const p = pack(6, 4);
    const s = splitHolder(p, bed(80))!;
    const all = s.pieces.flatMap((x) => x.cellIds);
    expect(all).toHaveLength(p.cells.length);
    expect(new Set(all).size).toBe(p.cells.length);
  });

  it('un taglio non attraversa mai una tasca: ogni cella del pezzo ha la sua tasca intera (un buco)', () => {
    for (const kind of ['hex', 'square'] as const) {
      const p = pack(6, 4, kind);
      const s = splitHolder(p, bed(80))!;
      for (const piece of s.pieces) {
        const holes = piece.model.wall.flatMap((r) => r.holes);
        const centres = holes.map((h) => ({ x: h.reduce((a, q) => a + q.x, 0) / h.length, y: h.reduce((a, q) => a + q.y, 0) / h.length }));
        for (const id of piece.cellIds) {
          const c = p.cells.find((x) => x.id === id)!;
          // un buco chiuso centrato sulla cella: se il taglio la attraversasse sarebbe una rientranza, non un buco
          expect(centres.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 0.5), `${kind} ${piece.id} ${id}`).toBe(true);
        }
      }
    }
  });

  it('i pezzi insieme coprono tutto il portacelle, senza sovrapporsi', () => {
    const p = pack(6, 4);
    const settings = bed(80);
    const full = buildHolder(p, settings, false)!;
    const s = splitHolder(p, settings)!;
    const sum = s.pieces.reduce((a, piece) => a + area(piece.model.wall), 0);
    expect(sum / area(full.wall)).toBeCloseTo(1, 2);
  });

  it('lo smusso dei pezzi è a gradini e senza rampa', () => {
    const s = splitHolder(pack(4, 3), bed(70))!;
    for (const piece of s.pieces) {
      expect(piece.model.ramp).toBeNull();
      expect(piece.model.layers.length).toBeGreaterThan(2);
    }
  });

  it('sigle riga+colonna, tutte diverse', () => {
    const s = splitHolder(pack(8, 4), bed(80))!;
    const ids = s.pieces.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-H][1-8]$/);
  });

  it('le linee di taglio ci sono e stanno nel materiale', () => {
    const s = splitHolder(pack(4, 3), bed(70))!;
    expect(s.seams.length).toBeGreaterThan(0);
    const xs = s.seams.flatMap(([a, b]) => [a.x, b.x]);
    // una sola linea verticale in mezzo: x tra le celle
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(30);
  });

  it('piano non quadrato: un pezzo largo può entrare ruotato', () => {
    const settings = bed(120, 60); // 4S3P è 105 × 65: entra ruotato? 65 > 60 no -> serve dividere
    const s = splitHolder(pack(4, 3), settings)!;
    for (const piece of s.pieces) expect(fitsBed(piece.widthMm, piece.depthMm, settings)).toBe(true);
  });

  it('se un pezzo non entra mai (celle più grandi del piano) lo segnala', () => {
    const s = splitHolder(pack(3, 2), bed(15))!; // le celle da 21,4 mm non entrano in un piano da 15
    expect(s.allFit).toBe(false);
    expect(s.pieces.some((x) => !x.fits)).toBe(true);
  });
});
