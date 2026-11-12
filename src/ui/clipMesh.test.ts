import { describe, expect, it } from 'vitest';
import { cableClips, clipSpec } from '../core/cableClip';
import { buildHarness } from '../core/harness';
import { generateGrid } from '../core/layout';
import { replaceCells, setBms } from '../core/ops';
import { createProject } from '../core/project';
import { buildStrips } from '../core/strips';
import { clipGeometry, clipStl } from './clipMesh';

const project = setBms(
  replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 4, parallel: 3, kind: 'hex', gapMm: 1.5 })),
  'bms-4s-30a-li-ion',
);
const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, powerHoleMm: 2.85 } as const;
const harness = buildHarness(project, buildStrips(project, { tabs }), 0.1)!;
const spec = clipSpec(project, 21.4, 3.6);

describe('fermacavi nel vuoto tra le celle', () => {
  it('la lama sta nella fessura tra due celle', () => {
    expect(spec.bladeMm).toBeLessThan(1.5);
    expect(spec.bladeMm).toBeGreaterThanOrEqual(0.6);
    const tight = clipSpec(replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 2, parallel: 2, kind: 'hex', gapMm: 0.8 })), 21.4, 3.6);
    expect(tight.bladeMm).toBe(0.6);
  });

  it('vanno nei vuoti tra celle in fila sul fianco, mai sopra una cella', () => {
    const clips = cableClips(project, harness);
    expect(clips.length).toBeGreaterThanOrEqual(1);
    for (const c of clips) {
      expect(Math.hypot(c.out.x, c.out.y)).toBeCloseTo(1, 6);
      for (const cell of project.cells) expect(Math.hypot(c.center.x - cell.x, c.center.z - cell.y)).toBeGreaterThan(21.4 / 2 - 0.01);
      // al centro tra due celle della fila: a metà del passo (22,9)
      const along = c.center.x * c.along.x + c.center.z * c.along.y;
      const rem = ((along % 22.9) + 22.9) % 22.9;
      expect(Math.abs(rem - 11.45)).toBeLessThan(0.5);
    }
  });

  it('due fermacavi dello stesso cavo sullo stesso tratto distano almeno 35 mm', () => {
    const clips = cableClips(project, harness);
    for (const label of ['P+', 'P−'] as const) {
      const mine = clips.filter((c) => c.cable === label);
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          if (Math.abs(mine[i]!.along.x - mine[j]!.along.x) + Math.abs(mine[i]!.along.y - mine[j]!.along.y) > 1e-6) continue;
          expect(Math.hypot(mine[i]!.center.x - mine[j]!.center.x, mine[i]!.center.z - mine[j]!.center.z)).toBeGreaterThanOrEqual(35 - 1e-6);
        }
      }
    }
  });

  it('senza cavi non ci sono fermacavi', () => {
    expect(cableClips(project, { ...harness, cables: [] })).toEqual([]);
  });

  it('il blocco ha la lama sotto la tangente, il corpo e l’incavo per il cavo', () => {
    const g = clipGeometry(spec);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.z).toBeCloseTo(-spec.bladeDepthMm, 6);
    expect(b.max.z).toBeCloseTo(0.25 + 3.6, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(4, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(3.6 + 2 * (0.1 + 1.2), 6);
    // l'asse del cavo (x) è libero: nessun vertice sul cavo a parte le pareti ai lati
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i)) < 1.0 && pos.getZ(i) > 0.3 && pos.getZ(i) < 3.5) throw new Error('il cavo non passa');
    }
    g.dispose();
  });

  it('l’STL è un file binario valido', () => {
    const stl = clipStl(spec);
    const tri = new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
    expect(tri).toBeGreaterThan(30);
    expect(stl.byteLength).toBe(84 + tri * 50);
  });
});
