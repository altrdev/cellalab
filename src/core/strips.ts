import { findCellType } from './catalog';
import { bmsOf } from './bms';
import { intersectRegions, pointInRegions, regionArea, unionPolygons, type Region } from './clip';
import { circlePoints, convexHull, distToRect, SIDE_VECTOR, type Pt } from './polygon';
import type { PlacedCell, Project } from './types';

/**
 * Generazione automatica delle lamelle dalla topologia.
 *
 * Ogni terminale di ogni cella appartiene a una sola lamella:
 *  - giunzione 0: terminale + del pacco (i + del primo gruppo);
 *  - giunzione k (1..G-1): collega i − del gruppo k-1 con i + del gruppo k (collegamento in serie);
 *  - giunzione G: terminale − del pacco (i − dell'ultimo gruppo).
 * Per ogni giunzione si genera una lamella per faccia ("Sopra" = faccia dove guarda il polo
 * rivolto in alto, "Sotto" = faccia opposta).
 *
 * Forma: un appoggio rotondo su ogni cella e una banda di larghezza regolabile tra ogni coppia di
 * celle vicine. Tra le bande restano finestre (triangoli o rettangoli); allargando le bande le
 * finestre si chiudono e la lamella diventa piena.
 */

export type Face = 'top' | 'bottom';
export type Pole = '+' | '-';
export type StripKind = 'terminal-plus' | 'terminal-minus' | 'series';

export interface StripNode {
  cellId: string;
  group: number;
  pole: Pole;
  x: number;
  y: number;
  /** Raggio dell'area dove si può saldare, mm. */
  contactRadiusMm: number;
  /** Raggio della cella, mm. */
  cellRadiusMm: number;
  /** Raggio dell'appoggio attorno al centro della cella (contatto + bordo). */
  reachMm: number;
}

export type TabSide = 'top' | 'bottom' | 'left' | 'right';

/** Linguetta di presa per il filo di bilanciamento del BMS: sporge dalla lamella (e ne fa parte) ed è forata. */
export interface StripTab {
  /** Di bilanciamento (una per giunzione) o di potenza (cavo di P+ e P−). */
  kind: 'balance' | 'power';
  side: TabSide;
  /** Centro della cella da cui parte e larghezza effettiva, mm. */
  anchor: Pt;
  widthMm: number;
  /** Rettangolo della linguetta, mm del disegno. */
  rect: Pt[];
  /** Centro e diametro del foro per il filo. */
  holeX: number;
  holeY: number;
  holeDiameterMm: number;
  /** Linea di piega consigliata (oltre il bordo del holder, prima del foro), da segnare e non da tagliare. */
  bend: [Pt, Pt];
  /** Cosa intralcia la linguetta: un'altra lamella della stessa faccia o una cella; null = libera. */
  blockedBy: 'strip' | 'cell' | null;
}

export interface Strip {
  id: string;
  face: Face;
  joint: number;
  kind: StripKind;
  label: string;
  /** Indici dei gruppi collegati (1 per i terminali, 2 per le serie). */
  groups: number[];
  nodes: StripNode[];
  /** Uscita del filo dal portacelle senza linguette (la mette l'interfaccia, che conosce il portacelle). */
  wireExit?: import('./wireExit').WireExit;
  /** Linguetta di potenza (solo P+ e P−, se accesa): accanto a quella di bilanciamento, con il foro per il cavo. */
  powerTab?: StripTab;
  /** Contorno esterno, a area positiva, in mm del disegno (convesso se la forma è piena). */
  outline: Pt[];
  /** Finestre vuote tra le bande. */
  holes: Pt[][];
  /** Larghezza delle bande tra le celle vicine, mm. */
  bandMm: number;
  /**
   * Lunghezza libera della banda più lunga tra due appoggi (distanza tra i bordi dei contatti saldati), mm:
   * è il tratto che scalda, con le estremità tenute dalle celle. Con una cella sola non ci sono bande:
   * si prende il diametro dell'appoggio.
   */
  bandLengthMm: number;
  /** Quante celle in parallelo dividono la corrente: ogni banda porta circa I/P. */
  parallelCount: number;
  areaMm2: number;
  /** Presente solo sulle lamelle che portano un filo di bilanciamento (con un BMS scelto). */
  tab?: StripTab;
  /** Vero se manca uno dei due lati di un collegamento in serie (es. gruppo con polarità miste). */
  partial: boolean;
}

