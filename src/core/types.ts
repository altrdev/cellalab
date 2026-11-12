/**
 * CellaLab data model.
 *
 * Units: millimetres. Origin at the top left, y axis down (like the canvas).
 * The GEOMETRY (position, polarity) is separate from the ELECTRICAL TOPOLOGY (group):
 * `group` is the index of the parallel group; the groups are in series in index order.
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
  /** Maximum continuous discharge current per cell. */
  maxDischargeA: number;
  weightG: number;
  priceEur?: number;
  /** Generic catalogue values: to be checked on the datasheet of the real cell. */
  generic?: boolean;
}

/** Size of a BMS (board with components), mm. */
export interface BmsSize {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
}

/** Where the BMS sits relative to the pack: on the flank on the tab side (at mid height) or outside, only as the wire exit point. */
export type BmsConnectorPlace = 'top' | 'end';

export type BmsPlace = 'flank' | 'head';

export interface BmsMount {
  mode: 'pack' | 'external';
  /** On the pack: on the flank on the tab side (at mid height) or at the head, beyond one end of the flank, with the wires coming along the flank. */
  place: BmsPlace;
  /** Position along the exit side: 0 = one end, 1 = the other. */
  along: number;
  /** Where the wires arrive on the BMS: on the top face (pad or connector: the wires go around an end) or on a connector beyond the end. Only with the BMS on the pack and known dimensions. */
  connector: BmsConnectorPlace;
  /** From which end the wires arrive: 'start' = start of the side (`along` 0), 'end' = end. At the head: the pack end where the BMS sits. */
  connectorEnd: 'start' | 'end';
  /** Slack on each wire (soldering and crimping the connector), mm. */
  slackMm: number;
  /** External only: length of wire beyond the exit point, mm. */
  tailMm: number;
}

export const DEFAULT_BMS_MOUNT: BmsMount = { mode: 'pack', place: 'flank', along: 0.5, connector: 'top', connectorEnd: 'start', slackMm: 20, tailMm: 100 };

/** BMS: how many cells in series it handles, how much continuous current and with which chemistry. */
export interface BmsType {
  id: string;
  name: string;
  /** Supported series count: minimum and maximum (equal for a fixed-S BMS). */
  minSeries: number;
  maxSeries: number;
  /** Maximum continuous discharge current, A. */
  maxCurrentA: number;
  chemistries: Chemistry[];
  /** Has the input for the temperature sensor (NTC). */
  ntc: boolean;
  /** Dimensions, if known (for the generic ones it is an estimate per class). */
  sizeMm?: BmsSize;
  /** Generic catalogue values: to be checked on the datasheet of the real BMS. */
  generic?: boolean;
}

export interface PlacedCell {
  id: string;
  typeId: string;
  /** Cell centre, in mm. */
  x: number;
  y: number;
  /** true = positive pole facing up (the "top" face). */
  plusUp: boolean;
  /** Parallel group index (0-based), null if not yet assigned. */
  group: number | null;
}

/** How the pack was generated: used to adapt the cells when the pitch or layout changes. */
export interface PackGenerator {
  series: number;
  parallel: number;
  kind: 'hex' | 'square';
  /** Space between the cells, mm. */
  gapMm: number;
  /** Centre-to-centre distance used by the lattice, mm. */
  pitchMm: number;
  typeId: string;
}

export interface Project {
  version: 1;
  name: string;
  /** User-defined cell types, in addition to the default catalogue. */
  customCellTypes: CellType[];
  /** User-defined BMS, in addition to the default catalogue. */
  customBmsTypes?: BmsType[];
  /** BMS chosen for the pack (catalogue or custom); absent = no BMS. */
  bmsId?: string;
  /** BMS mounting position; absent = the default. */
  bmsMount?: BmsMount;
  cells: PlacedCell[];
  /** Present only if the pack was generated automatically and the cells are still on its lattice. */
  generator?: PackGenerator;
  /** Continuous current limit of the pack (BMS or intended use), A; absent = only the cells' limit. */
  currentLimitA?: number;
}
