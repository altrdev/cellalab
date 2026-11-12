import { circlePoints, distToRect, SIDE_VECTOR, type Pt } from './polygon';
import { intersectRegions, offsetRegions, pointInRegions, regionArea, type Region } from './clip';
import { MIN_PRINT_WALL_MM } from './holder';
import { findCellType } from './catalog';
import { chosenStrips, frontNode, holderReach, type Face, type Strip, type StripNode, type TabSide } from './strips';
import type { Project } from './types';

/**
 * Exit of the balance wires from the holder, without tabs: the wire is soldered on the strip near its edge
 * towards the exit side, passes through a small hole in the holder next to the strip (through floor and walls) and
 * goes down along the flank. The hole is on the holder material (outside the cell pockets), under no
 * strip of the same face, as close as possible to the solder point.
 */
export interface WireExit {
  stripId: string;
  face: Face;
  side: TabSide;
  /** Solder point on the strip and centre of the hole in the holder, mm of the drawing. Without a hole (around route) the wire runs on the holder plane up to `edge`, the plate edge, and goes down along the flank. */
  solder: Pt;
  hole?: Pt;
  edge?: Pt;
  /** The corridor from the solder point to the edge passes over another strip or another cell opening. It is not an error (the wire is insulated): it is just a less tidy route, chosen after a free one. */
  blocked?: boolean;
  diameterMm: number;
  /** Thickness of the plate and its floor, mm: the wire enters from the outer face and leaves from the wall rim. */
  plateMm: number;
  floorMm: number;
  /** Radius of the boss to add to the outline around the hole (only with the cell profile, where the plastic between cells is thin); 0 = not needed. */
  bossMm?: number;
}

/** Plastic that must remain around the hole towards the cell pockets: at least a printable wall, mm. */
const MARGIN_MM = MIN_PRINT_WALL_MM;
/** The hole lies in the band along the edge this wide: further in, the wire would stay trapped between the cells, mm. */
const RIM_MM = 7;
/** With the boss the hole can sit this far outside the outline (in the notch between two cells), mm. */
const OUTSIDE_MM = 4;
/** How far from the solder point the hole is searched for, mm. */
const SEARCH_MM = 24;
const STEP_MM = 0.5;
/** How much, in choosing the hole, the lateral distance from the solder point weighs against being on the edge (mm of edge per mm of distance). */
const LATERAL_WEIGHT = 0.15;

/**
 * `wall` is the solid outline of the holder (walls with the cell pockets as holes), `plateMm`/`floorMm` its
 * thickness. Returns one exit per joint; a joint with no room for the hole gets none.
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
  allowBoss = false,
): WireExit[] {
  void project;
  const d = SIDE_VECTOR[side];
  const out: WireExit[] = [];
  const holeR = holeMm / 2;
  const rPocket = holeR + MARGIN_MM; // clearance towards the cell pockets
  const rOut = holeR + MARGIN_MM; // and towards the edge: the hole sits as close to the edge as possible, with a printable wall
  const outlines = wall.map((r) => ({ outline: r.outline, holes: [] as Pt[][] }));
  const deep = offsetRegions(outlines, -RIM_MM);
  const pockets = wall.flatMap((r) => r.holes.map((h) => ({ outline: h, holes: [] as Pt[][] })));
  const taken: Pt[] = [];
  for (const s of chosenStrips(strips)) {
    const node = frontNode(s, side);
    // solder point: on the strip lobe, on the exit side, just inside the edge
    const solder = { x: node.x + d.x * (node.reachMm - 0.7), y: node.y + d.y * (node.reachMm - 0.7) };
    const covering = strips.filter((o) => o.face === s.face).map((o) => ({ outline: o.outline, holes: o.holes }));
    // Candidates near the solder point, from the most on the edge (the furthest towards the exit side) to the least; ties
    // go to lateral closeness to the solder. Then check from the first down.
    const cands: { c: Pt; score: number }[] = [];
    for (let dx = -SEARCH_MM; dx <= SEARCH_MM; dx += STEP_MM) {
      for (let dy = -SEARCH_MM; dy <= SEARCH_MM; dy += STEP_MM) {
        const c = { x: solder.x + dx, y: solder.y + dy };
        const dist = Math.hypot(dx, dy);
        if (dist > SEARCH_MM) continue;
        if (dx * d.x + dy * d.y < -2) continue; // the wire does not go back inwards
        if (!pointInRegions(c, wall) || pointInRegions(c, deep)) continue; // on the material, in the band along the edge
        cands.push({ c, score: -(c.x * d.x + c.y * d.y) + LATERAL_WEIGHT * dist });
      }
    }
    cands.sort((u, v) => u.score - v.score);
    let found: Pt | null = null;
    for (const { c } of cands) {
      if (taken.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 2 * rOut + 0.5)) continue;
      if (!circlePoints(c.x, c.y, rOut, 16).every((q) => pointInRegions(q, outlines))) continue; // clearance towards the edge
      const disk = circlePoints(c.x, c.y, rPocket, 16);
      if (pockets.some((q) => intersectRegions(q, [disk]).some((x) => regionArea(x) > 0.01))) continue;
      if (covering.some((r) => intersectRegions(r, [disk]).some((x) => regionArea(x) > 0.01))) continue;
      found = c;
      break;
    }
    let bossMm = 0;
    if (!found && allowBoss) {
      // Cell profile: the plastic between the cells is not enough, so a round boss is added to the outline around the
      // hole (which sits as close as possible to the solder point, even in the notch just outside the outline).
      const rBoss = holeR + Math.max(MARGIN_MM, chamferMm + 0.5);
      const near = offsetRegions(outlines, OUTSIDE_MM);
      const byDist: { c: Pt; dist: number }[] = [];
      for (let dx = -SEARCH_MM; dx <= SEARCH_MM; dx += STEP_MM) {
        for (let dy = -SEARCH_MM; dy <= SEARCH_MM; dy += STEP_MM) {
          const c = { x: solder.x + dx, y: solder.y + dy };
          const dist = Math.hypot(dx, dy);
          if (dist > SEARCH_MM || dx * d.x + dy * d.y < -2) continue;
          if (!pointInRegions(c, near) || pointInRegions(c, deep) || pockets.some((q) => pointInRegions(c, [q]))) continue;
          byDist.push({ c, dist });
        }
      }
      byDist.sort((u, v) => u.dist - v.dist);
      for (const { c } of byDist) {
        if (taken.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 2 * rBoss + 0.5)) continue;
        const disk = circlePoints(c.x, c.y, rPocket, 16);
        if (pockets.some((q) => intersectRegions(q, [disk]).some((x) => regionArea(x) > 0.01))) continue;
        if (covering.some((r) => intersectRegions(r, [disk]).some((x) => regionArea(x) > 0.01))) continue;
        found = c;
        const room = circlePoints(c.x, c.y, rBoss, 16).every((q) => pointInRegions(q, wall));
        bossMm = room ? 0 : rBoss + 0.3;
        break;
      }
    }
    if (!found) continue;
    taken.push(found);
    out.push({ stripId: s.id, face: s.face, side, solder, hole: found, diameterMm: holeMm, plateMm, floorMm, bossMm });
  }
  return out;
}

/**
 * Around route, with no hole or tab: the wire is soldered on the strip, near the edge on the exit side, runs in a
 * straight line on the holder plane to the plate edge and from there goes down along the flank, outside. A
 * free corridor is preferred (no other strip of the face, no opening of another cell) because the wire
 * stays tidy and does not get squashed; the wire is insulated, so passing over a strip is not a short.
 */
