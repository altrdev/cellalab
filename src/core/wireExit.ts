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
  /** Punto di saldatura sulla lamella e centro del foro nel portacelle, mm del disegno. Senza foro (giro esterno) il filo corre sul piano del portacelle fino a `edge`, il bordo della piastra, e scende lungo il fianco. */
  solder: Pt;
  hole?: Pt;
  edge?: Pt;
  /** Il corridoio dal punto di saldatura al bordo passa sopra un'altra lamella o un'altra apertura di cella. */
  blocked?: boolean;
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
/** Un foro che chiede un rinforzo del contorno vale come se fosse così più lontano dal punto di saldatura, mm: si preferisce un posto dove la plastica basta. */
const BOSS_PENALTY_MM = 8;

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
    let best: { p: Pt; score: number; room: boolean } | null = null;
    for (let dx = -SEARCH_MM; dx <= SEARCH_MM; dx += STEP_MM) {
      for (let dy = -SEARCH_MM; dy <= SEARCH_MM; dy += STEP_MM) {
        const c = { x: solder.x + dx, y: solder.y + dy };
        const dist = Math.hypot(dx, dy);
        if (dist > SEARCH_MM) continue;
        // il filo non torna indietro verso l'interno: il foro sta oltre il punto di saldatura o al suo fianco
        if (dx * d.x + dy * d.y < -2) continue;
        if (best && dist >= best.score) continue; // la distanza da sola è già un limite inferiore del punteggio
        // nella fascia lungo il bordo (o appena fuori, nell'incavo tra due celle), mai in una tasca
        if (!pointInRegions(c, near) || pointInRegions(c, deep) || pockets.some((q) => pointInRegions(c, [q]))) continue;
        if (taken.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 2 * rOut + 0.5)) continue;
        const disk = circlePoints(c.x, c.y, rPocket, 16);
        if (pockets.some((q) => intersectRegions(q, [disk]).some((x) => regionArea(x) > 0.01))) continue;
        if (covering.some((r) => intersectRegions(r, [disk]).some((x) => regionArea(x) > 0.01))) continue;
        // se il gioco verso il bordo non sta nel contorno servirà un rinforzo: meglio un altro posto, se c'è
        const room = circlePoints(c.x, c.y, rOut, 16).every((q) => pointInRegions(q, wall));
        const score = dist + (room ? 0 : BOSS_PENALTY_MM);
        if (!best || score < best.score) best = { p: c, score, room };
      }
    }
    if (!best) continue;
    taken.push(best.p);
    const room = best.room;
    out.push({ stripId: s.id, face: s.face, side, solder, hole: best.p, diameterMm: holeMm, plateMm, floorMm, bossMm: room ? 0 : rOut + 0.3 });
  }
  return out;
}

/** Distanza di un punto da un rettangolo convesso (0 se dentro). */
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

/**
 * Giro esterno, senza foro né linguetta: il filo si salda sulla lamella, vicino al bordo dal lato di uscita, corre in
 * linea retta sul piano del portacelle fino al bordo della piastra e da lì scende lungo il fianco, all'esterno. Il
 * corridoio deve essere libero: nessun'altra lamella della faccia e nessuna apertura di un'altra cella.
 */
export function findAroundExits(
  project: Project,
  strips: readonly Strip[],
  wall: readonly Region[],
  side: TabSide,
  plateMm: number,
  floorMm: number,
  bendMm = 0.5,
): WireExit[] {
  const d = SIDE[side];
  const pp = { x: -d.y, y: d.x };
  const outlines = wall.map((r) => ({ outline: r.outline, holes: [] as Pt[][] }));
  const out: WireExit[] = [];
  for (const s of chosenStrips(strips)) {
    const own = new Set(s.nodes.map((n) => n.cellId));
    const others = strips.filter((o) => o !== s && o.face === s.face).map((o) => ({ outline: o.outline, holes: o.holes }));
    const nodes = [...s.nodes].sort((p, q) => q.x * d.x + q.y * d.y + q.reachMm - (p.x * d.x + p.y * d.y + p.reachMm));
    let best: WireExit | null = null;
    outer: for (const node of nodes.slice(0, 3)) {
      for (const deg of [0, 25, -25, 50, -50]) {
        const ang = Math.atan2(d.y, d.x) + (deg * Math.PI) / 180;
        const solder = { x: node.x + Math.cos(ang) * (node.reachMm - 0.7), y: node.y + Math.sin(ang) * (node.reachMm - 0.7) };
        // fin dove arriva il portacelle uscendo dal punto di saldatura in linea retta verso il lato di uscita
        let last = 0;
        for (let a = 0; a <= 80; a += 0.25) if (pointInRegions({ x: solder.x + d.x * a, y: solder.y + d.y * a }, outlines)) last = a;
        const reach = last + bendMm;
        const w = 1.2;
        const corridor = [
          { x: solder.x + pp.x * w, y: solder.y + pp.y * w },
          { x: solder.x - pp.x * w, y: solder.y - pp.y * w },
          { x: solder.x - pp.x * w + d.x * reach, y: solder.y - pp.y * w + d.y * reach },
          { x: solder.x + pp.x * w + d.x * reach, y: solder.y + pp.y * w + d.y * reach },
        ];
        const cover = others.some((o) => intersectRegions(o, [corridor]).some((x) => regionArea(x) > 0.01));
        const openings = project.cells.some((c) => {
          if (own.has(c.id)) return false;
          const r = (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2;
          return distToRect(c, corridor) < r - 0.8;
        });
        const cand: WireExit = {
          stripId: s.id,
          face: s.face,
          side,
          solder,
          edge: { x: solder.x + d.x * reach, y: solder.y + d.y * reach },
          blocked: cover || openings,
          diameterMm: 0,
          plateMm,
          floorMm,
          bossMm: 0,
        };
        if (!cand.blocked) {
          best = cand;
          break outer;
        }
        best ??= cand;
      }
    }
    if (best) out.push(best);
  }
  return out;
}
