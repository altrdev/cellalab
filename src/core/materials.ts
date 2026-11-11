/**
 * Catalogo dei materiali per le lamelle (strisce che collegano i poli delle celle).
 *
 * I valori sono TIPICI da letteratura, non garantiti: la lega reale del fornitore può differire
 * di parecchio (soprattutto resistività dell'acciaio nichelato e dell'ottone). Verifica sempre
 * la scheda tecnica di ciò che compri.
 */

/** Quanto è facile saldare a punti il materiale con una saldatrice hobby. */
export type Weldability = 'good' | 'fair' | 'poor';

export interface LamellaMaterial {
  id: string;
  name: string;
  /** Resistività a 20 °C, Ω·m. */
  resistivityOhmM: number;
  densityKgM3: number;
  /** Calore specifico, J/(kg·K). */
  specificHeatJKgK: number;
  /** Coefficiente di temperatura della resistività, 1/K. */
  tempCoeffPerK: number;
  weldability: Weldability;
  /** Spessori commerciali tipici in mm, in ordine crescente. */
  thicknessesMm: number[];
  note: string;
  /** Colore con cui si disegna la lamella (2D e 3D). */
  colorHex: string;
}

export const LAMELLA_MATERIALS: readonly LamellaMaterial[] = [
  {
    id: 'nichel-puro',
    colorHex: '#c4c7ca',
    name: 'Nichel puro (Ni 99,6%)',
    resistivityOhmM: 9.5e-8,
    densityKgM3: 8890,
    specificHeatJKgK: 456,
    tempCoeffPerK: 0.006,
    weldability: 'good',
    thicknessesMm: [0.1, 0.15, 0.2, 0.3],
    note: 'Il riferimento per le saldature a punti: si salda facilmente e non si ossida. Resistivo: per correnti alte servono più strati o rame.',
  },
  {
    id: 'acciaio-nichelato',
    colorHex: '#8f959b',
    name: 'Acciaio nichelato',
    resistivityOhmM: 1.5e-7,
    densityKgM3: 7850,
    specificHeatJKgK: 490,
    tempCoeffPerK: 0.005,
    weldability: 'good',
    thicknessesMm: [0.1, 0.15, 0.2],
    note: 'Economico e facile da saldare, ma più resistivo del nichel puro (circa +60%): scalda di più a pari corrente.',
  },
  {
    id: 'rame-nichelato',
    colorHex: '#c9b8a6',
    name: 'Rame nichelato',
    resistivityOhmM: 1.75e-8,
    densityKgM3: 8960,
    specificHeatJKgK: 385,
    tempCoeffPerK: 0.0039,
    weldability: 'fair',
    thicknessesMm: [0.1, 0.15, 0.2, 0.3],
    note: 'Conduce molto meglio del nichel, ma richiede più energia per la saldatura a punti: serve una saldatrice potente.',
  },
  {
    id: 'rame',
    colorHex: '#c97b45',
    name: 'Rame (Cu-ETP)',
    resistivityOhmM: 1.72e-8,
    densityKgM3: 8960,
    specificHeatJKgK: 385,
    tempCoeffPerK: 0.0039,
    weldability: 'poor',
    thicknessesMm: [0.1, 0.2, 0.3, 0.5, 1.0],
    note: 'Ottimo conduttore, ma con una saldatrice a punti hobby di norma non si salda (riflette e disperde il calore): si usa saldato a stagno o con linguette di nichel.',
  },
  {
    id: 'ottone',
    colorHex: '#cfae4d',
    name: 'Ottone (CuZn37)',
    resistivityOhmM: 6.6e-8,
    densityKgM3: 8500,
    specificHeatJKgK: 380,
    tempCoeffPerK: 0.0015,
    weldability: 'poor',
    thicknessesMm: [0.1, 0.2, 0.3, 0.5],
    note: 'Si salda male a punti; di solito si salda a stagno.',
  },
  {
    id: 'alluminio',
    colorHex: '#d3d7da',
    name: 'Alluminio (1050)',
    resistivityOhmM: 2.82e-8,
    densityKgM3: 2700,
    specificHeatJKgK: 900,
    tempCoeffPerK: 0.0043,
    weldability: 'poor',
    thicknessesMm: [0.2, 0.3, 0.5, 1.0],
    note: 'Non si salda a punti in modo affidabile: richiede ultrasuoni o bonding. Poco adatto a un laboratorio domestico.',
  },
];

export function findMaterial(id: string): LamellaMaterial | undefined {
  return LAMELLA_MATERIALS.find((m) => m.id === id);
}

/** Resistività alla temperatura `tempC` (modello lineare). */
export function resistivityAt(m: LamellaMaterial, tempC: number): number {
  return m.resistivityOhmM * (1 + m.tempCoeffPerK * (tempC - 20));
}

/** Capacità termica volumetrica, J/(m³·K). */
export function volumetricHeat(m: LamellaMaterial): number {
  return m.densityKgM3 * m.specificHeatJKgK;
}