export function findAroundExits(
  project: Project,
  strips: readonly Strip[],
  wall: readonly Region[],
  side: TabSide,
  plateMm: number,
  floorMm: number,
  bendMm = 0.5,
  only?: ReadonlySet<string>,
): WireExit[] {
  const d = SIDE_VECTOR[side];
  const pp = { x: -d.y, y: d.x };
  const outlines = wall.map((r) => ({ outline: r.outline, holes: [] as Pt[][] }));
  const out: WireExit[] = [];
  for (const s of chosenStrips(strips)) {
    if (only && !only.has(s.id)) continue;
    const own = new Set(s.nodes.map((n) => n.cellId));
    const others = strips.filter((o) => o !== s && o.face === s.face).map((o) => ({ outline: o.outline, holes: o.holes }));
    const nodes = [...s.nodes].sort((p, q) => q.x * d.x + q.y * d.y + q.reachMm - (p.x * d.x + p.y * d.y + p.reachMm));
    let best: WireExit | null = null;
    outer: for (const node of nodes.slice(0, 3)) {
      for (const deg of [0, 25, -25, 50, -50]) {
        const ang = Math.atan2(d.y, d.x) + (deg * Math.PI) / 180;
        const solder = { x: node.x + Math.cos(ang) * (node.reachMm - 0.7), y: node.y + Math.sin(ang) * (node.reachMm - 0.7) };
        // how far the holder reaches going out from the solder point in a straight line towards the exit side
        const last = Math.max(0, holderReach(solder, d, [0], outlines));
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

/**
 * Holes in the holder where there is room; joints with no room for the hole (plastic too thin between the cells) take the
 * around route on the holder plane, so no wire is missing.
 */
export function findWireRoutes(
  project: Project,
  strips: readonly Strip[],
  wall: readonly Region[],
  side: TabSide,
  holeMm: number,
  plateMm: number,
  floorMm: number,
  bendMm = 0.5,
  chamferMm = 0,
  allowBoss = false,
): WireExit[] {
  const holed = findWireExits(project, strips, wall, side, holeMm, plateMm, floorMm, chamferMm, allowBoss);
  const have = new Set(holed.map((e) => e.stripId));
  const missing = new Set(chosenStrips(strips).filter((x) => !have.has(x.id)).map((x) => x.id));
  return missing.size === 0 ? holed : [...holed, ...findAroundExits(project, strips, wall, side, plateMm, floorMm, bendMm, missing)];
}