export interface StripOptions {
  /** Metallo che resta oltre l'area di saldatura, mm: i punti non vanno sul taglio (più bordo = angoli più tondi). */
  marginMm?: number;
  /** Diametro dell'area di saldatura sulla cella, mm (il bordo si aggiunge fuori); assente = il bottone. */
  contactDiameterMm?: number | null;
  /** Larghezza delle bande tra le celle vicine, mm; assente = automatica (60% dell'appoggio). */
  widthMm?: number | null;
  /** Linguette di presa per il BMS: solo se il progetto ha un BMS; assente o null = nessuna. */
  tabs?: TabOptions | null;
  /** Sagoma esterna del holder (senza le tasche): la piega sta oltre questo limite. Assente = parete e gioco di default. */
  /** Sagoma del holder, per mettere la piega oltre il bordo: una sola per tutte le lamelle o una per faccia (le due piastre possono avere scanalature diverse). */
  holderOutline?: readonly Region[] | Partial<Record<Face, readonly Region[]>> | null;
}

export interface TabOptions {
  side: TabSide;
  widthMm: number;
  /** Lunghezza della parte piegata, oltre la linea di piega, mm. */
  lengthMm: number;
  holeMm: number;
  /** 'tab' (default): linguetta di bilanciamento per ogni giunzione; 'none': niente (restano le linguette di potenza di P+ e P−). */
  style?: 'tab' | 'none';
  /** Linguetta del cavo di potenza su P+ e P−; assente = niente. */
  power?: { widthMm: number; holeMm: number } | null;
  /** Margine della piega oltre il bordo del holder, mm. */
  bendMm: number;
}

export const DEFAULT_STRIP_MARGIN_MM = 1;
/** Senza il holder, quanto sporge dalla cella la sua parete (parete 1,6 + gioco 0,15), mm. */
const DEFAULT_HOLDER_EDGE_MM = 1.75;
/** Lato massimo dei segmenti con cui si approssima un cerchio, mm: sotto 0,01 mm di scostamento dal cerchio vero. */
const MAX_CHORD_MM = 0.4;
/** Segmenti per un cerchio di raggio `r`: un lato lungo al massimo `MAX_CHORD_MM`, multiplo di 4 per toccare gli assi. */
const circleSegments = (r: number) => Math.min(240, Math.max(48, Math.ceil((2 * Math.PI * r) / MAX_CHORD_MM / 4) * 4));

/** Polo che una cella espone su una faccia. */
export function poleOnFace(cell: Pick<PlacedCell, 'plusUp'>, face: Face): Pole {
  const topPole: Pole = cell.plusUp ? '+' : '-';
  if (face === 'top') return topPole;
  return topPole === '+' ? '-' : '+';
}

/**
 * Raggio dell'area saldabile. Polo +: solo il bottone (circa 41% del raggio); polo −: il fondo
 * piatto, lasciando 1,5 mm di bordo.
 */
export function contactRadiusMm(diameterMm: number, pole: Pole): number {
  const r = diameterMm / 2;
  return pole === '+' ? 0.41 * r : Math.max(r - 1.5, 0.3 * r);
}

