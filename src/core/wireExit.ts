import { circlePoints, type Pt } from './polygon';
import { intersectRegions, offsetRegions, pointInRegions, regionArea, type Region } from './clip';
import { MIN_PRINT_WALL_MM } from './holder';
import { findCellType } from './catalog';
import type { Face, Strip, StripNode, TabSide } from './strips';
import type { Project } from './types';

/**
 * Uscita dei fili di bilanciamento dal portacelle, senza linguette: il filo si salda sulla lamella vicino al suo bordo
 * verso il lato di uscita, passa in un piccolo foro del portacelle accanto alla lamella (attraverso fondo e pareti) e
 * scende lungo il fianco. Il foro sta sul materiale del portacelle (fuori dalle tasche delle celle), non sotto nessuna
 * lamella della stessa faccia, il più vicino possibile al punto di saldatura.
 */
export interface WireExit {
  stripId: string;
  face: Face;
  side: TabSide;
  /** Punto di saldatura sulla lamella e centro del foro nel portacelle, mm del disegno. */
  solder: Pt;
  hole: Pt;
  diameterMm: number;
  /** Spessore della piastra e del suo fondo, mm: il filo entra dalla faccia esterna ed esce dal bordo delle pareti. */
  plateMm: number;
  floorMm: number;
  /** Raggio del rinforzo da aggiungere al contorno attorno al foro quando lì la plastica non basta (incavo stretto tra due celle, smusso); 0 = non serve. */
  bossMm: number;
}

const SIDE: Record<TabSide, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** Plastica che deve restare attorno al foro verso le tasche delle celle: almeno una parete stampabile, mm. */
const MARGIN_MM = MIN_PRINT_WALL_MM;
/** Il foro sta al massimo così fuori dal contorno (nell'incavo tra due celle, dove si aggiunge un rinforzo) o così dentro, mm. */
const OUTSIDE_MM = 4;
const RIM_MM = 7;
/** Quanto lontano dal punto di saldatura si cerca il foro, mm. */
const SEARCH_MM = 24;
const STEP_MM = 0.5;

/** Una lamella per giunzione, di preferenza completa e della faccia sopra (come per le linguette). */
function chosenStrips(strips: readonly Strip[]): Strip[] {
  const byJoint = new Map<number, Strip>();
  for (const s of strips) {
    const cur = byJoint.get(s.joint);
    const better = !cur || (cur.partial && !s.partial) || (cur.partial === s.partial && cur.face === 'bottom' && s.face === 'top');
    if (better) byJoint.set(s.joint, s);
  }
  return [...byJoint.values()];
}

function frontNode(s: Strip, side: TabSide): StripNode {
  const d = SIDE[side];
  const pp = { x: -d.y, y: d.x };
  const fwd = (n: StripNode) => n.x * d.x + n.y * d.y + n.reachMm;
  const sd = (n: StripNode) => n.x * pp.x + n.y * pp.y;
  const mean = s.nodes.reduce((a, n) => a + sd(n), 0) / s.nodes.length;
  return [...s.nodes].sort((p, q) => (Math.abs(fwd(p) - fwd(q)) > 1e-6 ? fwd(q) - fwd(p) : Math.abs(sd(p) - mean) - Math.abs(sd(q) - mean)))[0]!;
}

/**
 * `wall` è la sagoma piena del portacelle (pareti con le tasche delle celle come buchi), `plateMm`/`floorMm` il suo
 * spessore. Restituisce un'uscita per giunzione; una giunzione senza posto per il foro non ne ha.
 */
export function findWireExits(
  project: Project,
  strips: readonly Strip[],
  wall: readonly Region[],
  side: TabSide,
  holeMm: number,
  plateMm: number,
  floorMm: number,
  chamferMm = 0,
): WireExit[] {
  void project;
  void findCellType;
  const d = SIDE[side];
  const out: WireExit[] = [];
  const holeR = holeMm / 2;
  const rPocket = holeR + MARGIN_MM; // gioco verso le tasche delle celle
  const rOut = holeR + Math.max(MARGIN_MM, chamferMm + 0.5); // gioco verso il bordo, smusso compreso
  const outlines = wall.map((r) => ({ outline: r.outline, holes: [] as Pt[][] }));
  const near = offsetRegions(outlines, OUTSIDE_MM);
  const deep = offsetRegions(outlines, -RIM_MM);
  const pockets = wall.flatMap((r) => r.holes.map((h) => ({ outline: h, holes: [] as Pt[][] })));
  const taken: Pt[] = [];
  for (const s of chosenStrips(strips)) {
    const node = frontNode(s, side);
    // punto di saldatura: sul lobo della lamella, dal lato di uscita, appena dentro il bordo
    const solder = { x: node.x + d.x * (node.reachMm - 0.7), y: node.y + d.y * (node.reachMm - 0.7) };
    const covering = strips.filter((o) => o.face === s.face).map((o) => ({ outline: o.outline, holes: o.holes }));
    let best: { p: Pt; score: number } | null = null;
    for (let dx = -SEARCH_MM; dx <= SEARCH_MM; dx += STEP_MM) {
      for (let dy = -SEARCH_MM; dy <= SEARCH_MM; dy += STEP_MM) {
        const c = { x: solder.x + dx, y: solder.y + dy };
        const dist = Math.hypot(dx, dy);
        if (dist > SEARCH_MM) continue;
        // il filo non torna indietro verso l'interno: il foro sta oltre il punto di saldatura o al suo fianco
        if (dx * d.x + dy * d.y < -2) continue;
        if (best && dist >= best.score) continue;
        // nella fascia lungo il bordo (o appena fuori, nell'incavo tra due celle), mai in una tasca
        if (!pointInRegions(c, near) || pointInRegions(c, deep) || pockets.some((q) => pointInRegions(c, [q]))) continue;
        if (taken.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 2 * rOut + 0.5)) continue;
        const disk = circlePoints(c.x, c.y, rPocket, 16);
        if (pockets.some((q) => intersectRegions(q, [disk]).some((x) => regionArea(x) > 0.01))) continue;
        if (covering.some((r) => intersectRegions(r, [disk]).some((x) => regionArea(x) > 0.01))) continue;
        best = { p: c, score: dist };
      }
    }
    if (!best) continue;
    taken.push(best.p);
    // se il gioco verso il bordo non sta nel contorno, si aggiunge un rinforzo attorno al foro
    const room = circlePoints(best.p.x, best.p.y, rOut, 16).every((q) => pointInRegions(q, wall));
    out.push({ stripId: s.id, face: s.face, side, solder, hole: best.p, diameterMm: holeMm, plateMm, floorMm, bossMm: room ? 0 : rOut + 0.3 });
  }
  return out;
}
