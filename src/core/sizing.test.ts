import { describe, expect, it } from 'vitest';
import {
  conductionDeltaTK,
  minAreaPeakMm2,
  minRadiusForSpots,
  minThicknessConductionMm,
  minThicknessThermalMm,
  spotCapacity,
  spotPositions,
  spotsNeeded,
  steadyDeltaTK,
} from './sizing';

const ni = { currentA: 30, resistivityOhmM: 9.5e-8, deltaTK: 25, hWm2K: 10 };

describe('thermal criterion', () => {
  it('minimum thickness: satisfies t·(w+t) = I²ρ/(2·w·h·ΔT)', () => {
    const w = 10; // mm
    const t = minThicknessThermalMm(w, ni);
    const lhs = (t * 1e-3) * (w * 1e-3 + t * 1e-3);
    const rhs = (ni.currentA ** 2 * ni.resistivityOhmM) / (2 * w * 1e-3 * ni.hWm2K * ni.deltaTK);
    expect(lhs / rhs).toBeCloseTo(1, 9);
  });

  it('hand value: 30 A on 10 mm of nickel in free air, ΔT 25 K → 1.49 mm', () => {
    // k = I²ρ/(2·w·h·ΔT) = 900·9.5e-8/(2·0.01·10·25) = 1.71e-5 m²
    // t = (−w + √(w² + 4k))/2 = (−0.01 + √1.684e-4)/2 = 1.488e-3 m
    expect(minThicknessThermalMm(10, ni)).toBeCloseTo(1.488, 2);
  });

  it('at 10 A the same strip makes do with about 0.19 mm', () => {
    expect(minThicknessThermalMm(10, { ...ni, currentA: 10 })).toBeCloseTo(0.187, 2);
  });

  it('more current → more thickness; more width → less thickness', () => {
    expect(minThicknessThermalMm(10, { ...ni, currentA: 60 })).toBeGreaterThan(minThicknessThermalMm(10, ni));
    expect(minThicknessThermalMm(20, ni)).toBeLessThan(minThicknessThermalMm(10, ni));
  });

  it('better cooling reduces the thickness', () => {
    expect(minThicknessThermalMm(10, { ...ni, hWm2K: 25 })).toBeLessThan(minThicknessThermalMm(10, ni));
  });

  it('the steady-state ΔT at the minimum thickness equals the allowed ΔT', () => {
    const t = minThicknessThermalMm(10, ni);
    expect(steadyDeltaTK(10, t, ni.currentA, ni.resistivityOhmM, ni.hWm2K)).toBeCloseTo(ni.deltaTK, 6);
  });

  it('zero current or width: no requirement', () => {
    expect(minThicknessThermalMm(10, { ...ni, currentA: 0 })).toBe(0);
    expect(minThicknessThermalMm(0, ni)).toBe(0);
    expect(steadyDeltaTK(0, 0.2, 10, 1e-7, 10)).toBe(Infinity);
  });
});

describe('adiabatic peak', () => {
  const peak = { peakCurrentA: 100, resistivityOhmM: 1.72e-8, volumetricHeatJm3K: 8960 * 385, durationS: 1, deltaTK: 100 };

  it('A_min = I·√(ρ·t/(c_v·ΔT)): copper, 100 A, 1 s, 100 K ≈ 0.71 mm²', () => {
    // √(1.72e-8/(3.45e6·100)) = √(4.99e-17) = 7.06e-9 → ·100 A = 7.06e-7 m² = 0.706 mm²
    expect(minAreaPeakMm2(peak)).toBeCloseTo(0.706, 2);
  });

  it('grows with the duration and the current', () => {
    expect(minAreaPeakMm2({ ...peak, durationS: 4 })).toBeCloseTo(2 * minAreaPeakMm2(peak), 6);
    expect(minAreaPeakMm2({ ...peak, peakCurrentA: 200 })).toBeCloseTo(2 * minAreaPeakMm2(peak), 6);
    expect(minAreaPeakMm2({ ...peak, peakCurrentA: 0 })).toBe(0);
  });
});