export function buildStrips(project: Project, options: StripOptions = {}): Strip[] {
  const margin = options.marginMm ?? DEFAULT_STRIP_MARGIN_MM;
  const groups = [...new Set(project.cells.filter((c) => c.group !== null).map((c) => c.group as number))].sort(
    (a, b) => a - b,
  );
  if (groups.length === 0) return [];
  const byGroup = new Map<number, PlacedCell[]>();
  for (const c of project.cells) {
    if (c.group === null) continue;
    const list = byGroup.get(c.group);
    if (list) list.push(c);
    else byGroup.set(c.group, [c]);
  }

  const nodeFor = (cell: PlacedCell, pole: Pole): StripNode | null => {
    const type = findCellType(project, cell.typeId);
    if (!type) return null;
    const cellR = type.diameterMm / 2;
    // Area di saldatura unica per tutte le celle (come si fa a mano): di default il bottone, oppure il Ø scelto
    // (con un limite perché appoggio e bordo restino dentro la cella). L'appoggio è l'area più il bordo.
    const forced = options.contactDiameterMm;
    const contact =
      forced != null && forced > 0
        ? Math.max(Math.min(forced / 2, cellR - 0.3 - margin), 0.5)
        : Math.max(contactRadiusMm(type.diameterMm, '+'), 0.5);
    const reach = contact + margin;
    return {
      cellId: cell.id,
      group: cell.group as number,
      pole,
      x: cell.x,
      y: cell.y,
      contactRadiusMm: contact,
      cellRadiusMm: cellR,
      reachMm: reach,
    };
  };

  const strips: Strip[] = [];
  const G = groups.length;
  for (const face of ['top', 'bottom'] as const) {
    for (let j = 0; j <= G; j++) {
      const nodes: StripNode[] = [];
      const linked: number[] = [];
      let hasMinus = false;
      let hasPlus = false;
      if (j >= 1) {
        const g = groups[j - 1]!;
        for (const c of byGroup.get(g) ?? []) {
          if (poleOnFace(c, face) !== '-') continue;
          const n = nodeFor(c, '-');
          if (n) nodes.push(n);
        }
        if (nodes.length) {
          linked.push(g);
          hasMinus = true;
        }
      }
      if (j < G) {
        const g = groups[j]!;
        const before = nodes.length;
        for (const c of byGroup.get(g) ?? []) {
          if (poleOnFace(c, face) !== '+') continue;
          const n = nodeFor(c, '+');
          if (n) nodes.push(n);
        }
        if (nodes.length > before) {
          linked.push(g);
          hasPlus = true;
        }
      }
      if (nodes.length === 0) continue;

      const kind: StripKind = j === 0 ? 'terminal-plus' : j === G ? 'terminal-minus' : 'series';
      const label =
        kind === 'terminal-plus'
          ? 'P+'
          : kind === 'terminal-minus'
            ? 'P−'
            : `S${groups[j - 1]! + 1}→S${groups[j]! + 1}`;
      const minus = nodes.filter((n) => n.pole === '-');
      const plus = nodes.filter((n) => n.pole === '+');
      const padDiameter = Math.min(...nodes.map((n) => 2 * n.reachMm));
      const cap = Math.min(...nodes.map((n) => 2 * n.cellRadiusMm));
      const forced = options.widthMm;
      let bandMm = forced != null && forced > 0 ? Math.min(Math.max(forced, 1), cap) : Math.min(0.6 * padDiameter, cap);
      // I terminali raccolgono la corrente di più celle: la banda non è mai più stretta dell'appoggio.
      if (kind !== 'series') bandMm = Math.max(bandMm, Math.min(padDiameter, cap));
      const polys = nodes.map((n) => circlePoints(n.x, n.y, n.reachMm, circleSegments(n.reachMm)));
      const edges = neighbourEdges(nodes);
      const bandLengthMm = edges.length
        ? Math.max(...edges.map(([a, b]) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y) - a.contactRadiusMm - b.contactRadiusMm)))
        : 2 * nodes[0]!.reachMm;
      for (const [a, b] of edges) {
        polys.push(
          convexHull([...circlePoints(a.x, a.y, bandMm / 2, circleSegments(bandMm / 2)), ...circlePoints(b.x, b.y, bandMm / 2, circleSegments(bandMm / 2))]),
        );
      }
      const region: Region = unionPolygons(polys);
      const outline = region.outline;
      const holes = region.holes;
      const areaMm2 = regionArea(region);
      strips.push({
        id: `${face}-${j}`,
        face,
        joint: j,
        kind,
        label,
        groups: linked,
        nodes,
        outline,
        holes,
        bandMm,
        bandLengthMm,
        parallelCount: Math.max(1, minus.length, plus.length),
        areaMm2,
        partial: kind === 'series' && !(hasMinus && hasPlus),
      });
    }
  }
  if (options.tabs && bmsOf(project)) addTabs(project, strips, options.tabs, options.holderOutline ?? null);
  return strips;
}


