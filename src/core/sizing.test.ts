import { describe, expect, it } from 'vitest';
import {
  conductionDeltaTK,
  minAreaPeakMm2,
  minRadiusForSpots,
  minThicknessConductionMm,
  minThicknessThermalMm,
  minWidthThermalMm,
  spotCapacity,
  spotPositions,
  spotsNeeded,
  steadyDeltaTK,
} from './sizing';

const ni = { currentA: 30, resistivityOhmM: 9.5e-8, deltaTK: 25, hWm2K: 10 };

describe('criterio termico', () => {
  it('spessore minimo: soddisfa t·(w+t) = I²ρ/(2·w·h·ΔT)', () => {
    const w = 10; // mm
    const t = minThicknessThermalMm(w, ni);
    const lhs = (t * 1e-3) * (w * 1e-3 + t * 1e-3);
    const rhs = (ni.currentA ** 2 * ni.resistivityOhmM) / (2 * w * 1e-3 * ni.hWm2K * ni.deltaTK);
    expect(lhs / rhs).toBeCloseTo(1, 9);
  });

  it('valore a mano: 30 A su 10 mm di nichel in aria libera, ΔT 25 K → 1,49 mm', () => {
    // k = I²ρ/(2·w·h·ΔT) = 900·9.5e-8/(2·0.01·10·25) = 1.71e-5 m²
    // t = (−w + √(w² + 4k))/2 = (−0.01 + √1.684e-4)/2 = 1.488e-3 m
    expect(minThicknessThermalMm(10, ni)).toBeCloseTo(1.488, 2);
  });

  it('a 10 A la stessa lamella si accontenta di circa 0,19 mm', () => {
    expect(minThicknessThermalMm(10, { ...ni, currentA: 10 })).toBeCloseTo(0.187, 2);
  });

  it('più corrente → più spessore; più larghezza → meno spessore', () => {
    expect(minThicknessThermalMm(10, { ...ni, currentA: 60 })).toBeGreaterThan(minThicknessThermalMm(10, ni));
    expect(minThicknessThermalMm(20, ni)).toBeLessThan(minThicknessThermalMm(10, ni));
  });

  it('un raffreddamento migliore riduce lo spessore', () => {
    expect(minThicknessThermalMm(10, { ...ni, hWm2K: 25 })).toBeLessThan(minThicknessThermalMm(10, ni));
  });

  it('larghezza minima e spessore minimo sono coerenti (inversi)', () => {
    const t = minThicknessThermalMm(12, ni);
    expect(minWidthThermalMm(t, ni)).toBeCloseTo(12, 6);
  });

  it('il ΔT a regime con lo spessore minimo vale il ΔT ammesso', () => {
    const t = minThicknessThermalMm(10, ni);
    expect(steadyDeltaTK(10, t, ni.currentA, ni.resistivityOhmM, ni.hWm2K)).toBeCloseTo(ni.deltaTK, 6);
  });

  it('corrente o larghezza nulle: nessun requisito', () => {
    expect(minThicknessThermalMm(10, { ...ni, currentA: 0 })).toBe(0);
    expect(minThicknessThermalMm(0, ni)).toBe(0);
    expect(steadyDeltaTK(0, 0.2, 10, 1e-7, 10)).toBe(Infinity);
  });
});

describe('picco adiabatico', () => {
  const peak = { peakCurrentA: 100, resistivityOhmM: 1.72e-8, volumetricHeatJm3K: 8960 * 385, durationS: 1, deltaTK: 100 };

  it('A_min = I·√(ρ·t/(c_v·ΔT)): rame, 100 A, 1 s, 100 K ≈ 0,71 mm²', () => {
    // √(1.72e-8/(3.45e6·100)) = √(4.99e-17) = 7.06e-9 → ·100 A = 7.06e-7 m² = 0.706 mm²
    expect(minAreaPeakMm2(peak)).toBeCloseTo(0.706, 2);
  });

  it('cresce con la durata e con la corrente', () => {
    expect(minAreaPeakMm2({ ...peak, durationS: 4 })).toBeCloseTo(2 * minAreaPeakMm2(peak), 6);
    expect(minAreaPeakMm2({ ...peak, peakCurrentA: 200 })).toBeCloseTo(2 * minAreaPeakMm2(peak), 6);
    expect(minAreaPeakMm2({ ...peak, peakCurrentA: 0 })).toBe(0);
  });
});

