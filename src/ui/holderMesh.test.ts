import { describe, expect, it } from 'vitest';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from '../core/holder';
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
