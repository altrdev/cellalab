/**
 * Strip sizing. Pure functions, in SI units unless stated (mm in the names).
 *
 * Three criteria (see the specification):
 *  - continuous thermal: t·(w+t) = I²·ρ / (2·w·h·ΔT), with heat exchange from both faces
 *    and from the edges to the air (h = exchange coefficient);
 *  - adiabatic peak: A_min = I_peak·√(ρ·t_pulse / (c_v·ΔT)), with no heat dissipation;
 *  - weld spots: n = ceil((I/P) / I_per_spot), for each terminal.
 */

import { t } from '../i18n';

const MM = 1e-3;

/** Heat exchange coefficients towards the air, W/(m²·K). */
export const COOLING = {
  free: {
    get label() {
      return t('cooling.free');
    },
    h: 10,
  },
  ventilated: {
    get label() {
      return t('cooling.ventilated');
    },
    h: 25,
  },
  enclosed: {
    get label() {
      return t('cooling.enclosed');
    },
    h: 5,
  },
};
export type CoolingId = keyof typeof COOLING;

export interface ThermalInput {
  currentA: number;
  resistivityOhmM: number;
  /** Allowed temperature rise above ambient, K. */
  deltaTK: number;
  hWm2K: number;
}

/** Minimum thickness (mm) that keeps the temperature rise within ΔT, for a strip `widthMm` wide. */
export function minThicknessThermalMm(widthMm: number, i: ThermalInput): number {
  if (!(widthMm > 0) || !(i.currentA > 0)) return 0;
  const w = widthMm * MM;
  const k = (i.currentA * i.currentA * i.resistivityOhmM) / (2 * w * i.hWm2K * i.deltaTK);
  // t² + w·t − k = 0
  return ((-w + Math.sqrt(w * w + 4 * k)) / 2) / MM;
}

export interface ConductionInput extends ThermalInput {
  /** Free length of the band between the two welded supports on the cells, mm. */
  lengthMm: number;
  /** Thermal conductivity of the material, W/(m·K). */
  conductivityWmK: number;
  /** Temperature rise of the ends (the cells) above ambient, K. */
  endDeltaK: number;
}

/**
 * Temperature rise (K, above ambient) at the middle of a band `lengthMm` long with the ends
 * welded to the cells, which are at `endDeltaK`. It is the "fin" model with heat generation:
 * θ(x) = θp + (θe − θp)·cosh(m·(x − L/2)) / cosh(m·L/2), with θp the value of the infinite band (free air)
 * and m = √(h·P/(k·A)). For L → ∞ it goes back to `steadyDeltaTK`.
 */
export function conductionDeltaTK(widthMm: number, thicknessMm: number, i: ConductionInput): number {
  if (!(widthMm > 0) || !(thicknessMm > 0)) return Infinity;
  const w = widthMm * MM;
  const t = thicknessMm * MM;
  const A = w * t;
  const P = 2 * (w + t);
  const thetaP = (i.currentA * i.currentA * i.resistivityOhmM) / (i.hWm2K * P * A);
  const m = Math.sqrt((i.hWm2K * P) / (i.conductivityWmK * A));
  const c = Math.cosh((m * i.lengthMm * MM) / 2);
  return thetaP + (i.endDeltaK - thetaP) / c;
}

/** Maximum thickness tried in the calculation with conduction, mm. */
const MAX_SEARCH_MM = 20;

/**
 * Minimum thickness (mm) for which the band, with its ends on the cells, stays within ΔT. The ends are not
 * considered hotter than 80% of ΔT, otherwise there would be no solution. If even `MAX_SEARCH_MM` is not enough
 * restituisce `MAX_SEARCH_MM`.
 */
