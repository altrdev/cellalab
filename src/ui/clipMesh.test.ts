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

describe('fermacavi a scatto', () => {
  it('lo spessore della fascia entra nel vuoto tra due celle', () => {
    expect(spec.thicknessMm).toBeLessThanOrEqual(1.5 - 0.25 - 0.15 + 1e-9);
    expect(spec.thicknessMm).toBeGreaterThanOrEqual(0.8);
    const tight = clipSpec(replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 2, parallel: 2, kind: 'hex', gapMm: 0.8 })), 21.4, 3.6);
    expect(tight.thicknessMm).toBe(0.8);
  });

  it('stanno sulle celle che toccano il fianco e rispettano la distanza', () => {
    const clips = cableClips(project, harness);
    expect(clips.length).toBeGreaterThanOrEqual(2);
    for (const c of clips) {
      const cell = project.cells.find((x) => x.id === c.cellId)!;
      // il cavo corre a filo della cella: la distanza dal suo asse lungo la normale è raggio + gioco + mezzo cavo
      expect(c.center.x).toBeCloseTo(cell.x, 6);
      expect(c.center.z).toBeCloseTo(cell.y, 6);
      expect(Math.hypot(c.out.x, c.out.y)).toBeCloseTo(1, 6);
    }
    // due fermacavi dello stesso cavo non si toccano (almeno 35 mm tra le celle sullo stesso tratto)
    for (const label of ['P+', 'P−'] as const) {
      const mine = clips.filter((c) => c.cable === label);
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          if (Math.abs(mine[i]!.along.x - mine[j]!.along.x) + Math.abs(mine[i]!.along.y - mine[j]!.along.y) > 1e-6) continue; // tratti diversi
          const d = Math.hypot(mine[i]!.center.x - mine[j]!.center.x, mine[i]!.center.z - mine[j]!.center.z);
          expect(d).toBeGreaterThanOrEqual(35 - 1e-6);
        }
      }
    }
  });

  it('senza cavi non ci sono fermacavi', () => {
    expect(cableClips(project, { ...harness, cables: [] })).toEqual([]);
  });

  it('la forma ha la fascia attorno alla cella e la bocca verso l’esterno', () => {
    const g = clipGeometry(spec);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    const r = 21.4 / 2 + 0.15 + spec.thicknessMm;
    // lungo X (cavo) e Z (fuori) la fascia sta nel raggio esterno; i piantoni spuntano fuori dalla fascia
    expect(box.min.x).toBeLessThanOrEqual(-r + 0.1);
    expect(box.max.x).toBeGreaterThanOrEqual(r - 0.1);
    expect(box.min.z).toBeCloseTo(-r, 0);
    expect(box.max.z).toBeGreaterThan(21.4 / 2); // ganci oltre la cella
    expect(box.max.y - box.min.y).toBeCloseTo(spec.heightMm, 6);
    // la bocca è libera: nessun vertice sulla fascia nell’asse della bocca (x=0, z>0) tra la cella e il gancio
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i)) < 1 && pos.getZ(i) > 0 && pos.getZ(i) < 21.4 / 2 + 1.5) throw new Error('la bocca è chiusa');
    }
    g.dispose();
  });

  it('l’STL è un file binario valido con la cella in verticale', () => {
    const stl = clipStl(spec);
    const tri = new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
    expect(tri).toBeGreaterThan(100);
    expect(stl.byteLength).toBe(84 + tri * 50);
  });
});
