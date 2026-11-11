import { describe, expect, it } from 'vitest';
import { buildHolder, buildToleranceTest, DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { generateGrid } from '../core/layout';
import { replaceCells } from '../core/ops';
import { createProject } from '../core/project';
import { holderHalfGeometries } from './holderMesh';

const project = (series = 2, parallel = 2) =>
  replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series, parallel, kind: 'hex', gapMm: 1.5 }));

/** Ogni lato deve essere condiviso da due triangoli, percorso in versi opposti: solido chiuso e orientato. */
function openEdges(pos: ArrayLike<number>): number {
  const key = (i: number) => [0, 1, 2].map((k) => pos[i * 3 + k]!.toFixed(4)).join(',');
  const count = new Map<string, number>();
  for (let t = 0; t < pos.length / 9; t++) {
    for (let e = 0; e < 3; e++) {
      const a = key(t * 3 + e);
      const b = key(t * 3 + ((e + 1) % 3));
      if (a === b) continue;
      count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [k, n] of count) {
    const [a, b] = k.split('>');
    if (n !== 1 || count.get(`${b}>${a}`) !== 1) bad++;
  }
  return bad;
}

describe('mesh dello smusso a rampa', () => {
  it('ogni cuneo è un solido chiuso, su entrambe le piastre', () => {
    const model = buildHolder(project(), DEFAULT_HOLDER_SETTINGS, true)!;
    expect(model.ramp).not.toBeNull();
    for (const half of ['top', 'bottom'] as const) {
      const geos = holderHalfGeometries(model, half);
      const wedges = geos.slice(model.layers.length);
      expect(wedges.length).toBe(2 * model.ramp!.contours.length);
      for (const g of wedges) expect(openEdges(g.getAttribute('position').array)).toBe(0);
    }
  });
});

describe('pezzo test tolleranze', () => {
  /** Per un solido chiuso ogni spigolo orientato è compensato dal suo opposto. */
  function unbalancedEdges(model: NonNullable<ReturnType<typeof buildToleranceTest>>, half: 'top' | 'bottom') {
    const key = (x: number, y: number, z: number) => [x, y, z].map((v) => Math.round(v * 1000)).join(',');
    const net = new Map<string, number>();
    for (const g of holderHalfGeometries(model, half)) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        const k = [0, 1, 2].map((j) => key(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j)));
        for (let j = 0; j < 3; j++) {
          const a = k[j]!;
          const b = k[(j + 1) % 3]!;
          if (a === b) continue;
          const id = a < b ? `${a}|${b}` : `${b}|${a}`;
          net.set(id, (net.get(id) ?? 0) + (a < b ? 1 : -1));
        }
      }
    }
    return [...net.values()].filter((n) => n !== 0).length;
  }

  it.each([
    [[0.1, 0.2, 0.3]],
    [[0.05, 0.15, 0.25, 0.35]],
  ])('la mesh con le cifre incise è chiusa (giochi %j)', (clearances) => {
    const model = buildToleranceTest({ customCellTypes: [] }, '18650-3000-10a', clearances)!;
    expect(unbalancedEdges(model, 'bottom')).toBe(0);
    expect(unbalancedEdges(model, 'top')).toBe(0);
  });
});