describe('weld spots', () => {
  it('spotsNeeded: at least the minimum, then ceil(I/I_spot)', () => {
    expect(spotsNeeded(3, 5, 2)).toBe(2);
    expect(spotsNeeded(12, 5, 2)).toBe(3);
    expect(spotsNeeded(10, 5, 2)).toBe(2); // 10/5 = 2 esatto, niente arrotondamento in eccesso
    expect(spotsNeeded(10, 0, 2)).toBe(Infinity);
  });

  it('spotCapacity: a small contact holds few, a large one many more', () => {
    expect(spotCapacity(0.5, 2, 3)).toBe(0); // smaller than one spot
    expect(spotCapacity(4, 2, 3)).toBeGreaterThanOrEqual(2);
    expect(spotCapacity(8, 2, 3)).toBeGreaterThan(spotCapacity(4, 2, 3));
    expect(spotCapacity(8, 2, 3)).toBeGreaterThanOrEqual(6);
  });
});

describe('spotCapacity: small contacts', () => {
  it('radius 3 mm, Ø2 spots at 3 mm: 2 side by side fit, not 1', () => {
    expect(spotCapacity(3, 2, 3)).toBe(2);
    expect(spotPositions(3, 2, 3, 2)).toHaveLength(2);
  });
  it('radius 4.39 mm: at least 5 spots', () => {
    expect(spotCapacity(4.39, 2, 3)).toBeGreaterThanOrEqual(5);
  });
});

