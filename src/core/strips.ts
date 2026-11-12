import { findCellType } from './catalog';
import { bmsOf } from './bms';
import { intersectRegions, pointInRegions, regionArea, unionPolygons, type Region } from './clip';
import { circlePoints, convexHull, type Pt } from './polygon';
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

/** Le linguette di una lamella (una in serie, due sui terminali). */
export const tabsOf = (s: Pick<Strip, 'tab' | 'balanceTab'>): StripTab[] => [s.tab, s.balanceTab].filter((t): t is StripTab => t !== undefined);

export type TabSide = 'top' | 'bottom' | 'left' | 'right';

/** Linguetta di presa per il filo di bilanciamento del BMS: sporge dalla lamella (e ne fa parte) ed è forata. */
export interface StripTab {
  side: TabSide;
  /** Linguetta dei terminali (P+/P−): più larga e con il foro per il cavo di potenza. */
  power: boolean;
  /** Centro della cella da cui parte e larghezza effettiva, mm. */
  anchor: Pt;
  widthMm: number;
  /** Rettangolo della linguetta, mm del disegno. */
  rect: Pt[];
  /** Centro e diametro del foro per il filo. */
  holeX: number;
  holeY: number;
  holeDiameterMm: number;
  /** Posizione della linguetta di lato rispetto alla cella da cui parte (la linguetta di potenza e quella di bilanciamento dei terminali sono affiancate), mm. */
  lateralMm: number;
  /** Foro dove si salda il filo di bilanciamento: solo sulla linguetta che lo porta (quella in serie, o quella piccola dei terminali). */
  balanceHole?: { x: number; y: number; diameterMm: number };
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
  /** Presente solo sulle lamelle che portano un filo di bilanciamento (con un BMS scelto). Sui terminali è la linguetta del cavo di potenza. */
  tab?: StripTab;
  /** Solo sui terminali (P+/P−): la linguetta piccola, affiancata, per il filo di bilanciamento. */
  balanceTab?: StripTab;
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
  holderOutline?: readonly Region[] | null;
}