export function minThicknessConductionMm(widthMm: number, i: ConductionInput): number {
  if (!(widthMm > 0) || !(i.currentA > 0)) return 0;
  const inp = { ...i, endDeltaK: Math.max(0, Math.min(i.endDeltaK, 0.8 * i.deltaTK)) };
  const ok = (t: number) => conductionDeltaTK(widthMm, t, inp) <= i.deltaTK;
  // search in geometric steps for the first thickness that works, then refine with bisection
  let lo = 0.005;
  if (ok(lo)) return lo;
  let hi = lo;
  while (hi < MAX_SEARCH_MM) {
    lo = hi;
    hi *= 1.05;
    if (ok(hi)) {
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
  }
  return MAX_SEARCH_MM;
}

/** Steady-state temperature rise (K) of a strip `widthMm` wide and `thicknessMm` thick. */
export function steadyDeltaTK(
  widthMm: number,
  thicknessMm: number,
  currentA: number,
  resistivityOhmM: number,
  hWm2K: number,
): number {
  if (!(widthMm > 0) || !(thicknessMm > 0)) return Infinity;
  const w = widthMm * MM;
  const t = thicknessMm * MM;
  return (currentA * currentA * resistivityOhmM) / (2 * hWm2K * w * t * (w + t));
}

export interface PeakInput {
  peakCurrentA: number;
  resistivityOhmM: number;
  /** Volumetric heat capacity, J/(m³·K). */
  volumetricHeatJm3K: number;
  durationS: number;
  deltaTK: number;
}

/** Minimum section (mm²) to absorb a current peak with no heat exchange. */
export function minAreaPeakMm2(i: PeakInput): number {
  if (!(i.peakCurrentA > 0)) return 0;
  const a = i.peakCurrentA * Math.sqrt((i.resistivityOhmM * i.durationS) / (i.volumetricHeatJm3K * i.deltaTK));
  return a / (MM * MM);
}

/** Weld spots needed on a terminal carrying `cellCurrentA`. */
export function spotsNeeded(cellCurrentA: number, spotCurrentA: number, minSpots: number): number {
  if (!(spotCurrentA > 0)) return Infinity;
  return Math.max(minSpots, Math.ceil(cellCurrentA / spotCurrentA - 1e-9));
}

type Phase = readonly [number, number];
/** Lattice layouts: one spot in the centre, two side by side, four in a square. */
const PHASES: Phase[] = [[0, 0], [0.5, 0], [0.5, 0.5]];

function latticePoints(usable: number, spacingMm: number, phase: Phase): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const range = Math.ceil(usable / spacingMm) + 1;
  for (let ix = -range; ix <= range; ix++) {
    for (let iy = -range; iy <= range; iy++) {
      const x = (ix + phase[0]) * spacingMm;
      const y = (iy + phase[1]) * spacingMm;
      if (x * x + y * y <= usable * usable + 1e-9) out.push({ x, y });
    }
  }
  return out;
}

/**
 * How many spots fit in a circular contact area of radius `radiusMm`: lattice with pitch
 * `spacingMm`, spots entirely inside the circle. Tries two lattice phases and takes the better.
 */
export function spotCapacity(radiusMm: number, spotDiameterMm: number, spacingMm: number): number {
  const usable = radiusMm - spotDiameterMm / 2;
  if (usable < 0 || !(spacingMm > 0)) return 0;
  return Math.max(...PHASES.map((ph) => latticePoints(usable, spacingMm, ph).length));
}

/** Minimum contact radius (mm) in which `count` spots fit; Infinity if 40 mm is not enough. */
export function minRadiusForSpots(count: number, spotDiameterMm: number, spacingMm: number): number {
  for (let r = spotDiameterMm / 2; r <= 40; r += 0.02) {
    if (spotCapacity(r, spotDiameterMm, spacingMm) >= count) return Math.round(r * 100) / 100;
  }
  return Infinity;
}

/**
 * Where to put `count` spots inside the contact: the closest to the centre, in opposite pairs so as to
 * stay balanced. Positions relative to the cell centre, mm. Empty if they do not fit.
 */
export function spotPositions(
  radiusMm: number,
  spotDiameterMm: number,
  spacingMm: number,
  count: number,
): { x: number; y: number }[] {
  const usable = radiusMm - spotDiameterMm / 2;
  if (count <= 0 || usable < 0 || !(spacingMm > 0)) return [];
  // Every lattice phase is tried (spot in the centre, two side by side, square) and the most compact layout
  // is kept: so 4 spots are a 2×2 square and 6 a 2×3 rectangle, not an offset parallelogram.
  const phases: Phase[] = count % 2 === 0 ? [[0.5, 0.5], [0.5, 0], [0, 0]] : [[0, 0], [0.5, 0], [0.5, 0.5]];
  const key = (p: { x: number; y: number }) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
  let best: { x: number; y: number }[] | null = null;
  let bestReach = Infinity;
  for (const phase of phases) {
    const pts = latticePoints(usable, spacingMm, phase).sort(
      (a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y) || a.y - b.y || a.x - b.x,
    );
    if (pts.length < count) continue;
    // take the closest to the centre, in opposite pairs so as to stay balanced
    const used = new Set<string>();
    const out: { x: number; y: number }[] = [];
    for (const p of pts) {
      if (out.length >= count) break;
      if (used.has(key(p))) continue;
      used.add(key(p));
      out.push(p);
      const opp = { x: -p.x + 0, y: -p.y + 0 };
      if (out.length < count && !used.has(key(opp)) && pts.some((q) => key(q) === key(opp))) {
        used.add(key(opp));
        out.push(opp);
      }
    }
    if (out.length !== count) continue;
    let reach = Math.max(...out.map((p) => Math.hypot(p.x, p.y)));
    // with an even number the centre spot makes the layout asymmetric: only if there is no other way
    if (count % 2 === 0 && phase[0] === 0 && phase[1] === 0) reach += 1000;
    if (reach < bestReach - 1e-9) {
      best = out;
      bestReach = reach;
    }
  }
  if (best) return best.map((p) => ({ x: p.x + 0, y: p.y + 0 }));
  return [];
}