describe('spotPositions', () => {
  it('two spots: symmetric about the centre, at a distance at least equal to the pitch', () => {
    const pts = spotPositions(8, 2, 3, 2);
    expect(pts).toHaveLength(2);
    expect(pts[0]!.x + pts[1]!.x).toBeCloseTo(0, 9);
    expect(pts[0]!.y + pts[1]!.y).toBeCloseTo(0, 9);
    expect(Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)).toBeGreaterThanOrEqual(3 - 1e-9);
  });

  it('three or four spots: all inside the contact and at mutual distance >= pitch', () => {
    for (const n of [3, 4]) {
      const pts = spotPositions(8, 2, 3, n);
      expect(pts).toHaveLength(n);
      for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(8 - 1 + 1e-9);
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
          expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });

  it('four spots: a 2×2 square, even if the contact is large', () => {
    for (const r of [3.77, 4.39, 5.4, 8]) {
      const pts = spotPositions(r, 2, 3, 4);
      expect(pts).toHaveLength(4);
      for (const p of pts) {
        expect(Math.abs(p.x)).toBeCloseTo(1.5, 6);
        expect(Math.abs(p.y)).toBeCloseTo(1.5, 6);
      }
      expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(4);
    }
  });

  it('six spots: a 2×3 rectangle (two rows side by side)', () => {
    const pts = spotPositions(5.4, 2, 3, 6);
    expect(pts).toHaveLength(6);
    const xs = new Set(pts.map((p) => Math.round(p.x * 10)));
    const ys = new Set(pts.map((p) => Math.round(p.y * 10)));
    // due colonne e tre righe, oppure tre colonne e due righe
    expect(xs.size * ys.size).toBe(6);
  });

  it('even number: the layout is symmetric about the centre', () => {
    for (const [r, n] of [[3.77, 4], [4.39, 4], [5.4, 4], [4.39, 6], [5.4, 6], [6, 8]] as const) {
      const pts = spotPositions(r, 2, 3, n);
      expect(pts).toHaveLength(n);
      const keys = new Set(pts.map((p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`));
      for (const p of pts) expect(keys.has(`${Math.round(-p.x * 100) + 0},${Math.round(-p.y * 100) + 0}`)).toBe(true);
    }
  });

  it('if they do not fit it returns an empty list', () => {
    expect(spotPositions(2, 2, 3, 4)).toEqual([]);
    expect(spotPositions(8, 2, 3, 0)).toEqual([]);
  });

  it('consistent with spotCapacity: exactly capacity spots fit', () => {
    const cap = spotCapacity(5.4, 2, 3);
    expect(spotPositions(5.4, 2, 3, cap).length === cap || cap % 2 === 1).toBe(true);
    expect(spotPositions(5.4, 2, 3, cap + 1)).toEqual([]);
  });
});

describe('conduction towards the cells', () => {
  // nichel, banda 5,7 mm, 10 A, aria libera
  const band = { currentA: 10, resistivityOhmM: 1.12e-7, deltaTK: 25, hWm2K: 10, conductivityWmK: 90, endDeltaK: 0 };

  it('very long band: back to the free-air case', () => {
    const inf = conductionDeltaTK(5.7, 0.3, { ...band, lengthMm: 1e6 });
    expect(inf).toBeCloseTo(steadyDeltaTK(5.7, 0.3, 10, 1.12e-7, 10), 4);
  });

  it('hand case: 5.7 × 0.15 mm, 10 A, L = 12 mm, ends at 0 K', () => {
    // θp = I²ρ/(h·P·A) ≈ 113 K; m = √(hP/(kA)) ≈ 38,8 /m; cosh(m·L/2) ≈ 1,027 → θ ≈ θp·(1 − 1/cosh) ≈ 3 K
    const th = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 12 });
    expect(th).toBeGreaterThan(2.5);
    expect(th).toBeLessThan(3.6);
  });

  it('with hot ends the centre does not drop below them', () => {
    const th = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 12, endDeltaK: 10 });
    expect(th).toBeGreaterThan(10);
    expect(th).toBeLessThan(15);
  });

  it('the shorter the band, the less it heats', () => {
    const a = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 30 });
    const b = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 10 });
    expect(b).toBeLessThan(a);
  });

  it('the minimum thickness found respects ΔT and a thinner one does not', () => {
    const inp = { ...band, lengthMm: 25, endDeltaK: 10 };
    const t = minThicknessConductionMm(10, { ...inp, currentA: 40 });
    expect(conductionDeltaTK(10, t, { ...inp, currentA: 40 })).toBeLessThanOrEqual(25 + 1e-6);
    expect(conductionDeltaTK(10, t * 0.9, { ...inp, currentA: 40 })).toBeGreaterThan(25);
  });

  it('never asks for more than free air with cold ends', () => {
    const air = minThicknessThermalMm(5.7, { currentA: 10, resistivityOhmM: 1.12e-7, deltaTK: 25, hWm2K: 10 });
    expect(minThicknessConductionMm(5.7, { ...band, lengthMm: 12 })).toBeLessThan(air);
  });

  it('zero current: no thickness; ends beyond ΔT: an answer anyway', () => {
    expect(minThicknessConductionMm(5.7, { ...band, currentA: 0, lengthMm: 12 })).toBe(0);
    expect(minThicknessConductionMm(5.7, { ...band, lengthMm: 12, endDeltaK: 100 })).toBeGreaterThan(0);
  });
});

describe('minimum radius for the spots', () => {
  it('4 spots of 2 mm at 3 mm pitch: about 3.12 mm of radius needed (2×2 square)', () => {
    const r = minRadiusForSpots(4, 2, 3);
    expect(r).toBeGreaterThanOrEqual(3.1);
    expect(r).toBeLessThan(3.2);
    expect(spotCapacity(r, 2, 3)).toBeGreaterThanOrEqual(4);
    expect(spotCapacity(r - 0.05, 2, 3)).toBeLessThan(4);
  });
  it('2 spots: 2.5 mm; with a smaller distance fewer are needed', () => {
    expect(minRadiusForSpots(2, 2, 3)).toBeCloseTo(2.5, 1);
    expect(minRadiusForSpots(4, 2, 2.5)).toBeLessThan(minRadiusForSpots(4, 2, 3));
  });
});
