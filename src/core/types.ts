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

/** Ingombro di un BMS (scheda con i componenti), mm. */
export interface BmsSize {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
}

/** Dove sta il BMS rispetto al pacco: sul fianco dal lato delle linguette (a metà altezza) o fuori, solo come punto di uscita dei fili. */
export type BmsConnectorPlace = 'top' | 'end';

export type BmsPlace = 'flank' | 'head';

export interface BmsMount {
  mode: 'pack' | 'external';
  /** Sul pacco: sul fianco dal lato delle linguette (a metà altezza) o in testa, oltre un'estremità del fianco, con i fili che arrivano lungo il fianco. */
  place: BmsPlace;
  /** Posizione lungo il lato di uscita: 0 = un'estremità, 1 = l'altra. */
  along: number;
  /** Dove arrivano i fili sul BMS: sulla faccia superiore (pad o connettore: i fili girano attorno a una testata) o su un connettore oltre la testata. Solo con il BMS sul pacco e l'ingombro noto. */
  connector: BmsConnectorPlace;
  /** Da quale testata arrivano i fili: 'start' = inizio del lato (`along` 0), 'end' = fine. In testa: l'estremità del pacco dove sta il BMS. */
  connectorEnd: 'start' | 'end';
  /** Scorta su ogni filo (saldatura e crimpatura del connettore), mm. */
  slackMm: number;
  /** Solo esterno: lunghezza di filo oltre il punto di uscita, mm. */
  tailMm: number;
}

export const DEFAULT_BMS_MOUNT: BmsMount = { mode: 'pack', place: 'flank', along: 0.5, connector: 'top', connectorEnd: 'start', slackMm: 20, tailMm: 100 };

/** BMS: quante celle in serie regge, quanta corrente continua e con quale chimica. */
export interface BmsType {
  id: string;
  name: string;
  /** Numero di serie supportato: minimo e massimo (uguali per un BMS a S fissa). */
  minSeries: number;
  maxSeries: number;
  /** Corrente continua massima di scarica, A. */
  maxCurrentA: number;
  chemistries: Chemistry[];
  /** Ha l'ingresso per il sensore di temperatura (NTC). */
  ntc: boolean;
  /** Ingombro, se noto (nei generici è una stima per classe). */
  sizeMm?: BmsSize;
  /** Valori generici del catalogo: da verificare sulla scheda tecnica del BMS reale. */
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
  /** BMS definiti dall'utente, oltre al catalogo predefinito. */
  customBmsTypes?: BmsType[];
  /** BMS scelto per il pacco (catalogo o personalizzato); assente = nessun BMS. */
  bmsId?: string;
  /** Posizione di montaggio del BMS; assente = quella di default. */
  bmsMount?: BmsMount;
  cells: PlacedCell[];
  /** Presente solo se il pacco è stato generato in automatico e le celle sono ancora sul suo reticolo. */
  generator?: PackGenerator;
  /** Limite di corrente continua del pacco (BMS o uso previsto), A; assente = solo il limite delle celle. */
  currentLimitA?: number;
}
