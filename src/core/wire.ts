/**
 * Fili AWG per i collegamenti del BMS: diametro del rame e ingombro con la guaina (valori tipici, arrotondati).
 * Servono per i fori delle linguette e per la profondità delle scanalature nel portacelle.
 */
export interface Awg {
  awg: number;
  /** Diametro del conduttore, mm. */
  copperMm: number;
  /** Diametro esterno con la guaina, mm. */
  outerMm: number;
}

export const AWG_TABLE: readonly Awg[] = [
  { awg: 28, copperMm: 0.32, outerMm: 0.65 },
  { awg: 26, copperMm: 0.41, outerMm: 0.8 },
  { awg: 24, copperMm: 0.51, outerMm: 1.0 },
  { awg: 22, copperMm: 0.64, outerMm: 1.3 },
  { awg: 20, copperMm: 0.81, outerMm: 1.5 },
  { awg: 18, copperMm: 1.02, outerMm: 1.9 },
  { awg: 16, copperMm: 1.29, outerMm: 2.3 },
  { awg: 14, copperMm: 1.63, outerMm: 2.9 },
  { awg: 12, copperMm: 2.05, outerMm: 3.6 },
  { awg: 10, copperMm: 2.59, outerMm: 4.4 },
  { awg: 8, copperMm: 3.26, outerMm: 6.0 },
];

export const BALANCE_AWGS: readonly number[] = [28, 26, 24, 22, 20];
export const POWER_AWGS: readonly number[] = [16, 14, 12, 10, 8];

export const findAwg = (awg: number): Awg => AWG_TABLE.find((a) => a.awg === awg) ?? AWG_TABLE[1]!;

/** Foro per far passare e saldare un filo: il conduttore più un po’ di gioco. */
export const holeForWireMm = (awg: number): number => Math.round((findAwg(awg).copperMm + 0.8) * 100) / 100;
