/**
 * Dimensionamento delle lamelle. Funzioni pure, in unità SI dove non indicato (mm nei nomi).
 *
 * Tre criteri (vedi la specifica):
 *  - termico continuo: t·(w+t) = I²·ρ / (2·w·h·ΔT), con scambio di calore da entrambe le facce
 *    e dai bordi verso l'aria (h = coefficiente di scambio);
 *  - picco adiabatico: A_min = I_picco·√(ρ·t_imp / (c_v·ΔT)), senza smaltimento di calore;
 *  - punti di saldatura: n = ceil((I/P) / I_per_punto), per ogni terminale.
 */

import { t } from '../i18n';

const MM = 1e-3;

/** Coefficienti di scambio termico verso l'aria, W/(m²·K). */
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
  /** Aumento di temperatura ammesso rispetto all'ambiente, K. */
  deltaTK: number;
  hWm2K: number;
}

/** Spessore minimo (mm) che tiene l'aumento di temperatura entro ΔT, per una lamella larga `widthMm`. */
export function minThicknessThermalMm(widthMm: number, i: ThermalInput): number {
  if (!(widthMm > 0) || !(i.currentA > 0)) return 0;
  const w = widthMm * MM;
  const k = (i.currentA * i.currentA * i.resistivityOhmM) / (2 * w * i.hWm2K * i.deltaTK);
  // t² + w·t − k = 0
  return ((-w + Math.sqrt(w * w + 4 * k)) / 2) / MM;
}

export interface ConductionInput extends ThermalInput {
  /** Lunghezza libera della banda tra i due appoggi saldati sulle celle, mm. */
  lengthMm: number;
  /** Conducibilità termica del materiale, W/(m·K). */
  conductivityWmK: number;
  /** Aumento di temperatura delle estremità (le celle) rispetto all'ambiente, K. */
  endDeltaK: number;
}

/**
 * Aumento di temperatura (K, rispetto all'ambiente) al centro di una banda lunga `lengthMm` con le estremità
 * saldate alle celle, che stanno a `endDeltaK`. È il modello della «aletta» con generazione di calore:
 * θ(x) = θp + (θe − θp)·cosh(m·(x − L/2)) / cosh(m·L/2), con θp il valore della banda infinita (aria libera)
 * e m = √(h·P/(k·A)). Per L → ∞ torna a `steadyDeltaTK`.
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

/** Spessore massimo che si prova nel calcolo con conduzione, mm. */
const MAX_SEARCH_MM = 20;

/**
 * Spessore minimo (mm) per cui la banda, con le estremità sulle celle, resta entro ΔT. Le estremità non vengono
 * considerate più calde dell'80% di ΔT, altrimenti non ci sarebbe soluzione. Se anche `MAX_SEARCH_MM` non basta
 * restituisce `MAX_SEARCH_MM`.
 */
export function minThicknessConductionMm(widthMm: number, i: ConductionInput): number {
  if (!(widthMm > 0) || !(i.currentA > 0)) return 0;
  const inp = { ...i, endDeltaK: Math.max(0, Math.min(i.endDeltaK, 0.8 * i.deltaTK)) };
  const ok = (t: number) => conductionDeltaTK(widthMm, t, inp) <= i.deltaTK;
  // cerca a passi geometrici il primo spessore che va bene, poi affina con la bisezione
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

/** Larghezza minima (mm) per uno spessore dato, con lo stesso criterio. */
export function minWidthThermalMm(thicknessMm: number, i: ThermalInput): number {
  if (!(thicknessMm > 0) || !(i.currentA > 0)) return 0;
  const t = thicknessMm * MM;
  const k = (i.currentA * i.currentA * i.resistivityOhmM) / (2 * i.hWm2K * i.deltaTK);
  // t·w² + t²·w − k = 0
  return ((-t * t + Math.sqrt(t ** 4 + 4 * t * k)) / (2 * t)) / MM;
}

/** Aumento di temperatura a regime (K) di una lamella larga `widthMm` e spessa `thicknessMm`. */
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
  /** Capacità termica volumetrica, J/(m³·K). */
  volumetricHeatJm3K: number;
  durationS: number;
  deltaTK: number;
}

