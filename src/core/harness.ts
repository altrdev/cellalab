import { findBmsType, bmsOf } from './bms';
import { findCellType } from './catalog';
import type { Pt } from './polygon';
import { tabsOf, type Face, type Strip, type TabSide } from './strips';
import { DEFAULT_BMS_MOUNT, type BmsMount, type BmsSize, type PowerConnector, type Project } from './types';
import { findAwg } from './wire';

/**
 * Cablaggio del BMS: dove sta il BMS sul fianco del pacco e quanto è lungo ogni filo di bilanciamento.
 *
 * Il BMS (o il punto di uscita del fascio) sta a filo del fianco dal lato delle linguette, a metà altezza, tra le due
 * piastre. Niente passa tra lui e le celle: i fili e i cavi corrono in corsie sopra e sotto la scatola (secondo la faccia
 * della lamella) e arrivano ai connettori oltre le sue testate. Il connettore di bilanciamento sta su una testata, i pad di
 * potenza sull'altra. Il nodo B0 è il meno del pacco, BS il più.
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
  /** Percorso: foro della linguetta, piede della discesa, (angolo se la linguetta esce di lato), connettore. */
  points: Pt3[];
  /** Lunghezza lungo il percorso, mm. */
  lengthMm: number;
  /** Lunghezza da tagliare: percorso più scorta (e coda se esterno), arrotondata a 5 mm per eccesso. */
  cutMm: number;
}

/**
 * Cavi di potenza (BMS a porta comune): P+ dalla lamella dritto al connettore; B− dalla lamella di P− al pad B− del BMS;
 * P− dal pad P− del BMS al connettore. P+ e P− escono insieme dal BMS in una coda libera.
 */
export interface HarnessCable {
  label: 'P+' | 'B−' | 'P−';
  stripId: string;
  face: Face;
  points: Pt3[];
  lengthMm: number;
  cutMm: number;
  /** Diametro del cavo con la guaina, mm. */
  odMm: number;
  /** Indice del punto dove inizia la coda libera verso il connettore (l'estremità del BMS); i fermacavi stanno prima. */
  tailFrom: number;
}

/** Connettore a spina alla fine di un cavo di potenza. */
export interface HarnessConnector {
  /** Un involucro per cavo (bullet) o uno per la coppia (XT60/XT90). */
  cable: 'P+' | 'P−' | 'P±';
  kind: Exclude<PowerConnector, 'none'>;
  /** Centro dell'involucro e direzione del cavo (verso l'esterno del BMS), nella scena. */
  center: Pt3;
  axis: Pt3;
  /** Dimensioni: lunghezza lungo l'asse, larghezza e altezza (Y). */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  shape: 'box' | 'cylinder';
}

/** Ingombri tipici degli involucri (stime): bullet da 4 mm, XT60, XT90. */
export const CONNECTOR_SIZES: Record<Exclude<PowerConnector, 'none'>, { lengthMm: number; widthMm: number; heightMm: number; shape: 'box' | 'cylinder' }> = {
  bullet: { lengthMm: 16, widthMm: 7, heightMm: 7, shape: 'cylinder' },
  xt60: { lengthMm: 16, widthMm: 15.6, heightMm: 8, shape: 'box' },
  xt90: { lengthMm: 19, widthMm: 22, heightMm: 10.5, shape: 'box' },
};

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
  /** L'involucro del connettore di bilanciamento sulla testata del BMS. */
  header: BmsBox;
  /** Versori nel disegno: uscita (d) e lungo il lato (perp). */
  axes: { d: Pt; perp: Pt };
  /** La scatola del BMS (solo montato sul pacco e con l'ingombro noto). */
  box: BmsBox | null;
  wires: HarnessWire[];
  /** Cavi di potenza di P+ e P− (vuoto se i terminali non hanno la linguetta di potenza). */
  cables: HarnessCable[];
  connectors: HarnessConnector[];
  totalCutMm: number;
}