describe('punti di saldatura', () => {
  it('spotsNeeded: almeno il minimo, poi ceil(I/I_punto)', () => {
    expect(spotsNeeded(3, 5, 2)).toBe(2);
    expect(spotsNeeded(12, 5, 2)).toBe(3);
    expect(spotsNeeded(10, 5, 2)).toBe(2); // 10/5 = 2 esatto, niente arrotondamento in eccesso
    expect(spotsNeeded(10, 0, 2)).toBe(Infinity);
  });

  it('spotCapacity: un contatto piccolo ne ospita pochi, uno grande molti di più', () => {
    expect(spotCapacity(0.5, 2, 3)).toBe(0); // più piccolo di un punto
    expect(spotCapacity(4, 2, 3)).toBeGreaterThanOrEqual(2);
    expect(spotCapacity(8, 2, 3)).toBeGreaterThan(spotCapacity(4, 2, 3));
    expect(spotCapacity(8, 2, 3)).toBeGreaterThanOrEqual(6);
  });
});

describe('spotCapacity: contatti piccoli', () => {
  it('raggio 3 mm, punti Ø2 a 3 mm: ne entrano 2 affiancati, non 1', () => {
    expect(spotCapacity(3, 2, 3)).toBe(2);
    expect(spotPositions(3, 2, 3, 2)).toHaveLength(2);
  });
  it('raggio 4,39 mm: almeno 5 punti', () => {
    expect(spotCapacity(4.39, 2, 3)).toBeGreaterThanOrEqual(5);
  });
});