/** Sezione minima (mm²) per assorbire un picco di corrente senza scambio di calore. */
export function minAreaPeakMm2(i: PeakInput): number {
  if (!(i.peakCurrentA > 0)) return 0;
  const a = i.peakCurrentA * Math.sqrt((i.resistivityOhmM * i.durationS) / (i.volumetricHeatJm3K * i.deltaTK));
  return a / (MM * MM);
}

/** Punti di saldatura necessari su un terminale che porta `cellCurrentA`. */
export function spotsNeeded(cellCurrentA: number, spotCurrentA: number, minSpots: number): number {
  if (!(spotCurrentA > 0)) return Infinity;
  return Math.max(minSpots, Math.ceil(cellCurrentA / spotCurrentA - 1e-9));
}

type Phase = readonly [number, number];
/** Disposizioni del reticolo: punto al centro, due punti affiancati, quattro punti a quadrato. */
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
 * Quanti punti entrano in un'area di contatto circolare di raggio `radiusMm`: reticolo con passo
 * `spacingMm`, punti interamente dentro il cerchio. Prova due fasi del reticolo e prende la migliore.
 */
export function spotCapacity(radiusMm: number, spotDiameterMm: number, spacingMm: number): number {
  const usable = radiusMm - spotDiameterMm / 2;
  if (usable < 0 || !(spacingMm > 0)) return 0;
  return Math.max(...PHASES.map((ph) => latticePoints(usable, spacingMm, ph).length));
}

/** Raggio minimo del contatto (mm) in cui entrano `count` punti; Infinity se non bastano 40 mm. */
export function minRadiusForSpots(count: number, spotDiameterMm: number, spacingMm: number): number {
  for (let r = spotDiameterMm / 2; r <= 40; r += 0.02) {
    if (spotCapacity(r, spotDiameterMm, spacingMm) >= count) return Math.round(r * 100) / 100;
  }
  return Infinity;
}

/**
 * Dove mettere `count` punti dentro il contatto: i più vicini al centro, a coppie opposte così da
 * restare bilanciati. Posizioni relative al centro della cella, mm. Vuoto se non ci stanno.
 */
export function spotPositions(
  radiusMm: number,
  spotDiameterMm: number,
  spacingMm: number,
  count: number,
): { x: number; y: number }[] {
  const usable = radiusMm - spotDiameterMm / 2;
  if (count <= 0 || usable < 0 || !(spacingMm > 0)) return [];
  // Si prova ogni fase del reticolo (punto al centro, due affiancati, quadrato) e si tiene la disposizione più
  // compatta: così 4 punti sono un quadrato 2×2 e 6 un rettangolo 2×3, non un parallelogramma sfalsato.
  const phases: Phase[] = count % 2 === 0 ? [[0.5, 0.5], [0.5, 0], [0, 0]] : [[0, 0], [0.5, 0], [0.5, 0.5]];
  const key = (p: { x: number; y: number }) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
  let best: { x: number; y: number }[] | null = null;
  let bestReach = Infinity;
  for (const phase of phases) {
    const pts = latticePoints(usable, spacingMm, phase).sort(
      (a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y) || a.y - b.y || a.x - b.x,
    );
    if (pts.length < count) continue;
    // si prendono i più vicini al centro, a coppie opposte così da restare bilanciati
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
    // con un numero pari il punto al centro rende la disposizione asimmetrica: solo se non c'è altro modo
    if (count % 2 === 0 && phase[0] === 0 && phase[1] === 0) reach += 1000;
    if (reach < bestReach - 1e-9) {
      best = out;
      bestReach = reach;
    }
  }
  if (best) return best.map((p) => ({ x: p.x + 0, y: p.y + 0 }));
  return [];
}