/** Una lamella per giunzione, di preferenza completa e della faccia sopra (come per le linguette). */
export function chosenStrips(strips: readonly Strip[]): Strip[] {
  const byJoint = new Map<number, Strip>();
  for (const s of strips) {
    const cur = byJoint.get(s.joint);
    const better = !cur || (cur.partial && !s.partial) || (cur.partial === s.partial && cur.face === 'bottom' && s.face === 'top');
    if (better) byJoint.set(s.joint, s);
  }
  return [...byJoint.values()];
}

/** Il nodo della lamella che arriva più avanti verso `side` (a parità, il più centrale). */
export function frontNode(s: Strip, side: TabSide): StripNode {
  const d = SIDE_VECTOR[side];
  const pp = { x: -d.y, y: d.x };
  const fwd = (n: StripNode) => n.x * d.x + n.y * d.y + n.reachMm;
  const sd = (n: StripNode) => n.x * pp.x + n.y * pp.y;
  const mean = s.nodes.reduce((a, n) => a + sd(n), 0) / s.nodes.length;
  return [...s.nodes].sort((p, q) => (Math.abs(fwd(p) - fwd(q)) > 1e-6 ? fwd(q) - fwd(p) : Math.abs(sd(p) - mean) - Math.abs(sd(q) - mean)))[0]!;
}

/** Fin dove (mm) il portacelle arriva uscendo da `from` lungo `dir`, guardando i punti spostati di ciascun `offsets` di lato; -1 se mai. */
export function holderReach(from: Pt, dir: Pt, offsets: readonly number[], regions: readonly Region[]): number {
  const pp = { x: -dir.y, y: dir.x };
  let last = -1;
  for (let a = 0; a <= 80; a += 0.25) {
    if (offsets.some((v) => pointInRegions({ x: from.x + dir.x * a + pp.x * v, y: from.y + dir.y * a + pp.y * v }, regions))) last = a;
  }
  return last;
}

/**
 * Un filo di bilanciamento per ogni giunzione (S+1 in tutto): sulla lamella completa, di preferenza della faccia
 * sopra. La linguetta parte dalla cella più vicina al lato scelto e sporge in fuori; larghezza e foro si adattano
 * all'appoggio. P+ e P− hanno in più la linguetta di potenza: esce a 90° rispetto a quella di bilanciamento, dal lato
 * libero più vicino alla lamella.
 */
