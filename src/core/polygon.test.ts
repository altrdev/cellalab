import { describe, expect, it } from 'vitest';
import {
  circlePoints,
  convexHull,
  polygonArea,
  signedArea,
} from './polygon';

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe('poligoni', () => {
  it('area e orientamento', () => {
    expect(polygonArea(square(0, 0, 4))).toBe(16);
    expect(signedArea([...square(0, 0, 4)].reverse())).toBe(-16);
  });

  it('inviluppo convesso: scarta i punti interni e orienta in modo positivo', () => {
    const hull = convexHull([...square(0, 0, 10), { x: 5, y: 5 }, { x: 2, y: 3 }]);
    expect(hull).toHaveLength(4);
    expect(signedArea(hull)).toBeGreaterThan(0);
    expect(polygonArea(hull)).toBeCloseTo(100, 9);
  });

  it('l\'inviluppo di due cerchi è una capsula: area ≈ πr² + 2r·d', () => {
    const r = 5;
    const d = 20;
    const hull = convexHull([...circlePoints(0, 0, r, 48), ...circlePoints(d, 0, r, 48)]);
    expect(polygonArea(hull)).toBeCloseTo(Math.PI * r * r + 2 * r * d, 0);
  });

});
