/**
 * Dimensionamento delle lamelle. Funzioni pure, in unità SI dove non indicato (mm nei nomi).
 *
 * Tre criteri (vedi la specifica):
 *  - termico continuo: t·(w+t) = I²·ρ / (2·w·h·ΔT), con scambio di calore da entrambe le facce
 *    e dai bordi verso l'aria (h = coefficiente di scambio);
 *  - picco adiabatico: A_min = I_picco·√(ρ·t_imp / (c_v·ΔT)), senza smaltimento di calore;
 *  - punti di saldatura: n = ceil((I/P) / I_per_punto), per ogni terminale.
 */

const MM = 1e-3;

/** Coefficienti di scambio termico verso l'aria, W/(m²·K). */
export const COOLING = {
  free: { label: 'aria libera', h: 10 },
  ventilated: { label: 'ventilato', h: 25 },
  enclosed: { label: 'chiuso (nel contenitore)', h: 5 },
} as const;
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
  // pari: reticolo simmetrico senza punto al centro (coppie opposte); dispari: punto al centro
  const phases: Phase[] = count % 2 === 0 ? [[0.5, 0], [0.5, 0.5], [0, 0]] : [[0, 0], [0.5, 0], [0.5, 0.5]];
  for (const phase of phases) {
    const pts = latticePoints(usable, spacingMm, phase).sort(
      (a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y) || a.y - b.y || a.x - b.x,
    );
    if (pts.length < count) continue;
    const key = (p: { x: number; y: number }) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
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
    if (out.length === count) return out.map((p) => ({ x: p.x + 0, y: p.y + 0 }));
  }
  return [];
}
