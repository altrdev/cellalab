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
  /** Percorso: foro della linguetta, discesa, ingresso sotto, corsia, (scavalca il bordo della scatola), pad o connettore. */
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
  /** Se la scheda del BMS sta nello spazio che ha sul pacco; null senza scatola (BMS esterno o ingombro ignoto). */
  fit: HarnessFit | null;
}

/** Ingombro della scheda rispetto al posto sul pacco: di quanto sporge, in lunghezza e in altezza (0 = ci sta). */
export interface HarnessFit {
  /** Sul fianco la lunghezza della scheda va lungo il fianco; in testa va in profondità, verso il lato di uscita. */
  lengthKind: 'flank' | 'head';
  boardLengthMm: number;
  packLengthMm: number;
  lengthOverMm: number;
  boardWidthMm: number;
  packHeightMm: number;
  heightOverMm: number;
}

/** Passo dei contatti del connettore di bilanciamento (JST-XH), mm. */
export const CONNECTOR_PITCH_MM = 2.5;
/** Distanza tra il fianco delle celle e il fascio, mm. */
const WIRE_CLEARANCE_MM = 1.5;
/** In testa: distanza tra il bordo della scheda rivolto al fianco e le corsie dei fili, mm. */
const HEAD_FLANK_GAP_MM = 1.5;
/** Distanza tra la testata del BMS e il connettore di bilanciamento quando sta oltre la testata, mm. */
const CONNECTOR_END_GAP_MM = 3;
/** Margine tra la testata e il primo pad sulla faccia superiore, mm. */
const TOP_MARGIN_MM = 4;
/** Profondità delle corsie dal fianco delle celle e distanza minima in profondità tra discesa e corsia, mm. */
const LANE_DEPTH_MM = 1;
const DEPTH_SEP_MM = 1;
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
  const withTab = strips.filter((s) => s.tab || s.wireExit); // con linguetta, oppure con il foro nel portacelle
  if (!bms || withTab.length === 0 || project.cells.length === 0) return null;
  const mount = bmsMountOf(project);
  const side = withTab[0]!.tab?.side ?? withTab[0]!.wireExit!.side;
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
  let aMin = Infinity;
  let pMin = Infinity;
  let pMax = -Infinity;
  for (const c of project.cells) {
    const r = (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2;
    edge = Math.max(edge, c.x * d.x + c.y * d.y + r);
    aMin = Math.min(aMin, c.x * d.x + c.y * d.y - r);
    const p = c.x * perp.x + c.y * perp.y;
    pMin = Math.min(pMin, p - r);
    pMax = Math.max(pMax, p + r);
  }
  const aWire = edge + WIRE_CLEARANCE_MM;
  const aIn = edge + LANE_DEPTH_MM; // profondità delle corsie, vicino alle celle
  const size: BmsSize | undefined = bms.sizeMm;
  const box = mount.mode === 'pack' && size !== undefined;
  const aConn = aWire; // il connettore sta sulla faccia del BMS verso il pacco
  const boxSize = box ? size : undefined;
  // In testa la scatola sta oltre un'estremità del fianco (sulla stessa fila), e i fili arrivano lungo il fianco.
  const head = !!boxSize && mount.place === 'head';
  const headSgn = mount.connectorEnd === 'end' ? 1 : -1;
  // In testa la scheda sta contro la testata del pacco, girata di 90°: il suo spessore è lungo il fianco, la sua lunghezza
  // in profondità (verso il lato di uscita) e il bordo rivolto al fianco, a filo delle corsie, porta i pad.
  const headT = boxSize?.thicknessMm ?? 0;
  const headL = boxSize?.lengthMm ?? 0;
  const pHead = headSgn > 0 ? pMax + WIRE_CLEARANCE_MM + headT / 2 : pMin - WIRE_CLEARANCE_MM - headT / 2;
  const aBoxCenter = aIn - HEAD_FLANK_GAP_MM - headL / 2;
  const pc = head ? pHead : pMin + mount.along * (pMax - pMin);
  // Con la scatola nota i fili arrivano o sulla faccia superiore (pad o connettore: scavalcano il bordo sopra o sotto la
  // scatola) o a un connettore oltre una testata. Mai dietro: lì c'è la scheda.
  const pins = withTab.length * CONNECTOR_PITCH_MM;
  const sgn = head ? -headSgn : mount.connectorEnd === 'end' ? 1 : -1; // in testa i pad stanno sulla parte della scatola verso il pacco
  const pEnd = boxSize ? pc + sgn * (boxSize.lengthMm / 2) : pc; // testata scelta, lungo il lato
  const onEnd = !!boxSize && !head && mount.connector === 'end';
  const onTop = !!boxSize && !onEnd;
  const pConn = head ? pHead : onEnd ? pEnd + sgn * (pins / 2 + CONNECTOR_END_GAP_MM) : onTop ? pEnd - sgn * Math.min(boxSize!.lengthMm / 2, pins / 2 + TOP_MARGIN_MM) : pc;
  const aTop = aConn + (boxSize?.thicknessMm ?? 0); // faccia superiore della scheda
  const to3 = (a: number, p: number, y: number): Pt3 => ({ x: d.x * a + perp.x * p, y, z: d.y * a + perp.y * p });

  // Un nodo per giunzione: B0 è l'ultima (meno del pacco).
  const joints = withTab.map((s) => s.joint);
  const last = Math.max(...joints);
  const n = last + 1;
  // Corsia di ogni filo tra quelli della stessa faccia: il più lontano dal BMS sta sulla corsia più vicina alla scatola
  // (la più bassa per la faccia sopra), quello della linguetta più vicina sulla più alta. Così le discese dalle linguette
  // non incrociano le corsie degli altri e il nastro si apre come nelle foto dei pacchi veri.
  const startPt = (x: Strip): Pt => (x.tab ? { x: x.tab.holeX, y: x.tab.holeY } : (x.wireExit!.hole ?? x.wireExit!.edge ?? x.wireExit!.solder));
  const holeP = (x: Strip) => startPt(x).x * perp.x + startPt(x).y * perp.y;
  const faceRank = new Map<string, number>();
  for (const face of ['top', 'bottom'] as const) {
    const group = withTab.filter((x) => x.face === face);
    if (head) {
      // In testa i pad sono in fila lungo la scheda, nell'ordine dei nodi: il filo del pad più dentro prende la corsia più
      // lontana dalla scheda, così le discese sui pad non incrociano le corsie degli altri. Le discese dalle linguette
      // possono incrociare le corsie: passano a un'altra profondità.
      group.sort((x, y) => y.joint - x.joint).forEach((x, i) => faceRank.set(x.id, group.length - 1 - i));
    } else {
      group.sort((x, y) => Math.abs(holeP(y) - pConn) - Math.abs(holeP(x) - pConn) || y.joint - x.joint).forEach((x, i) => faceRank.set(x.id, i));
    }
  }
  // Profondità: corsie vicino alle celle, discese dalle linguette più in fuori, salita al connettore ancora più fuori.
  const bendAt = (s: Strip) =>
    s.tab ? ((s.tab.bend[0].x + s.tab.bend[1].x) / 2) * d.x + ((s.tab.bend[0].y + s.tab.bend[1].y) / 2) * d.y : ((s.wireExit!.hole ?? s.wireExit!.edge ?? s.wireExit!.solder).x * d.x + (s.wireExit!.hole ?? s.wireExit!.edge ?? s.wireExit!.solder).y * d.y) + 0.5;
  const aDown = Math.max(aIn + DEPTH_SEP_MM, ...withTab.map(bendAt));
  const aUp = aDown + DEPTH_SEP_MM;
  const wires: HarnessWire[] = withTab
    .map((s): HarnessWire => {
      const node = last - s.joint;
      const pPin = pConn + (node - (n - 1) / 2) * CONNECTOR_PITCH_MM;
      const len = (x: Pt3, y: Pt3) => Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
      const points: Pt3[] = [];
      let pHole: number;
      let yHole: number;
      let aOut: number;
      if (s.tab) {
        const tab = s.tab;
        const bend = { x: (tab.bend[0].x + tab.bend[1].x) / 2, y: (tab.bend[0].y + tab.bend[1].y) / 2 };
        const u = (tab.holeX - bend.x) * d.x + (tab.holeY - bend.y) * d.y; // dal piegamento al foro, lungo la linguetta
        const aBend = bend.x * d.x + bend.y * d.y;
        pHole = tab.holeX * perp.x + tab.holeY * perp.y;
        yHole = s.face === 'top' ? sheetTop - u : sheetBottom + u;
        aOut = Math.max(aBend, aDown); // le discese stanno più in fuori delle corsie
        points.push(to3(aBend, pHole, yHole));
      } else {
        // Senza linguetta: il filo parte dal punto di saldatura sulla lamella, va al foro del portacelle, lo attraversa
        // (fondo e pareti) ed esce dal bordo interno della piastra, da dove scende lungo il fianco.
        const ex = s.wireExit!;
        const top = s.face === 'top';
        const ySurf = top ? sheetTop + 0.3 : sheetBottom - 0.3;
        const solderA = ex.solder.x * d.x + ex.solder.y * d.y;
        const solderP = ex.solder.x * perp.x + ex.solder.y * perp.y;
        if (ex.hole) {
          const yInner = top ? height + ex.floorMm - ex.plateMm : -ex.floorMm + ex.plateMm;
          const aH = ex.hole.x * d.x + ex.hole.y * d.y;
          pHole = ex.hole.x * perp.x + ex.hole.y * perp.y;
          yHole = yInner;
          aOut = Math.max(aH, aDown);
          points.push(to3(solderA, solderP, ySurf), to3(aH, pHole, ySurf), to3(aH, pHole, yInner));
        } else {
          // Giro esterno: dal punto di saldatura sul piano del portacelle fino al bordo della piastra, poi giù lungo il fianco.
          const aE = ex.edge!.x * d.x + ex.edge!.y * d.y;
          pHole = ex.edge!.x * perp.x + ex.edge!.y * perp.y;
          yHole = ySurf;
          aOut = Math.max(aE, aDown);
          points.push(to3(solderA, solderP, ySurf), to3(aE, pHole, ySurf));
        }
      }
      // Ogni filo ha la sua corsia (quota) e non ne tocca nessun altro: scende (o sale) lungo il bordo del pacco, entra
      // sotto (verso il pacco) dove deve incrociare, corre sulla sua corsia e arriva al pad o al connettore. Le discese
      // dalle linguette e quelle sui pad stanno a profondità diverse dalle corsie, quindi quando si incrociano un filo
      // passa sotto l'altro.
      const lane = (faceRank.get(s.id) ?? 0) * WIRE_LANE_MM;
      const half = boxSize ? boxSize.widthMm / 2 : 0;
      const yE = s.face === 'top' ? Math.min(yHole, yMid + half + EDGE_GAP_MM + lane) : Math.max(yHole, yMid - half - EDGE_GAP_MM - lane);
      points.push(to3(aOut, pHole, yE), to3(aIn, pHole, yE));
      if (head) {
        // lungo il fianco fino alla testata, poi verso la scheda sopra (o sotto) il suo bordo e giù (o su) sul pad
        const aPad = aBoxCenter + (node - (n - 1) / 2) * CONNECTOR_PITCH_MM;
        const yEdge = s.face === 'top' ? yMid + half : yMid - half;
        points.push(to3(aIn, pHead, yE), to3(aPad, pHead, yE), to3(aPad, pHead, yEdge));
      } else points.push(to3(aIn, pPin, yE));
      if (head) {
        // già arrivato sul pad
      } else if (onTop) points.push(to3(aTop + EDGE_GAP_MM, pPin, yE), to3(aTop, pPin, yMid));
      else points.push(to3(aUp, pPin, yE), to3(aUp, pPin, yMid)); // la salita al connettore sta fuori dalle corsie
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

  const connector = head ? to3(aBoxCenter, pHead, yMid) : to3(onTop ? aTop : aUp, pConn, yMid);
  let boxOut: BmsBox | null = null;
  if (box && size) {
    // Lunghezza lungo il lato, larghezza in altezza, spessore verso l'esterno; la faccia verso il pacco è quella del connettore.
    const along = d.x === 0 ? { x: size.lengthMm, z: size.thicknessMm } : { x: size.thicknessMm, z: size.lengthMm };
    if (head) {
      // girata di 90°: lo spessore va lungo il fianco, la lunghezza in profondità
      const turned = d.x === 0 ? { x: headT, z: headL } : { x: headL, z: headT };
      boxOut = { center: to3(aBoxCenter, pHead, yMid), size: { x: turned.x, y: size.widthMm, z: turned.z } };
    } else {
      const out = to3(aConn + size.thicknessMm / 2, pc, yMid);
      boxOut = { center: out, size: { x: along.x, y: size.widthMm, z: along.z } };
    }
  }
  let fit: HarnessFit | null = null;
  if (boxSize) {
    const packLength = head ? edge - aMin : pMax - pMin; // in testa la scheda va in profondità, sul fianco lungo il fianco
    fit = {
      lengthKind: head ? 'head' : 'flank',
      boardLengthMm: boxSize.lengthMm,
      packLengthMm: packLength,
      lengthOverMm: Math.max(0, boxSize.lengthMm - packLength),
      boardWidthMm: boxSize.widthMm,
      packHeightMm: height,
      heightOverMm: Math.max(0, boxSize.widthMm - height),
    };
  }
  return { mount, side, connector, box: boxOut, wires, totalCutMm: wires.reduce((a, w) => a + w.cutMm, 0), fit };
}
