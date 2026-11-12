/**
 * AWG wires for the BMS connections: copper diameter and size with insulation (typical values, rounded).
 * Used for the tab holes and for the depth of the grooves in the holder.
 */
export interface Awg {
  awg: number;
  /** Conductor diameter, mm. */
  copperMm: number;
  /** Outer diameter with insulation, mm. */
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

/**
 * Cautious continuous ampacity of the power cable (A), for a short cable inside a closed pack: the 60-degree insulation column of the
 * ampacity tables (no temperature derating), rounded down. They are guide values, not a calculation.
 */
export const POWER_AMPACITY_A: Readonly<Record<number, number>> = { 16: 10, 14: 15, 12: 20, 10: 30, 8: 40 };

/** Ampacity of the chosen AWG cable, A; 0 if it is not a power gauge. */
export const powerAmpacityA = (awg: number): number => POWER_AMPACITY_A[awg] ?? 0;

/** The thinnest gauge (highest AWG) that carries `currentA`, or null if not even the thickest is enough. */
export function powerAwgFor(currentA: number): number | null {
  const sorted = [...POWER_AWGS].sort((a, b) => b - a); // from the thinnest to the thickest
  return sorted.find((awg) => powerAmpacityA(awg) >= currentA) ?? null;
}

export const BALANCE_AWGS: readonly number[] = [28, 26, 24, 22, 20];
export const POWER_AWGS: readonly number[] = [16, 14, 12, 10, 8];

export const findAwg = (awg: number): Awg => AWG_TABLE.find((a) => a.awg === awg) ?? AWG_TABLE[1]!;

/** Hole to pass and solder a wire: the conductor plus a little clearance. */
export const holeForWireMm = (awg: number): number => Math.round((findAwg(awg).copperMm + 0.8) * 100) / 100;
