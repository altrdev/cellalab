import { describe, expect, it } from 'vitest';
import { offsetRegion, regionArea, regionDistance, unionPolygons } from './clip';
import { circlePoints } from './polygon';

const sq = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe('clip', () => {
  it('unione di due quadrati sovrapposti: un solo contorno, area giusta', () => {
    const r = unionPolygons([sq(0, 0, 10), sq(5, 5, 10)]);
    expect(r.holes).toHaveLength(0);
    expect(regionArea(r)).toBeCloseTo(175, 1);
  });
  it('cornice di rettangoli: la finestra resta un buco', () => {
    const rect = (x: number, y: number, w: number, h: number) => [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    const frame = unionPolygons([rect(0, 0, 30, 10), rect(0, 20, 30, 10), rect(0, 0, 10, 30), rect(20, 0, 10, 30)]);
    expect(frame.holes).toHaveLength(1);
    expect(regionArea(frame)).toBeCloseTo(800, 1);
  });
  it('offset verso fuori aumenta l’area, verso dentro la riduce; i buchi si restringono', () => {
    const a = unionPolygons([circlePoints(0, 0, 10, 48)]);
    expect(regionArea(offsetRegion(a, 1))).toBeGreaterThan(regionArea(a));
    expect(regionArea(offsetRegion(a, -1))).toBeLessThan(regionArea(a));
    const holed = { outline: sq(0, 0, 30), holes: [sq(10, 10, 10)] };
    const bigger = offsetRegion(holed, 1);
    expect(bigger.holes).toHaveLength(1);
    expect(regionArea(bigger)).toBeGreaterThan(regionArea(holed));
    // fuori 32×32 con angoli tondi (≈1023), il buco scende da 100 a 64
    expect(regionArea(bigger)).toBeCloseTo(1023.1 - 64, 0);
  });
  it('distanza: 0 se sovrapposte, altrimenti tra i bordi', () => {
    const a = unionPolygons([sq(0, 0, 10)]);
    expect(regionDistance(a, unionPolygons([sq(5, 5, 10)]))).toBe(0);
    expect(regionDistance(a, unionPolygons([sq(13, 0, 10)]))).toBeCloseTo(3, 3);
  });
});
