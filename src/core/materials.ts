import { t } from '../i18n';

/**
 * Catalogue of strip materials (strips that connect the cell poles).
 *
 * The values are TYPICAL from the literature, not guaranteed: the supplier's real alloy may differ
 * quite a lot (especially the resistivity of nickel-plated steel and brass). Always check
 * the datasheet of what you buy.
 */

/** How easy it is to spot-weld the material with a hobby welder. */
export type Weldability = 'good' | 'fair' | 'poor';

export interface LamellaMaterial {
  id: string;
  name: string;
  /** Resistivity at 20 °C, Ω·m. */
  resistivityOhmM: number;
  densityKgM3: number;
  /** Calore specifico, J/(kg·K). */
  specificHeatJKgK: number;
  /** Temperature coefficient of resistivity, 1/K. */
  tempCoeffPerK: number;
  /** Thermal conductivity, W/(m·K): the heat the strip carries towards the cells. */
  conductivityWmK: number;
  weldability: Weldability;
  /** Spessori commerciali tipici in mm, in ordine crescente. */
  thicknessesMm: number[];
  note: string;
  /** Colour used to draw the strip (2D and 3D). */
  colorHex: string;
}

export const LAMELLA_MATERIALS: readonly LamellaMaterial[] = [
  {
    id: 'nichel-puro',
    colorHex: '#c4c7ca',
    get name() {
      return t('material.nichel-puro.name');
    },
    resistivityOhmM: 9.5e-8,
    densityKgM3: 8890,
    specificHeatJKgK: 456,
    tempCoeffPerK: 0.006,
    conductivityWmK: 90,
    weldability: 'good',
    thicknessesMm: [0.1, 0.15, 0.2, 0.3],
    get note() {
      return t('material.nichel-puro.note');
    },
  },
  {
    id: 'acciaio-nichelato',
    colorHex: '#8f959b',
    get name() {
      return t('material.acciaio-nichelato.name');
    },
    resistivityOhmM: 1.5e-7,
    densityKgM3: 7850,
    specificHeatJKgK: 490,
    tempCoeffPerK: 0.005,
    conductivityWmK: 50,
    weldability: 'good',
    thicknessesMm: [0.1, 0.15, 0.2],
    get note() {
      return t('material.acciaio-nichelato.note');
    },
  },
  {
    id: 'rame-nichelato',
    colorHex: '#c9b8a6',
    get name() {
      return t('material.rame-nichelato.name');
    },
    resistivityOhmM: 1.75e-8,
    densityKgM3: 8960,
    specificHeatJKgK: 385,
    tempCoeffPerK: 0.0039,
    conductivityWmK: 380,
    weldability: 'fair',
    thicknessesMm: [0.1, 0.15, 0.2, 0.3],
    get note() {
      return t('material.rame-nichelato.note');
    },
  },
  {
    id: 'rame',
    colorHex: '#c97b45',
    get name() {
      return t('material.rame.name');
    },
    resistivityOhmM: 1.72e-8,
    densityKgM3: 8960,
    specificHeatJKgK: 385,
    tempCoeffPerK: 0.0039,
    conductivityWmK: 390,
    weldability: 'poor',
    thicknessesMm: [0.1, 0.2, 0.3, 0.5, 1.0],
    get note() {
      return t('material.rame.note');
    },
  },
  {
    id: 'ottone',
    colorHex: '#cfae4d',
    get name() {
      return t('material.ottone.name');
    },
    resistivityOhmM: 6.6e-8,
    densityKgM3: 8500,
    specificHeatJKgK: 380,
    tempCoeffPerK: 0.0015,
    conductivityWmK: 120,
    weldability: 'poor',
    thicknessesMm: [0.1, 0.2, 0.3, 0.5],
    get note() {
      return t('material.ottone.note');
    },
  },
  {
    id: 'alluminio',
    colorHex: '#d3d7da',
    get name() {
      return t('material.alluminio.name');
    },
    resistivityOhmM: 2.82e-8,
    densityKgM3: 2700,
    specificHeatJKgK: 900,
    tempCoeffPerK: 0.0043,
    conductivityWmK: 225,
    weldability: 'poor',
    thicknessesMm: [0.2, 0.3, 0.5, 1.0],
    get note() {
      return t('material.alluminio.note');
    },
  },
];

export function findMaterial(id: string): LamellaMaterial | undefined {
  return LAMELLA_MATERIALS.find((m) => m.id === id);
}

/** Resistivity at temperature `tempC` (linear model). */
export function resistivityAt(m: LamellaMaterial, tempC: number): number {
  return m.resistivityOhmM * (1 + m.tempCoeffPerK * (tempC - 20));
}

/** Volumetric heat capacity, J/(m³·K). */
export function volumetricHeat(m: LamellaMaterial): number {
  return m.densityKgM3 * m.specificHeatJKgK;
}