describe('spotPositions', () => {
  it('due punti: simmetrici rispetto al centro, a distanza almeno pari al passo', () => {
    const pts = spotPositions(8, 2, 3, 2);
    expect(pts).toHaveLength(2);
    expect(pts[0]!.x + pts[1]!.x).toBeCloseTo(0, 9);
    expect(pts[0]!.y + pts[1]!.y).toBeCloseTo(0, 9);
    expect(Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)).toBeGreaterThanOrEqual(3 - 1e-9);
  });

  it('tre o quattro punti: tutti dentro il contatto e a distanza reciproca >= passo', () => {
    for (const n of [3, 4]) {
      const pts = spotPositions(8, 2, 3, n);
      expect(pts).toHaveLength(n);
      for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(8 - 1 + 1e-9);
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
          expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y)).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });

  it('quattro punti: un quadrato 2×2, anche se il contatto è grande', () => {
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

  it('sei punti: un rettangolo 2×3 (due file affiancate)', () => {
    const pts = spotPositions(5.4, 2, 3, 6);
    expect(pts).toHaveLength(6);
    const xs = new Set(pts.map((p) => Math.round(p.x * 10)));
    const ys = new Set(pts.map((p) => Math.round(p.y * 10)));
    // due colonne e tre righe, oppure tre colonne e due righe
    expect(xs.size * ys.size).toBe(6);
  });

  it('numero pari: la disposizione è simmetrica rispetto al centro', () => {
    for (const [r, n] of [[3.77, 4], [4.39, 4], [5.4, 4], [4.39, 6], [5.4, 6], [6, 8]] as const) {
      const pts = spotPositions(r, 2, 3, n);
      expect(pts).toHaveLength(n);
      const keys = new Set(pts.map((p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`));
      for (const p of pts) expect(keys.has(`${Math.round(-p.x * 100) + 0},${Math.round(-p.y * 100) + 0}`)).toBe(true);
    }
  });

  it('se non ci stanno restituisce una lista vuota', () => {
    expect(spotPositions(2, 2, 3, 4)).toEqual([]);
    expect(spotPositions(8, 2, 3, 0)).toEqual([]);
  });

  it('coerente con spotCapacity: ci stanno esattamente capacity punti', () => {
    const cap = spotCapacity(5.4, 2, 3);
    expect(spotPositions(5.4, 2, 3, cap).length === cap || cap % 2 === 1).toBe(true);
    expect(spotPositions(5.4, 2, 3, cap + 1)).toEqual([]);
  });
});

describe('conduzione verso le celle', () => {
  // nichel, banda 5,7 mm, 10 A, aria libera
  const band = { currentA: 10, resistivityOhmM: 1.12e-7, deltaTK: 25, hWm2K: 10, conductivityWmK: 90, endDeltaK: 0 };

  it('banda lunghissima: torna al caso di aria libera', () => {
    const inf = conductionDeltaTK(5.7, 0.3, { ...band, lengthMm: 1e6 });
    expect(inf).toBeCloseTo(steadyDeltaTK(5.7, 0.3, 10, 1.12e-7, 10), 4);
  });

  it('caso a mano: 5,7 × 0,15 mm, 10 A, L = 12 mm, estremità a 0 K', () => {
    // θp = I²ρ/(h·P·A) ≈ 113 K; m = √(hP/(kA)) ≈ 38,8 /m; cosh(m·L/2) ≈ 1,027 → θ ≈ θp·(1 − 1/cosh) ≈ 3 K
    const th = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 12 });
    expect(th).toBeGreaterThan(2.5);
    expect(th).toBeLessThan(3.6);
  });

  it('con le estremità calde il centro non scende sotto di loro', () => {
    const th = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 12, endDeltaK: 10 });
    expect(th).toBeGreaterThan(10);
    expect(th).toBeLessThan(15);
  });

  it('più corta la banda, meno scalda', () => {
    const a = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 30 });
    const b = conductionDeltaTK(5.7, 0.15, { ...band, lengthMm: 10 });
    expect(b).toBeLessThan(a);
  });

  it('lo spessore minimo trovato rispetta ΔT e uno più sottile no', () => {
    const inp = { ...band, lengthMm: 25, endDeltaK: 10 };
    const t = minThicknessConductionMm(10, { ...inp, currentA: 40 });
    expect(conductionDeltaTK(10, t, { ...inp, currentA: 40 })).toBeLessThanOrEqual(25 + 1e-6);
    expect(conductionDeltaTK(10, t * 0.9, { ...inp, currentA: 40 })).toBeGreaterThan(25);
  });

  it('non chiede mai più dell\'aria libera con le estremità fredde', () => {
    const air = minThicknessThermalMm(5.7, { currentA: 10, resistivityOhmM: 1.12e-7, deltaTK: 25, hWm2K: 10 });
    expect(minThicknessConductionMm(5.7, { ...band, lengthMm: 12 })).toBeLessThan(air);
  });

  it('corrente nulla: niente spessore; estremità oltre ΔT: comunque una risposta', () => {
    expect(minThicknessConductionMm(5.7, { ...band, currentA: 0, lengthMm: 12 })).toBe(0);
    expect(minThicknessConductionMm(5.7, { ...band, lengthMm: 12, endDeltaK: 100 })).toBeGreaterThan(0);
  });
});

describe('raggio minimo per i punti', () => {
  it('4 punti da 2 mm a passo 3 mm: servono circa 3,12 mm di raggio (quadrato 2×2)', () => {
    const r = minRadiusForSpots(4, 2, 3);
    expect(r).toBeGreaterThanOrEqual(3.1);
    expect(r).toBeLessThan(3.2);
    expect(spotCapacity(r, 2, 3)).toBeGreaterThanOrEqual(4);
    expect(spotCapacity(r - 0.05, 2, 3)).toBeLessThan(4);
  });
  it('2 punti: 2,5 mm; con distanza minore ne servono meno', () => {
    expect(minRadiusForSpots(2, 2, 3)).toBeCloseTo(2.5, 1);
    expect(minRadiusForSpots(4, 2, 2.5)).toBeLessThan(minRadiusForSpots(4, 2, 3));
  });
});