function addTabs(project: Project, strips: Strip[], o: TabOptions, holderOpt: StripOptions['holderOutline']): void {
  const chosen = new Set(chosenStrips(strips));
  const sidesAcross: Record<TabSide, TabSide[]> = { top: ['left', 'right'], bottom: ['left', 'right'], left: ['top', 'bottom'], right: ['top', 'bottom'] };
  const cellR = (c: { typeId: string }) => (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2;
  // Quanto si spinge il pacco in una direzione, per scegliere il lato più vicino a una lamella.
  const packEdge = (side: TabSide): number => {
    const dd = SIDE_VECTOR[side];
    return Math.max(...project.cells.map((c) => c.x * dd.x + c.y * dd.y + cellR(c)));
  };

  interface Plan {
    kind: StripTab['kind'];
    side: TabSide;
    node: StripNode;
    w: number;
    holeWant: number;
    lengthMm: number;
    rect: Pt[];
  }
  const rectOf = (node: StripNode, side: TabSide, w: number, reach: number): Pt[] => {
    const dd = SIDE_VECTOR[side];
    const pp = { x: -dd.y, y: dd.x };
    const at = (a: number, p: number): Pt => ({ x: node.x + dd.x * a + pp.x * p, y: node.y + dd.y * a + pp.y * p });
    return convexHull([at(0, -w / 2), at(0, w / 2), at(reach, w / 2), at(reach, -w / 2)]);
  };
  /** Un'ipotesi veloce di intralcio (celle di altre giunzioni e altre lamelle della faccia); il controllo finale è più sotto. */
  const blocked = (s: Strip, rect: readonly Pt[]): boolean => {
    const own = new Set(s.nodes.map((n) => n.cellId));
    if (project.cells.some((c) => !own.has(c.id) && distToRect(c, rect) < cellR(c) - 0.01)) return true;
    return strips.some((o2) => o2 !== s && o2.face === s.face && intersectRegions({ outline: o2.outline, holes: o2.holes }, [rect]).some((h) => regionArea(h) > 0.01));
  };

  for (const s of strips) {
    if (!chosen.has(s)) continue;
    const holder: readonly Region[] | null = (Array.isArray(holderOpt) ? holderOpt : (holderOpt as Partial<Record<Face, readonly Region[]>> | null | undefined)?.[s.face]) ?? null;
    const bNode = frontNode(s, o.side);
    const plans: Plan[] = [];
    const bW = Math.min(o.widthMm, 2 * bNode.reachMm);
    if (o.style !== 'none') plans.push({ kind: 'balance', side: o.side, node: bNode, w: bW, holeWant: o.holeMm, lengthMm: Math.max(o.lengthMm, 1), rect: [] });
    if (o.power && s.kind !== 'series') {
      const pw = o.power;
      const lengthMm = Math.max(o.lengthMm, pw.holeMm + 4);
      const cands = sidesAcross[o.side].map((side) => {
        const node = frontNode(s, side);
        const w = Math.min(pw.widthMm, 2 * node.reachMm);
        const rect = rectOf(node, side, w, node.cellRadiusMm + DEFAULT_HOLDER_EDGE_MM + o.bendMm + lengthMm + 3);
        const dd = SIDE_VECTOR[side];
        return { side, node, w, rect, isBlocked: blocked(s, rect), gap: packEdge(side) - (node.x * dd.x + node.y * dd.y + node.cellRadiusMm) };
      });
      // Il lato libero più vicino al bordo del pacco; se sono entrambi intralciati, il più vicino comunque.
      cands.sort((p, q) => Number(p.isBlocked) - Number(q.isBlocked) || p.gap - q.gap);
      const c = cands[0]!;
      plans.push({ kind: 'power', side: c.side, node: c.node, w: c.w, holeWant: pw.holeMm, lengthMm, rect: [] });
    }

    // Fin dove arriva il holder lungo la linguetta (centro e due bordi): la piega sta oltre.
    const exitOf = (pl: Plan): number => {
      const dd = SIDE_VECTOR[pl.side];
      const pp = { x: -dd.y, y: dd.x };
      let exit = pl.node.cellRadiusMm + DEFAULT_HOLDER_EDGE_MM;
      if (holder && holder.length > 0) {
        const last = holderReach(pl.node, dd, [-pl.w / 2, 0, pl.w / 2], holder);
        if (last >= 0) exit = last;
      }
      return Math.max(exit + o.bendMm, pl.node.reachMm);
    };

    let region: Region = { outline: s.outline, holes: s.holes };
    const holes: Pt[][] = [];
    for (const pl of plans) {
      const dd = SIDE_VECTOR[pl.side];
      const pp = { x: -dd.y, y: dd.x };
      const bendAlong = exitOf(pl);
      const reach = bendAlong + pl.lengthMm;
      const at = (a: number, p: number): Pt => ({ x: pl.node.x + dd.x * a + pp.x * p, y: pl.node.y + dd.y * a + pp.y * p });
      const rect = rectOf(pl.node, pl.side, pl.w, reach);
      const hole = Math.min(pl.holeWant, pl.w - 1, pl.lengthMm - 1);
      const hc = at(bendAlong + pl.lengthMm / 2, 0); // il foro sta a metà della parte piegata
      region = unionPolygons([region.outline, rect]);
      if (hole >= 0.5) holes.push(circlePoints(hc.x, hc.y, hole / 2, circleSegments(hole / 2)));
      const tab: StripTab = {
        kind: pl.kind,
        side: pl.side,
        anchor: { x: pl.node.x, y: pl.node.y },
        widthMm: pl.w,
        rect,
        holeX: hc.x,
        holeY: hc.y,
        holeDiameterMm: hole >= 0.5 ? hole : 0,
        bend: [at(bendAlong, -pl.w / 2), at(bendAlong, pl.w / 2)],
        blockedBy: null,
      };
      if (pl.kind === 'balance') s.tab = tab;
      else s.powerTab = tab;
    }
    s.outline = region.outline;
    s.holes = [...s.holes, ...holes];
    s.areaMm2 = regionArea({ outline: s.outline, holes: s.holes });
  }
  // Intralci: celle dell'altra parte e lamelle della stessa faccia (con le loro linguette).
  for (const s of strips) for (const tab of tabsOf(s)) {
    const own = new Set(s.nodes.map((n) => n.cellId));
    for (const c of project.cells) {
      if (own.has(c.id)) continue;
      const r = (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2;
      if (distToRect(c, tab.rect) < r - 0.01) tab.blockedBy = 'cell';
    }
    if (tab.blockedBy) continue;
    for (const o2 of strips) {
      if (o2 === s || o2.face !== s.face) continue;
      const hit = intersectRegions({ outline: o2.outline, holes: o2.holes }, [tab.rect]);
      if (hit.some((h) => regionArea(h) > 0.01)) {
        tab.blockedBy = 'strip';
        break;
      }
    }
  }
}

/** Le linguette di una lamella: quella di bilanciamento e, su P+ e P−, quella di potenza. */
export const tabsOf = (s: Strip): StripTab[] => [s.tab, s.powerTab].filter((t): t is StripTab => t !== undefined);

/** Larghezza utile dove passa la corrente: quella delle bande tra le celle. */
export const neckWidthMm = (strip: Strip): number => strip.bandMm;

/**
 * Coppie di celle vicine: tutte quelle a distanza non superiore a 1,2 volte la minima (nel nido
 * d'ape sono i sei vicini, nel reticolo quadrato i quattro). Se restassero pezzi separati si
 * aggiungono i collegamenti più corti per unirli.
 */
function neighbourEdges(nodes: readonly StripNode[]): [StripNode, StripNode][] {
  if (nodes.length < 2) return [];
  const pairs: { d: number; i: number; j: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      pairs.push({ d: Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y), i, j });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);
  const limit = pairs[0]!.d * 1.2 + 1e-6;
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const out: [StripNode, StripNode][] = [];
  for (const e of pairs) {
    if (e.d <= limit) {
      parent[find(e.i)] = find(e.j);
      out.push([nodes[e.i]!, nodes[e.j]!]);
    }
  }
  for (const e of pairs) {
    if (e.d <= limit) continue;
    const ri = find(e.i);
    const rj = find(e.j);
    if (ri === rj) continue;
    parent[ri] = rj;
    out.push([nodes[e.i]!, nodes[e.j]!]);
  }
  return out;
}
