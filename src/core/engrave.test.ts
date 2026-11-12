import { describe, expect, it } from 'vitest';
import { digitPolygons, textWidth } from './engrave';
import { differenceRegions, regionArea, circlePolygon } from './clip';

describe('digitPolygons', () => {
  it('each digit has its own segments, non-digit text is ignored', () => {
    expect(digitPolygons('8', 0, 0, 5, 0.8)).toHaveLength(7);
    expect(digitPolygons('1', 0, 0, 5, 0.8)).toHaveLength(2);
    expect(digitPolygons('x', 0, 0, 5, 0.8)).toHaveLength(0);
    expect(digitPolygons('10', 0, 0, 5, 0.8)).toHaveLength(2 + 6);
  });

  it('the text is centred and textWidth wide', () => {
    const polys = digitPolygons('20', 10, 5, 5, 0.8);
    const xs = polys.flat().map((p) => p.x);
    const ys = polys.flat().map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(10 - textWidth('20', 5) / 2, 6);
    expect(Math.max(...xs)).toBeCloseTo(10 + textWidth('20', 5) / 2, 6);
    expect(Math.min(...ys)).toBeCloseTo(2.5, 1);
    expect(Math.max(...ys)).toBeCloseTo(7.5, 1);
  });

  it('the engraved "0" in a block leaves an island in the middle', () => {
    const block = { outline: circlePolygon(0, 0, 10), holes: [] };
    const cut = differenceRegions(block, digitPolygons('0', 0, 0, 5, 0.8));
    // a block with a hole as big as the "0" + the island inside the ring
    expect(cut).toHaveLength(2);
    expect(cut.filter((r) => r.holes.length === 1)).toHaveLength(1);
    const total = cut.reduce((a, r) => a + regionArea(r), 0);
    expect(total).toBeLessThan(regionArea(block));
  });
});
