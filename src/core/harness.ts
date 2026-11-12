import { findBmsType, bmsOf } from './bms';
import { findCellType } from './catalog';
import type { Pt } from './polygon';
import { tabsOf, type Face, type Strip, type TabSide } from './strips';
import { DEFAULT_BMS_MOUNT, type BmsMount, type BmsSize, type PowerConnector, type Project } from './types';
import { findAwg } from './wire';

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
  /** Percorso: foro della linguetta, piede della discesa, (angolo se la linguetta esce di lato), connettore. */
  points: Pt3[];
  /** Lunghezza lungo il percorso, mm. */
  lengthMm: number;
  /** Lunghezza da tagliare: percorso più scorta (e coda se esterno), arrotondata a 5 mm per eccesso. */
  cutMm: number;
}

/** Cavo di potenza di un terminale: dal foro della linguetta larga (lato opposto) al BMS, lungo il fianco laterale. */
export interface HarnessCable {
  label: 'P+' | 'P−';
  stripId: string;
  face: Face;
  points: Pt3[];
  lengthMm: number;
  cutMm: number;
  /** Diametro del cavo con la guaina, mm. */
  odMm: number;
}

/** Connettore a spina alla fine di un cavo di potenza. */
export interface HarnessConnector {
  cable: 'P+' | 'P−';
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
/** Distanza tra il fianco delle celle e il fascio, mm. */
const WIRE_CLEARANCE_MM = 1.5;

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
  const aWire = edge + WIRE_CLEARANCE_MM;
  const size: BmsSize | undefined = bms.sizeMm;
  const box = mount.mode === 'pack' && size !== undefined;
  const aConn = aWire; // il connettore sta sulla faccia del BMS verso il pacco
  const pc = pMin + mount.along * (pMax - pMin);

  const to3 = (a: number, p: number, y: number): Pt3 => ({ x: d.x * a + perp.x * p, y, z: d.y * a + perp.y * p });

  // Un nodo per giunzione: B0 è l'ultima (meno del pacco).
  const joints = withTab.map((s) => s.joint);
  const last = Math.max(...joints);
  const n = last + 1;
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
      const pPin = pc + (node - (n - 1) / 2) * CONNECTOR_PITCH_MM;
      // Con la piega il foro scende sulla linea di piega: la sua posizione in pianta è il foro riportato su quella retta.
      const hx = bh.x - td.x * u;
      const hy = bh.y - td.y * u;
      const p0: Pt3 = { x: hx, y: yHole, z: hy };
      const p1: Pt3 = { x: hx, y: yMid, z: hy };
      const p2 = to3(aConn, pPin, yMid);
      // Una linguetta che esce di lato porta il filo lungo il fianco laterale fino all'angolo, poi sul fianco di uscita.
      const lateral = tab.side !== side;
      const pts: Pt3[] = lateral ? [p0, p1, to3(aWire, hx * perp.x + hy * perp.y, yMid), p2] : [p0, p1, p2];
      const len = (a: Pt3, b: Pt3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      let lengthMm = 0;
      for (let i = 0; i + 1 < pts.length; i++) lengthMm += len(pts[i]!, pts[i + 1]!);
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

  const connector = to3(aConn, pc, yMid);

  // Cavi di potenza: dalla linguetta larga (lato opposto) giù o su fino a metà altezza, di lato lungo il fianco laterale
  // più vicino, poi sul fianco di uscita fino alle estremità del BMS.
  const odMm = findAwg(awg.powerAwg).outerMm;
  const sizeLen = box && size ? size.lengthMm : 30;
  const terminals = withTab.filter((s) => s.kind !== 'series' && tabsOf(s).some((x) => x.power));
  const pOf = (s: Strip) => {
    const t = tabsOf(s).find((x) => x.power)!;
    return t.holeX * perp.x + t.holeY * perp.y;
  };
  const ordered = [...terminals].sort((a, b) => pOf(a) - pOf(b));
  const extraCable = mount.slackMm + (mount.mode === 'external' ? mount.tailMm : 0);
  const cables: HarnessCable[] = [];
  const connectors: HarnessConnector[] = [];
  const connKind = mount.powerConnector === 'none' ? null : mount.powerConnector;
  ordered.forEach((s, i) => {
    const tab = tabsOf(s).find((x) => x.power)!;
    const td = DIR[tab.side];
    const bend = { x: (tab.bend[0].x + tab.bend[1].x) / 2, y: (tab.bend[0].y + tab.bend[1].y) / 2 };
    const u = (tab.holeX - bend.x) * td.x + (tab.holeY - bend.y) * td.y;
    const hx = tab.holeX - td.x * u;
    const hy = tab.holeY - td.y * u;
    const yHole = s.face === 'top' ? sheetTop - u : sheetBottom + u;
    const pHole = hx * perp.x + hy * perp.y;
    const aBend = hx * d.x + hy * d.y;
    // Due cavi: quello con p minore va all'estremità di p minore, passando dal fianco laterale di p minore.
    const low = ordered.length === 1 ? pHole <= pc : i === 0;
    const pLat = low ? pMin - WIRE_CLEARANCE_MM : pMax + WIRE_CLEARANCE_MM;
    const pEnd = pc + (low ? -1 : 1) * (sizeLen / 2);
    const pts: Pt3[] = [
      { x: hx, y: yHole, z: hy },
      { x: hx, y: yMid, z: hy },
      to3(aBend, pLat, yMid),
      to3(aWire, pLat, yMid),
      to3(aConn, pEnd, yMid),
    ];
    let lengthMm = 0;
    for (let k = 0; k + 1 < pts.length; k++) lengthMm += Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.y - pts[k]!.y, pts[k + 1]!.z - pts[k]!.z);
    const label = s.kind === 'terminal-plus' ? 'P+' : 'P−';
    cables.push({ label, stripId: s.id, face: s.face, points: pts, lengthMm, cutMm: Math.ceil((lengthMm + extraCable) / 5 - 1e-9) * 5, odMm });
    if (connKind) {
      const cs = CONNECTOR_SIZES[connKind];
      const axis = to3(0, low ? -1 : 1, 0); // lungo il lato, verso l'esterno del BMS
      const end = pts[pts.length - 1]!;
      connectors.push({
        cable: label,
        kind: connKind,
        center: { x: end.x + (axis.x * cs.lengthMm) / 2, y: end.y, z: end.z + (axis.z * cs.lengthMm) / 2 },
        axis: { x: axis.x, y: 0, z: axis.z },
        ...cs,
      });
    }
  });
  let boxOut: BmsBox | null = null;
  if (box && size) {
    // Lunghezza lungo il lato, larghezza in altezza, spessore verso l'esterno; la faccia verso il pacco è quella del connettore.
    const along = d.x === 0 ? { x: size.lengthMm, z: size.thicknessMm } : { x: size.thicknessMm, z: size.lengthMm };
    const out = to3(aConn + size.thicknessMm / 2, pc, yMid);
    boxOut = { center: out, size: { x: along.x, y: size.widthMm, z: along.z } };
  }
  return { mount, side, connector, box: boxOut, wires, cables, connectors, totalCutMm: wires.reduce((a, w) => a + w.cutMm, 0) + cables.reduce((a, c) => a + c.cutMm, 0) };
}
