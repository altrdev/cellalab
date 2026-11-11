/**
 * Modello dati di CellaLab.
 *
 * Unità: millimetri. Origine in alto a sinistra, asse y verso il basso (come il canvas).
 * La GEOMETRIA (posizione, polarità) è separata dalla TOPOLOGIA ELETTRICA (gruppo):
 * `group` è l'indice del gruppo in parallelo; i gruppi sono in serie in ordine di indice.
 */

export type Chemistry = 'li-ion' | 'lifepo4';

export interface CellType {
  id: string;
  name: string;
  chemistry: Chemistry;
  diameterMm: number;
  heightMm: number;
  nominalV: number;
  maxV: number;
  minV: number;
  capacityAh: number;
  /** Corrente massima di scarica continua per cella. */
  maxDischargeA: number;
  weightG: number;
  priceEur?: number;
  /** Valori generici del catalogo: da verificare sulla scheda tecnica della cella reale. */
  generic?: boolean;
}

export interface PlacedCell {
  id: string;
  typeId: string;
  /** Centro della cella, in mm. */
  x: number;
  y: number;
  /** true = polo positivo rivolto verso l'alto (faccia "sopra"). */
  plusUp: boolean;
  /** Indice del gruppo parallelo (0-based), null se non ancora assegnata. */
  group: number | null;
}

/** Come è stato generato il pacco: serve per adeguare le celle quando si cambia passo o disposizione. */
export interface PackGenerator {
  series: number;
  parallel: number;
  kind: 'hex' | 'square';
  /** Spazio tra le celle, mm. */
  gapMm: number;
  /** Distanza centro-centro usata dal reticolo, mm. */
  pitchMm: number;
  typeId: string;
}

export interface Project {
  version: 1;
  name: string;
  /** Tipi di cella definiti dall'utente, oltre al catalogo predefinito. */
  customCellTypes: CellType[];
  cells: PlacedCell[];
  /** Presente solo se il pacco è stato generato in automatico e le celle sono ancora sul suo reticolo. */
  generator?: PackGenerator;
  /** Limite di corrente continua del pacco (BMS o uso previsto), A; assente = solo il limite delle celle. */
  currentLimitA?: number;
}
