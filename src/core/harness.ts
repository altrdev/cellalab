import { findBmsType, bmsOf } from './bms';
import { findCellType } from './catalog';
import type { Pt } from './polygon';
import type { Face, Strip, TabSide } from './strips';
import { DEFAULT_BMS_MOUNT, type BmsMount, type BmsSize, type Project } from './types';

/**
 * Cablaggio del BMS: dove sta il BMS sul fianco del pacco e quanto è lungo ogni filo di bilanciamento.
 *
 * Il BMS (o il punto di uscita del fascio) sta sul fianco dal lato delle linguette, a metà altezza, tra le due piastre.
 * Ogni filo parte dal foro della sua linguetta piegata, scende (o sale) lungo il bordo fino a metà altezza e va al
 * connettore: nessun filo attraversa da una piastra all'altra. Il nodo B0 è il meno del pacco, BS il più.
 *
 * Coordinate della scena: il disegno (x, y) diventa (X, Z), l'altezza è Y.
 */

export interface Pt3 {
  x: number;
  y: number;
  z: number;
}

export interface HarnessWire {
  /** Indice del nodo: B0 = meno del pacco, B{S} = più. */
  node: number;
  label: string;
  /** Lamella e faccia a cui è saldato. */
  stripId: string;
  face: Face;
  /** Percorso: foro della linguetta, piede della discesa, (scavalca il bordo della scatola), connettore. */
  points: Pt3[];
  /** Lunghezza lungo il percorso, mm. */
  lengthMm: number;
  /** Lunghezza da tagliare: percorso più scorta (e coda se esterno), arrotondata a 5 mm per eccesso. */
  cutMm: number;
}

export interface BmsBox {
  center: Pt3;
  /** Dimensioni lungo X, Y, Z della scena, mm. */
  size: Pt3;
}

export interface Harness {
  mount: BmsMount;
  side: TabSide;
  /** Punto del connettore (centro delle prese), mm. */
  connector: Pt3;
  /** La scatola del BMS (solo montato sul pacco e con l'ingombro noto). */
  box: BmsBox | null;
  wires: HarnessWire[];
  totalCutMm: number;
}

/** Passo dei contatti del connettore di bilanciamento (JST-XH), mm. */
export const CONNECTOR_PITCH_MM = 2.5;
/** Distanza tra il fianco delle celle e il fascio, mm. */
const WIRE_CLEARANCE_MM = 1.5;
/** Distanza tra la testata del BMS e il connettore di bilanciamento quando sta oltre la testata, mm. */
const CONNECTOR_END_GAP_MM = 3;
/** Margine tra la testata e il primo pad sulla faccia superiore, mm. */
const TOP_MARGIN_MM = 4;
/** Distanza del filo dal bordo della scatola mentre lo scavalca, mm. */
const EDGE_GAP_MM = 2;
/** Distanza tra due fili in corsie vicine, mm. */
const WIRE_LANE_MM = 1.5;

const DIR: Record<TabSide, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** Di quanto la lamella si appoggia sopra il bordo della cella (il bottone sporge): come nella scena 3D. */
export function busbarLiftMm(project: Project): number {
  let lift = 0;
  for (const c of project.cells) {
    const t = findCellType(project, c.typeId);
    if (t) lift = Math.max(lift, Math.min(1.1, (t.diameterMm / 2) * 0.12));
  }
  return lift;
}

export const bmsMountOf = (project: Project): BmsMount => ({ ...DEFAULT_BMS_MOUNT, ...project.bmsMount });

/**
 * `strips` sono le lamelle con le linguette (una per giunzione); `thicknessMm` è lo spessore della lamella nella scena.
 * Null se non c'è un BMS o nessuna linguetta.
 */
