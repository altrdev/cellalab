import { findCellType } from './catalog';
import { regionArea, unionPolygons, type Region } from './clip';
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
  /** Vero se manca uno dei due lati di un collegamento in serie (es. gruppo con polarità miste). */
  partial: boolean;
}

export interface StripOptions {
  /** Bordo della lamella oltre l'area di contatto, mm (più bordo = angoli più tondi). */
  marginMm?: number;
  /** Diametro dell'area di appoggio sulla cella, mm; assente = calcolato dal tipo di cella. */
  contactDiameterMm?: number | null;
  /** Larghezza delle bande tra le celle vicine, mm; assente = automatica (60% dell'appoggio). */
  widthMm?: number | null;
}

export const DEFAULT_STRIP_MARGIN_MM = 1;
/** Punti per cerchio con cui si approssima il contorno. */
const CIRCLE_SEGMENTS = 24;

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
    // Appoggio unico per tutte le celle (come si fa a mano): di default quanto il bottone + più il bordo.
    const forced = options.contactDiameterMm;
    const reach =
      forced != null && forced > 0
        ? Math.min(Math.max(forced / 2, 1), cellR - 0.3)
        : contactRadiusMm(type.diameterMm, '+') + margin;
    const contact = Math.max(reach - margin, 0.5);
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
      const polys = nodes.map((n) => circlePoints(n.x, n.y, n.reachMm, CIRCLE_SEGMENTS));
      const edges = neighbourEdges(nodes);
      const bandLengthMm = edges.length
        ? Math.max(...edges.map(([a, b]) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y) - a.contactRadiusMm - b.contactRadiusMm)))
        : 2 * nodes[0]!.reachMm;
      for (const [a, b] of edges) {
        polys.push(
          convexHull([...circlePoints(a.x, a.y, bandMm / 2, CIRCLE_SEGMENTS), ...circlePoints(b.x, b.y, bandMm / 2, CIRCLE_SEGMENTS)]),
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
  return strips;
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
