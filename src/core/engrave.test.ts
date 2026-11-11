import { describe, expect, it } from 'vitest';
import { digitPolygons, textWidth } from './engrave';
import { differenceRegions, regionArea, circlePolygon } from './clip';

describe('digitPolygons', () => {
  it('ogni cifra ha i suoi segmenti, il testo non-cifra è ignorato', () => {
    expect(digitPolygons('8', 0, 0, 5, 0.8)).toHaveLength(7);
    expect(digitPolygons('1', 0, 0, 5, 0.8)).toHaveLength(2);
    expect(digitPolygons('x', 0, 0, 5, 0.8)).toHaveLength(0);
    expect(digitPolygons('10', 0, 0, 5, 0.8)).toHaveLength(2 + 6);
  });

  it('il testo è centrato e largo textWidth', () => {
    const polys = digitPolygons('20', 10, 5, 5, 0.8);
    const xs = polys.flat().map((p) => p.x);
    const ys = polys.flat().map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10 - textWidth('20', 5) / 2, 6);
    expect(Math.max(...xs)).toBeCloseTo(10 + textWidth('20', 5) / 2, 6);
    expect(Math.min(...ys)).toBeCloseTo(2.5, 1);
    expect(Math.max(...ys)).toBeCloseTo(7.5, 1);
  });

  it('lo "0" inciso in un blocco lascia un\'isola al centro', () => {
    const block = { outline: circlePolygon(0, 0, 10), holes: [] };
    const cut = differenceRegions(block, digitPolygons('0', 0, 0, 5, 0.8));
    // blocco con un buco grande quanto lo "0" + l'isola che sta dentro l'anello
    expect(cut).toHaveLength(2);
    expect(cut.filter((r) => r.holes.length === 1)).toHaveLength(1);
    const total = cut.reduce((a, r) => a + regionArea(r), 0);
    expect(total).toBeLessThan(regionArea(block));
  });
});