export function buildHarness(project: Project, strips: readonly Strip[], thicknessMm: number): Harness | null {
  const bms = bmsOf(project) ?? (project.bmsId ? findBmsType(project, project.bmsId) : undefined);
  const withTab = strips.filter((s) => s.tab);
  if (!bms || withTab.length === 0 || project.cells.length === 0) return null;
  const mount = bmsMountOf(project);
  const side = withTab[0]!.tab!.side;
  const d = DIR[side];
  const perp = { x: -d.y, y: d.x };

  let height = 0;
  for (const c of project.cells) height = Math.max(height, findCellType(project, c.typeId)?.heightMm ?? 0);
  const lift = busbarLiftMm(project);
  const sheetTop = height + lift + thicknessMm; // faccia sopra: la piega parte da qui e scende
  const sheetBottom = -lift - thicknessMm; // faccia sotto: parte da qui e sale
  const yMid = height / 2;

  // Estremo del fianco lungo la direzione di uscita e tratto occupato lungo il lato.
  let edge = -Infinity;
  let pMin = Infinity;
  let pMax = -Infinity;
  for (const c of project.cells) {
    const r = (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2;
    edge = Math.max(edge, c.x * d.x + c.y * d.y + r);
    const p = c.x * perp.x + c.y * perp.y;
    pMin = Math.min(pMin, p - r);
    pMax = Math.max(pMax, p + r);
  }
  const aWire = edge + WIRE_CLEARANCE_MM;
  const size: BmsSize | undefined = bms.sizeMm;
  const box = mount.mode === 'pack' && size !== undefined;
  const aConn = aWire; // il connettore sta sulla faccia del BMS verso il pacco
  const pc = pMin + mount.along * (pMax - pMin);
  // Con la scatola nota i fili arrivano o sulla faccia superiore (pad o connettore: scavalcano il bordo sopra o sotto la
  // scatola) o a un connettore oltre una testata. Mai dietro: lì c'è la scheda.
  const pins = withTab.length * CONNECTOR_PITCH_MM;
  const sgn = mount.connectorEnd === 'end' ? 1 : -1;
  const boxSize = box ? size : undefined;
  const pEnd = boxSize ? pc + sgn * (boxSize.lengthMm / 2) : pc; // testata scelta, lungo il lato
  const onEnd = !!boxSize && mount.connector === 'end';
  const onTop = !!boxSize && mount.connector === 'top';
  const pConn = onEnd ? pEnd + sgn * (pins / 2 + CONNECTOR_END_GAP_MM) : onTop ? pEnd - sgn * Math.min(boxSize!.lengthMm / 2, pins / 2 + TOP_MARGIN_MM) : pc;
  const aTop = aConn + (boxSize?.thicknessMm ?? 0); // faccia superiore della scheda
  const to3 = (a: number, p: number, y: number): Pt3 => ({ x: d.x * a + perp.x * p, y, z: d.y * a + perp.y * p });

  // Un nodo per giunzione: B0 è l'ultima (meno del pacco).
  const joints = withTab.map((s) => s.joint);
  const last = Math.max(...joints);
  const n = last + 1;
  // Posto del filo tra quelli della stessa faccia, dal nodo più basso: serve a dare una corsia a ciascuno.
  const faceRank = new Map<string, number>();
  for (const face of ['top', 'bottom'] as const) {
    withTab.filter((x) => x.face === face).sort((x, y) => y.joint - x.joint).forEach((x, i) => faceRank.set(x.id, i));
  }
  const wires: HarnessWire[] = withTab
    .map((s): HarnessWire => {
      const tab = s.tab!;
      const node = last - s.joint;
      const bend = { x: (tab.bend[0].x + tab.bend[1].x) / 2, y: (tab.bend[0].y + tab.bend[1].y) / 2 };
      const bh = tab.balanceHole; // il filo di bilanciamento sta nel suo foro, non in quello del cavo di potenza
      const u = (bh.x - bend.x) * d.x + (bh.y - bend.y) * d.y; // dal piegamento al foro, lungo la linguetta
      const aBend = bend.x * d.x + bend.y * d.y;
      const pHole = bh.x * perp.x + bh.y * perp.y;
      const yHole = s.face === 'top' ? sheetTop - u : sheetBottom + u;
      const pPin = pConn + (node - (n - 1) / 2) * CONNECTOR_PITCH_MM;
      const p0 = to3(aBend, pHole, yHole);
      const len = (x: Pt3, y: Pt3) => Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
      const points: Pt3[] = [p0];
      if (boxSize) {
        // I fili non passano mai dietro la scatola: scendono (o salgono) lungo il bordo del pacco fino sopra (o sotto) la
        // scatola, e da lì vanno al pad scavalcandone il bordo (faccia superiore) o a un connettore oltre la testata.
        // Con il connettore oltre la testata ogni filo prende la sua corsia, così non si sovrappongono.
        const lane = onEnd ? (faceRank.get(s.id) ?? 0) * WIRE_LANE_MM : 0;
        const yE = s.face === 'top' ? Math.min(yHole, yMid + boxSize.widthMm / 2 + EDGE_GAP_MM + lane) : Math.max(yHole, yMid - boxSize.widthMm / 2 - EDGE_GAP_MM - lane);
        points.push(to3(aBend, pHole, yE));
        if (onTop) points.push(to3(aConn, pPin, yE), to3(aTop + EDGE_GAP_MM, pPin, yE), to3(aTop, pPin, yMid));
        else points.push(to3(aConn, pPin, yE), to3(aConn, pPin, yMid));
      } else points.push(to3(aBend, pHole, yMid), to3(aConn, pPin, yMid));
      const lengthMm = points.slice(1).reduce((acc, q, i) => acc + len(points[i]!, q), 0);
      const extra = mount.slackMm + (mount.mode === 'external' ? mount.tailMm : 0);
      return {
        node,
        label: `B${node}`,
        stripId: s.id,
        face: s.face,
        points,
        lengthMm,
        cutMm: Math.ceil((lengthMm + extra) / 5 - 1e-9) * 5,
      };
    })
    .sort((a, b) => a.node - b.node);

  const connector = to3(onTop ? aTop : aConn, pConn, yMid);
  let boxOut: BmsBox | null = null;
  if (box && size) {
    // Lunghezza lungo il lato, larghezza in altezza, spessore verso l'esterno; la faccia verso il pacco è quella del connettore.
    const along = d.x === 0 ? { x: size.lengthMm, z: size.thicknessMm } : { x: size.thicknessMm, z: size.lengthMm };
    const out = to3(aConn + size.thicknessMm / 2, pc, yMid);
    boxOut = { center: out, size: { x: along.x, y: size.widthMm, z: along.z } };
  }
  return { mount, side, connector, box: boxOut, wires, totalCutMm: wires.reduce((a, w) => a + w.cutMm, 0) };
}
