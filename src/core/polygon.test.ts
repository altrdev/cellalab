import { describe, expect, it } from 'vitest';
import {
  chordLength,
  circlePoints,
  convexDistance,
  convexHull,
  minWidth,
  offsetConvex,
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

  it('offsetConvex: un quadrato 10×10 spostato di 1 mm diventa 12×12 (e 8×8 verso l\'interno)', () => {
    expect(polygonArea(offsetConvex(square(0, 0, 10), 1))).toBeCloseTo(144, 6);
    expect(polygonArea(offsetConvex(square(0, 0, 10), -1))).toBeCloseTo(64, 6);
    expect(polygonArea(offsetConvex([...square(0, 0, 10)].reverse(), 1))).toBeCloseTo(144, 6);
    expect(polygonArea(offsetConvex(square(0, 0, 10), 0))).toBe(100);
  });

  it('chordLength: corda in un quadrato', () => {
    const sq = square(0, 0, 10);
    expect(chordLength(sq, { x: 5, y: 5 }, { x: 1, y: 0 })).toBeCloseTo(10, 9);
    expect(chordLength(sq, { x: 5, y: 5 }, { x: 0, y: 1 })).toBeCloseTo(10, 9);
    expect(chordLength(sq, { x: 5, y: 5 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 })).toBeCloseTo(10 * Math.SQRT2, 9);
    expect(chordLength(sq, { x: 50, y: 5 }, { x: 0, y: 1 })).toBe(0);
  });

  it('minWidth: rettangolo 10×4 → 4', () => {
    expect(minWidth([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 }])).toBeCloseTo(4, 9);
  });

  it('convexDistance: 0 se si sovrappongono o si toccano, altrimenti la distanza vera', () => {
    expect(convexDistance(square(0, 0, 10), square(5, 5, 10))).toBe(0);
    expect(convexDistance(square(0, 0, 10), square(10, 0, 10))).toBe(0);
    expect(convexDistance(square(0, 0, 10), square(13, 0, 10))).toBeCloseTo(3, 9);
    expect(convexDistance(square(0, 0, 10), square(13, 14, 10))).toBeCloseTo(5, 9); // diagonale 3-4-5
  });
});
