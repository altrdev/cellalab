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
  // Il cavo di potenza corre a filo del fianco, appoggiato alla cella (il fermacavo lo tiene lì); il BMS gli sta davanti.
  const cableOff = CABLE_GAP_MM + odMm / 2;
  const aCable = edge + cableOff;
  const aWire = edge + WIRE_CLEARANCE_MM;
  const size: BmsSize | undefined = bms.sizeMm;
  const box = mount.mode === 'pack' && size !== undefined;
  // La faccia del BMS verso il pacco, con il connettore di bilanciamento, sta oltre i cavi di potenza.
  const aConn = Math.max(aWire, edge + CABLE_GAP_MM + odMm + 0.6);
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

  // Cavi di potenza: dalla linguetta larga di ciascun terminale (di lato) giù o su fino a metà altezza, lungo il fianco
  // laterale, poi sul fianco di uscita fino all'estremità scelta del BMS. P+ non entra nel BMS: passa oltre e prosegue
  // nella coda. Il negativo entra nel BMS (B−) e ne esce (P−): i due cavi di uscita, P+ e P−, vanno insieme al connettore.
  const terminals = withTab.filter((s) => s.kind !== 'series' && tabsOf(s).some((x) => x.power));
  const high = mount.cablesEnd === 'high';
  const pEnd = pc + (high ? 1 : -1) * ((box && size ? size.lengthMm : 30) / 2); // estremità del BMS verso l'uscita dei cavi
  const pTail = pEnd + (high ? 1 : -1) * mount.tailMm;
  const dyStep = odMm + 0.4; // tre cavi uno sopra l'altro: P+ sopra, B− al centro, P− sotto
  const cables: HarnessCable[] = [];
  const connKind = mount.powerConnector === 'none' ? null : mount.powerConnector;
  const lengthOf = (pts: Pt3[]) => {
    let l = 0;
    for (let k = 0; k + 1 < pts.length; k++) l += Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.y - pts[k]!.y, pts[k + 1]!.z - pts[k]!.z);
    return l;
  };
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
    const y = yMid + (plus ? dyStep : 0);
    const toEnd: Pt3[] = [{ x: hx, y: yHole, z: hy }, { x: hx, y, z: hy }, to3(aBend, pLat, y), to3(aCable, pLat, y), to3(aCable, pEnd, y)];
    if (plus) {
      // passa davanti all'estremità del BMS e prosegue nella coda
      const pts = [...toEnd, to3(aCable, pTail, y)];
      const lengthMm = lengthOf(pts);
      cables.push({ label: 'P+', stripId: s.id, face: s.face, points: pts, lengthMm, cutMm: cutOf(lengthMm), odMm, tailFrom: toEnd.length - 1 });
    } else {
      // il negativo del pacco entra nel BMS (B−) ed esce da P−, a un livello più basso, verso il connettore
      const lengthIn = lengthOf(toEnd);
      cables.push({ label: 'B−', stripId: s.id, face: s.face, points: toEnd, lengthMm: lengthIn, cutMm: cutOf(lengthIn), odMm, tailFrom: toEnd.length - 1 });
      const out = [to3(aCable, pEnd, yMid - dyStep), to3(aCable, pTail, yMid - dyStep)];
      const lengthOut = lengthOf(out);
      cables.push({ label: 'P−', stripId: s.id, face: s.face, points: out, lengthMm: lengthOut, cutMm: cutOf(lengthOut), odMm, tailFrom: 0 });
    }
  }
  const connectors: HarnessConnector[] = [];
  if (connKind && cables.length > 0) {
    const cs = CONNECTOR_SIZES[connKind];
    const axis = to3(0, high ? 1 : -1, 0); // lungo il lato, verso fuori dal pacco
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
    // Lunghezza lungo il lato, larghezza in altezza, spessore verso l'esterno; la faccia verso il pacco è quella del connettore.
    const along = d.x === 0 ? { x: size.lengthMm, z: size.thicknessMm } : { x: size.thicknessMm, z: size.lengthMm };
    const out = to3(aConn + size.thicknessMm / 2, pc, yMid);
    boxOut = { center: out, size: { x: along.x, y: size.widthMm, z: along.z } };
  }
  return { mount, side, connector, axes: { d, perp }, box: boxOut, wires, cables, connectors, totalCutMm: wires.reduce((a, w) => a + w.cutMm, 0) + cables.reduce((a, c) => a + c.cutMm, 0) };
}