export interface TabOptions {
  side: TabSide;
  widthMm: number;
  /** Lunghezza della parte piegata, oltre la linea di piega, mm. */
  lengthMm: number;
  holeMm: number;
  /** Foro delle linguette dei terminali (cavo di potenza), mm. */
  powerHoleMm: number;
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

const SIDE_VECTOR: Record<TabSide, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

const sideOf = (v: Pt): TabSide => (v.y < 0 ? 'top' : v.y > 0 ? 'bottom' : v.x < 0 ? 'left' : 'right');

/**
 * Un filo di bilanciamento per ogni giunzione (S+1 in tutto): sulla lamella completa, di preferenza della faccia
 * sopra. La linguetta parte dalla cella più vicina al lato scelto e sporge in fuori; larghezza e foro si adattano
 * all'appoggio. Sui terminali (P+/P−) ce ne sono due: una piccola per il filo di bilanciamento, dal lato scelto con le
 * altre, e una larga per il cavo di potenza dal lato opposto (l'altro capo della lamella).
 */
function addTabs(project: Project, strips: Strip[], o: TabOptions, holder: readonly Region[] | null): void {
  const d = SIDE_VECTOR[o.side];
  const perp = { x: -d.y, y: d.x };
  const byJoint = new Map<number, Strip>();
  for (const s of strips) {
    const cur = byJoint.get(s.joint);
    const better = !cur || (cur.partial && !s.partial) || (cur.partial === s.partial && cur.face === 'bottom' && s.face === 'top');
    if (better) byJoint.set(s.joint, s);
  }
  const chosen = new Set(byJoint.values());
  const dot = (n: { x: number; y: number }, v: Pt) => n.x * v.x + n.y * v.y;
  const centre = { x: project.cells.reduce((a, c) => a + c.x, 0) / Math.max(1, project.cells.length), y: project.cells.reduce((a, c) => a + c.y, 0) / Math.max(1, project.cells.length) };
  const cellDisc = project.cells.map((c) => ({ id: c.id, x: c.x, y: c.y, r: (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2 }));

  interface Spec {
    lateral: number;
    width: number;
    holeWant: number;
    length: number;
    power: boolean;
    carriesBalance: boolean;
  }
  interface Made {
    tabs: StripTab[];
    rects: Pt[][];
    holes: Pt[][];
  }

  /** Linguette che partono dal nodo `node` in direzione `dir`, tutte con la stessa linea di piega. */
  const makeTabs = (node: StripNode, dir: Pt, specs: Spec[]): Made => {
    const pp = { x: -dir.y, y: dir.x };
    const at = (a: number, p: number): Pt => ({ x: node.x + dir.x * a + pp.x * p, y: node.y + dir.y * a + pp.y * p });
    // Fin dove arriva il holder lungo la linguetta (controllando il centro e i due bordi di ogni linguetta): la piega sta oltre.
    let exit = node.cellRadiusMm + DEFAULT_HOLDER_EDGE_MM;
    if (holder && holder.length > 0) {
      let last = -1;
      const vs = specs.flatMap((sp) => [sp.lateral - sp.width / 2, sp.lateral, sp.lateral + sp.width / 2]);
      for (let aa = 0; aa <= 80; aa += 0.25) {
        if (vs.some((v) => pointInRegions(at(aa, v), holder))) last = aa;
      }
      if (last >= 0) exit = last;
    }
    const bendAlong = Math.max(exit + o.bendMm, node.reachMm);
    const made: Made = { tabs: [], rects: [], holes: [] };
    for (const sp of specs) {
      const reach = bendAlong + sp.length;
      const l0 = sp.lateral - sp.width / 2;
      const l1 = sp.lateral + sp.width / 2;
      const rect = convexHull([at(0, l0), at(0, l1), at(reach, l1), at(reach, l0)]);
      const hole = Math.min(sp.holeWant, sp.width - 1, sp.length - 1);
      const hc = at(bendAlong + sp.length / 2, sp.lateral);
      made.rects.push(rect);
      if (hole >= 0.5) made.holes.push(circlePoints(hc.x, hc.y, hole / 2, circleSegments(hole / 2)));
      made.tabs.push({
        side: sideOf(dir),
        power: sp.power,
        anchor: { x: node.x, y: node.y },
        widthMm: sp.width,
        lateralMm: sp.lateral,
        rect,
        holeX: hc.x,
        holeY: hc.y,
        holeDiameterMm: hole >= 0.5 ? hole : 0,
        ...(sp.carriesBalance && { balanceHole: { x: hc.x, y: hc.y, diameterMm: hole >= 0.5 ? hole : 0 } }),
        bend: [at(bendAlong, l0), at(bendAlong, l1)],
        blockedBy: null,
      });
    }
    return made;
  };

  /** Una linguetta che passa sopra celle di altre giunzioni o lamelle della stessa faccia non può stare lì. */
  const blocked = (rect: Pt[], s: Strip): boolean => {
    const own = new Set(s.nodes.map((n) => n.cellId));
    if (cellDisc.some((c) => !own.has(c.id) && distToRect(c, rect) < c.r - 0.01)) return true;
    return strips.some((o2) => o2 !== s && o2.face === s.face && intersectRegions({ outline: o2.outline, holes: o2.holes }, [rect]).some((h) => regionArea(h) > 0.01));
  };

  for (const s of strips) {
    if (!chosen.has(s)) continue;
    const extreme = (dir: Pt) =>
      s.nodes.reduce((a, b) => (dot(b, dir) + b.reachMm > dot(a, dir) + a.reachMm + 1e-6 ? b : a));
    const meanSide = s.nodes.reduce((a, n) => a + dot(n, perp), 0) / s.nodes.length;
    const node = s.nodes.reduce((a, b) => {
      const ea = dot(a, d) + a.reachMm;
      const eb = dot(b, d) + b.reachMm;
      if (Math.abs(ea - eb) > 1e-6) return eb > ea ? b : a;
      return Math.abs(dot(b, perp) - meanSide) < Math.abs(dot(a, perp) - meanSide) ? b : a;
    });
    const reachSpan = 2 * node.reachMm;
    const balHole = o.holeMm;
    const balW = Math.max(3, balHole + 1.8);
    const balSpec: Spec = { lateral: 0, width: Math.min(balW, reachSpan), holeWant: balHole, length: Math.max(o.lengthMm, balHole + 3), power: false, carriesBalance: true };
    let made: Made;
    if (s.kind === 'series') {
      made = makeTabs(node, d, [{ lateral: 0, width: Math.min(o.widthMm, reachSpan), holeWant: balHole, length: Math.max(o.lengthMm, 1), power: false, carriesBalance: true }]);
    } else {
      // Terminali: il filo di bilanciamento sta con gli altri dal lato scelto (linguetta piccola); il cavo di potenza esce
      // di lato (linguetta larga), dal bordo laterale più vicino, dalla cella più lontana da quella del bilanciamento.
      // Se di lato è intralciato, dal lato opposto a quello scelto.
      const bal = makeTabs(node, d, [balSpec]);
      const away = dot(node, perp) >= dot(centre, perp) ? perp : { x: -perp.x, y: -perp.y };
      const candidates = [away, { x: -away.x, y: -away.y }, { x: -d.x, y: -d.y }];
      let pw: Made | null = null;
      for (const dir of candidates) {
        const top = s.nodes.reduce((m, n) => Math.max(m, dot(n, dir) + n.reachMm), -Infinity);
        // tra le celle più avanti verso quel lato, la più lontana da quella del bilanciamento
        const nodeP = s.nodes
          .filter((n) => dot(n, dir) + n.reachMm >= top - 1e-6)
          .reduce((best, n) => (Math.hypot(n.x - node.x, n.y - node.y) > Math.hypot(best.x - node.x, best.y - node.y) ? n : best));
        const powSpec: Spec = { lateral: 0, width: Math.min(Math.max(o.widthMm, o.powerHoleMm + 4), 2 * nodeP.reachMm), holeWant: o.powerHoleMm, length: Math.max(o.lengthMm, o.powerHoleMm + 3), power: true, carriesBalance: false };
        const m = makeTabs(nodeP, dir, [powSpec]);
        pw = m;
        if (!blocked(m.rects[0]!, s)) break;
      }
      made = { tabs: [...pw!.tabs, ...bal.tabs], rects: [...pw!.rects, ...bal.rects], holes: [...pw!.holes, ...bal.holes] };
    }
    const region: Region = unionPolygons([s.outline, ...made.rects]);
    s.outline = region.outline;
    s.holes = [...s.holes, ...made.holes];
    s.areaMm2 = regionArea({ outline: s.outline, holes: s.holes });
    s.tab = made.tabs[0]!;
    if (made.tabs[1]) s.balanceTab = made.tabs[1];
  }
  // Intralci: celle dell'altra parte e lamelle della stessa faccia (con le loro linguette).
  for (const s of strips) {
    const own = new Set(s.nodes.map((n) => n.cellId));
    for (const tab of tabsOf(s)) {
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
}

/** Distanza di un punto da un rettangolo (poligono convesso); 0 se dentro. */
function distToRect(p: Pt, rect: readonly Pt[]): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < rect.length; i++) {
    const a = rect[i]!;
    const b = rect[(i + 1) % rect.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    if (ex * (p.y - a.y) - ey * (p.x - a.x) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey)));
  }
  return inside ? 0 : best;
}

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