/** Passo dei contatti del connettore di bilanciamento (JST-XH), mm. */
export const CONNECTOR_PITCH_MM = 2.5;
/** Gioco tra il cavo di potenza e il fianco della cella, mm. */
export const CABLE_GAP_MM = 0.25;
/** Distanza tra il fianco delle celle e il fascio, mm. */
const WIRE_CLEARANCE_MM = 1.5;
/** Distanza tra la scatola del BMS e la corsia dei fili sopra o sotto di lei, mm. */
const LANE_GAP_MM = 1.5;
/** Ingombro del connettore di bilanciamento sulla testata del BMS (profondità, larghezza), mm. */
const HEADER_DEPTH_MM = 6;
const HEADER_WIDTH_MM = 5;

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
export function buildHarness(project: Project, strips: readonly Strip[], thicknessMm: number, awg: { balanceAwg: number; powerAwg: number } = { balanceAwg: 26, powerAwg: 12 }): Harness | null {
  const bms = bmsOf(project) ?? (project.bmsId ? findBmsType(project, project.bmsId) : undefined);
  const withTab = strips.filter((s) => s.tab && tabsOf(s).some((x) => x.balanceHole));
  if (!bms || withTab.length === 0 || project.cells.length === 0) return null;
  const mount = bmsMountOf(project);
  const side = tabsOf(withTab[0]!).find((x) => x.balanceHole)!.side;
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
  const odMm = findAwg(awg.powerAwg).outerMm;
  const cableOff = CABLE_GAP_MM + odMm / 2;
  const aCable = edge + cableOff;
  const aWire = edge + WIRE_CLEARANCE_MM;
  const size: BmsSize | undefined = bms.sizeMm;
  const box = mount.mode === 'pack' && size !== undefined;
  // Il BMS sta a filo del fianco: niente passa tra lui e le celle. Fili e cavi corrono in corsie sopra o sotto la scatola.
  const aBox = edge + CABLE_GAP_MM;
  const boxT = box && size ? size.thicknessMm : 6;
  const aHdr = aBox + boxT / 2;
  const pc = pMin + mount.along * (pMax - pMin);
  const halfL = box && size ? size.lengthMm / 2 : 15;
  const halfW = box && size ? size.widthMm / 2 : 0;
  const high = mount.cablesEnd === 'high';
  const dirEnd = high ? 1 : -1; // verso l'estremità del BMS da cui escono i cavi di potenza
  const yHi = yMid + halfW;
  const yLo = yMid - halfW;
  const yWireHi = yHi + LANE_GAP_MM;
  const yWireLo = yLo - LANE_GAP_MM;

  const to3 = (a: number, p: number, y: number): Pt3 => ({ x: d.x * a + perp.x * p, y, z: d.y * a + perp.y * p });

  // Un nodo per giunzione: B0 è l'ultima (meno del pacco).
  const joints = withTab.map((s) => s.joint);
  const last = Math.max(...joints);
  const n = last + 1;
  // Il connettore di bilanciamento sta sulla testata del BMS opposta ai cavi di potenza, con i contatti in colonna.
  const pBal = pc - dirEnd * halfL;
  const pFace = pBal - dirEnd * HEADER_DEPTH_MM; // faccia esterna del connettore, dove entrano i fili
  const pFar = pFace - dirEnd * 2;
  const lengthOf = (pts: Pt3[]) => {
    let l = 0;
    for (let k = 0; k + 1 < pts.length; k++) l += Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.y - pts[k]!.y, pts[k + 1]!.z - pts[k]!.z);
    return l;
  };
  const wires: HarnessWire[] = withTab
    .map((s): HarnessWire => {
      // La linguetta che porta il filo di bilanciamento: quella in serie, o la piccola dei terminali (non quella del cavo).
      const tab = tabsOf(s).find((x) => x.balanceHole)!;
      const node = last - s.joint;
      const td = DIR[tab.side];
      const bend = { x: (tab.bend[0].x + tab.bend[1].x) / 2, y: (tab.bend[0].y + tab.bend[1].y) / 2 };
      const bh = tab.balanceHole!;
      const u = (bh.x - bend.x) * td.x + (bh.y - bend.y) * td.y; // dal piegamento al foro, lungo la linguetta
      const yHole = s.face === 'top' ? sheetTop - u : sheetBottom + u;
      const yLane = s.face === 'top' ? yWireHi : yWireLo;
      const yPin = yMid + (node - (n - 1) / 2) * CONNECTOR_PITCH_MM;
      // Con la piega il foro scende sulla linea di piega: la sua posizione in pianta è il foro riportato su quella retta.
      const hx = bh.x - td.x * u;
      const hy = bh.y - td.y * u;
      // Il filo scende (o sale) fino alla corsia sopra (sotto) la scatola, corre lungo il fianco oltre la testata e entra nel connettore.
      const pts: Pt3[] = [{ x: hx, y: yHole, z: hy }, { x: hx, y: yLane, z: hy }];
      // Una linguetta che esce di lato porta il filo lungo il fianco laterale fino all'angolo, poi sul fianco di uscita.
      if (tab.side !== side) pts.push(to3(aWire, hx * perp.x + hy * perp.y, yLane));
      pts.push(to3(aWire, pFar, yLane), to3(aWire, pFar, yPin), to3(aHdr, pFace, yPin));
      const lengthMm = lengthOf(pts);
      const extra = mount.slackMm + (mount.mode === 'external' ? mount.tailMm : 0);
      return {
        node,
        label: `B${node}`,
        stripId: s.id,
        face: s.face,
        points: pts,
        lengthMm,
        cutMm: Math.ceil((lengthMm + extra) / 5 - 1e-9) * 5,
      };
    })
    .sort((a, b) => a.node - b.node);

  const connector = to3(aHdr, pFace, yMid);
  const header: BmsBox = {
    center: to3(aHdr, pBal - dirEnd * HEADER_DEPTH_MM / 2, yMid),
    size: d.x === 0 ? { x: HEADER_DEPTH_MM, y: n * CONNECTOR_PITCH_MM + 2, z: HEADER_WIDTH_MM } : { x: HEADER_WIDTH_MM, y: n * CONNECTOR_PITCH_MM + 2, z: HEADER_DEPTH_MM },
  };

  // Cavi di potenza: dalla linguetta larga di ciascun terminale (di lato) giù o su fino alla corsia sopra la scatola, lungo il
  // fianco laterale e il fianco di uscita fin oltre l'estremità del BMS; qui scendono davanti ai suoi pad. P+ non entra nel BMS
  // e prosegue nella coda; il negativo entra nel BMS (B−) e ne esce (P−): P+ e P− vanno insieme al connettore.
  const terminals = withTab.filter((s) => s.kind !== 'series' && tabsOf(s).some((x) => x.power));
  const pEnd = pc + dirEnd * halfL; // estremità del BMS verso l'uscita dei cavi
  const pB = pEnd + dirEnd * (odMm / 2 + 0.5); // discesa del cavo che entra nel BMS (B−)
  const pP = pB + dirEnd * (odMm + 0.8); // discesa di P+, più in fuori
  const pTail = pP + dirEnd * mount.tailMm;
  const dyStep = odMm + 0.4; // P+ sopra, B− al centro, P− sotto
  const yCable = yWireHi + 0.5 + odMm / 2 + 0.4; // corsia dei cavi, sopra quella dei fili
  const cables: HarnessCable[] = [];
  const connKind = mount.powerConnector === 'none' ? null : mount.powerConnector;
  const cutOf = (l: number) => Math.ceil((l + mount.slackMm) / 5 - 1e-9) * 5;
  for (const s of terminals) {
    const tab = tabsOf(s).find((x) => x.power)!;
    const td = DIR[tab.side];
    const bend = { x: (tab.bend[0].x + tab.bend[1].x) / 2, y: (tab.bend[0].y + tab.bend[1].y) / 2 };
    const u = (tab.holeX - bend.x) * td.x + (tab.holeY - bend.y) * td.y;
    const hx = tab.holeX - td.x * u;
    const hy = tab.holeY - td.y * u;
    const yHole = s.face === 'top' ? sheetTop - u : sheetBottom + u;
    const pHole = hx * perp.x + hy * perp.y;
    const aBend = hx * d.x + hy * d.y;
    const pLat = pHole <= pc ? pMin - cableOff : pMax + cableOff; // fianco laterale più vicino al foro
    const plus = s.kind === 'terminal-plus';
    const yLane = yCable + (plus ? dyStep : 0);
    const lane: Pt3[] = [{ x: hx, y: yHole, z: hy }, { x: hx, y: yLane, z: hy }, to3(aBend, pLat, yLane), to3(aCable, pLat, yLane)];
    if (plus) {
      // scende oltre il cavo che entra nel BMS e prosegue nella coda
      const pts = [...lane, to3(aCable, pP, yLane), to3(aCable, pP, yMid + dyStep), to3(aCable, pTail, yMid + dyStep)];
      const lengthMm = lengthOf(pts);
      cables.push({ label: 'P+', stripId: s.id, face: s.face, points: pts, lengthMm, cutMm: cutOf(lengthMm), odMm, tailFrom: lane.length + 1 });
    } else {
      // il negativo del pacco scende davanti al BMS ed entra nel pad B−; P− esce dal pad P−, più in basso
      const pts = [...lane, to3(aCable, pB, yLane), to3(aCable, pB, yMid), to3(aCable, pEnd, yMid)];
      const lengthIn = lengthOf(pts);
      cables.push({ label: 'B−', stripId: s.id, face: s.face, points: pts, lengthMm: lengthIn, cutMm: cutOf(lengthIn), odMm, tailFrom: pts.length - 1 });
      const out = [to3(aCable, pEnd, yMid - dyStep), to3(aCable, pTail, yMid - dyStep)];
      const lengthOut = lengthOf(out);
      cables.push({ label: 'P−', stripId: s.id, face: s.face, points: out, lengthMm: lengthOut, cutMm: cutOf(lengthOut), odMm, tailFrom: 0 });
    }
  }
  const connectors: HarnessConnector[] = [];
  if (connKind && cables.length > 0) {
    const cs = CONNECTOR_SIZES[connKind];
    const axis = to3(0, dirEnd, 0); // lungo il lato, verso fuori dal pacco
    const place = (cable: HarnessConnector['cable'], y: number, size: { lengthMm: number; widthMm: number; heightMm: number }) => {
      const end = to3(aCable, pTail, y);
      connectors.push({
        cable,
        kind: connKind,
        shape: cs.shape,
        center: { x: end.x + (axis.x * size.lengthMm) / 2, y, z: end.z + (axis.z * size.lengthMm) / 2 },
        axis: { x: axis.x, y: 0, z: axis.z },
        ...size,
      });
    };
    if (connKind === 'bullet') for (const c of cables.filter((x) => x.label !== 'B−')) place(c.label === 'P+' ? 'P+' : 'P−', c.points[c.points.length - 1]!.y, cs);
    else place('P±', yMid, { lengthMm: cs.lengthMm, widthMm: cs.heightMm, heightMm: cs.widthMm }); // poli uno sopra l'altro
  }
  let boxOut: BmsBox | null = null;
  if (box && size) {
    // Lunghezza lungo il lato, larghezza in altezza, spessore verso l'esterno; la faccia verso il pacco tocca il fianco.
    const along = d.x === 0 ? { x: size.lengthMm, z: size.thicknessMm } : { x: size.thicknessMm, z: size.lengthMm };
    boxOut = { center: to3(aBox + size.thicknessMm / 2, pc, yMid), size: { x: along.x, y: size.widthMm, z: along.z } };
  }
  return { mount, side, connector, header, axes: { d, perp }, box: boxOut, wires, cables, connectors, totalCutMm: wires.reduce((a, w) => a + w.cutMm, 0) + cables.reduce((a, c) => a + c.cutMm, 0) };
}
