import { findCellType } from './catalog';
import { bmsOf } from './bms';
import { intersectRegions, pointInRegions, regionArea, unionPolygons, type Region } from './clip';
import { circlePoints, convexHull, distToRect, SIDE_VECTOR, type Pt } from './polygon';
import type { PlacedCell, Project } from './types';

/**
 * Automatic generation of the strips from the topology.
 *
 * Every terminal of every cell belongs to exactly one strip:
 *  - joint 0: pack + terminal (the + of the first group);
 *  - joint k (1..G-1): connects the − of group k-1 with the + of group k (series connection);
 *  - joint G: pack − terminal (the − of the last group).
 * For each joint one strip is generated per face ("Top" = the face the pole
 * pointing up looks at, "Bottom" = the opposite face).
 *
 * Shape: a round support on each cell and a band of adjustable width between each pair of
 * neighbouring cells. Windows (triangles or rectangles) remain between the bands; widening the bands the
 * windows close and the strip becomes solid.
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
  /** Radius of the area where it can be welded, mm. */
  contactRadiusMm: number;
  /** Cell radius, mm. */
  cellRadiusMm: number;
  /** Radius of the support around the cell centre (contact + rim). */
  reachMm: number;
}

export type TabSide = 'top' | 'bottom' | 'left' | 'right';

/** Grip tab for the BMS balance wire: it sticks out of the strip (and is part of it) and has a hole. */
export interface StripTab {
  /** Balance (one per joint) or power (cable of P+ and P−). */
  kind: 'balance' | 'power';
  side: TabSide;
  /** Centre of the cell it starts from and effective width, mm. */
  anchor: Pt;
  widthMm: number;
  /** Rectangle of the tab, mm of the drawing. */
  rect: Pt[];
  /** Centre and diameter of the wire hole. */
  holeX: number;
  holeY: number;
  holeDiameterMm: number;
  /** Recommended fold line (past the holder edge, before the hole), to mark and not to cut. */
  bend: [Pt, Pt];
  /** What obstructs the tab: another strip on the same face or a cell; null = free. */
  blockedBy: 'strip' | 'cell' | null;
}

export interface Strip {
  id: string;
  face: Face;
  joint: number;
  kind: StripKind;
  label: string;
  /** Indices of the connected groups (1 for the terminals, 2 for the series). */
  groups: number[];
  nodes: StripNode[];
  /** Wire exit from the holder without tabs (put there by the UI, which knows the holder). */
  wireExit?: import('./wireExit').WireExit;
  /** Power tab (only P+ and P−, if on): next to the balance one, with the hole for the cable. */
  powerTab?: StripTab;
  /** Outer outline, positive area, in mm of the drawing (convex if the shape is solid). */
  outline: Pt[];
  /** Empty windows between the bands. */
  holes: Pt[][];
  /** Width of the bands between neighbouring cells, mm. */
  bandMm: number;
  /**
   * Free length of the longest band between two supports (distance between the edges of the welded contacts), mm:
   * it is the stretch that heats up, with the ends held by the cells. With a single cell there are no bands:
   * the support diameter is used.
   */
  bandLengthMm: number;
  /** How many cells in parallel share the current: each band carries about I/P. */
  parallelCount: number;
  areaMm2: number;
  /** Present only on the strips that carry a balance wire (with a BMS chosen). */
  tab?: StripTab;
  /** True if one of the two sides of a series connection is missing (e.g. a group with mixed polarities). */
  partial: boolean;
}

export interface StripOptions {
  /** Metal left beyond the weld area, mm: spots must not be on the cut (more rim = rounder corners). */
  marginMm?: number;
  /** Diameter of the weld area on the cell, mm (the rim is added outside); absent = the button. */
  contactDiameterMm?: number | null;
  /** Width of the bands between neighbouring cells, mm; absent = automatic (60% of the support). */
  widthMm?: number | null;
  /** Grip tabs for the BMS: only if the project has a BMS; absent or null = none. */
  tabs?: TabOptions | null;
  /** Outer outline of the holder (without the pockets): the fold lies beyond this limit. Absent = default wall and clearance. */
  /** Holder outline, to put the fold beyond the edge: one for all the strips or one per face (the two plates may have different grooves). */
  holderOutline?: readonly Region[] | Partial<Record<Face, readonly Region[]>> | null;
}

export interface TabOptions {
  side: TabSide;
  widthMm: number;
  /** Length of the folded part, beyond the fold line, mm. */
  lengthMm: number;
  holeMm: number;
  /** 'tab' (default): balance tab for each joint; 'none': none (the P+ and P− power tabs remain). */
  style?: 'tab' | 'none';
  /** Power cable tab on P+ and P−; absent = none. */
  power?: { widthMm: number; holeMm: number } | null;
  /** Margin of the fold beyond the holder edge, mm. */
  bendMm: number;
}

export const DEFAULT_STRIP_MARGIN_MM = 1;
/** Without the holder, how far its wall sticks out from the cell (wall 1.6 + clearance 0.15), mm. */
const DEFAULT_HOLDER_EDGE_MM = 1.75;
/** Longest side of the segments approximating a circle, mm: under 0.01 mm of deviation from the true circle. */
const MAX_CHORD_MM = 0.4;
/** Segments for a circle of radius `r`: one side at most `MAX_CHORD_MM` long, a multiple of 4 to touch the axes. */
const circleSegments = (r: number) => Math.min(240, Math.max(48, Math.ceil((2 * Math.PI * r) / MAX_CHORD_MM / 4) * 4));

/** Pole a cell exposes on a face. */
export function poleOnFace(cell: Pick<PlacedCell, 'plusUp'>, face: Face): Pole {
  const topPole: Pole = cell.plusUp ? '+' : '-';
  if (face === 'top') return topPole;
  return topPole === '+' ? '-' : '+';
}

/**
 * Radius of the weldable area. + pole: only the button (about 41% of the radius); − pole: the flat
 * bottom, leaving 1.5 mm of rim.
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
    // Single weld area for all the cells (as done by hand): by default the button, or the chosen Ø
    // (with a limit so that support and rim stay inside the cell). The support is the area plus the rim.
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
      // The terminals collect the current of several cells: the band is never narrower than the support.
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


/** One strip per joint, preferably the complete one on the top face (as for the tabs). */
export function chosenStrips(strips: readonly Strip[]): Strip[] {
  const byJoint = new Map<number, Strip>();
  for (const s of strips) {
    const cur = byJoint.get(s.joint);
    const better = !cur || (cur.partial && !s.partial) || (cur.partial === s.partial && cur.face === 'bottom' && s.face === 'top');
    if (better) byJoint.set(s.joint, s);
  }
  return [...byJoint.values()];
}

/** The strip node that reaches furthest towards `side` (ties: the most central). */
export function frontNode(s: Strip, side: TabSide): StripNode {
  const d = SIDE_VECTOR[side];
  const pp = { x: -d.y, y: d.x };
  const fwd = (n: StripNode) => n.x * d.x + n.y * d.y + n.reachMm;
  const sd = (n: StripNode) => n.x * pp.x + n.y * pp.y;
  const mean = s.nodes.reduce((a, n) => a + sd(n), 0) / s.nodes.length;
  return [...s.nodes].sort((p, q) => (Math.abs(fwd(p) - fwd(q)) > 1e-6 ? fwd(q) - fwd(p) : Math.abs(sd(p) - mean) - Math.abs(sd(q) - mean)))[0]!;
}

/** How far (mm) the holder reaches going out from `from` along `dir`, looking at the points shifted sideways by each of the `offsets`; -1 if never. */
export function holderReach(from: Pt, dir: Pt, offsets: readonly number[], regions: readonly Region[]): number {
  const pp = { x: -dir.y, y: dir.x };
  let last = -1;
  for (let a = 0; a <= 80; a += 0.25) {
    if (offsets.some((v) => pointInRegions({ x: from.x + dir.x * a + pp.x * v, y: from.y + dir.y * a + pp.y * v }, regions))) last = a;
  }
  return last;
}

/**
 * One balance wire per joint (S+1 in all): on the complete strip, preferably of the top
 * face. The tab starts from the cell nearest the chosen side and sticks out; width and hole adapt
 * to the support. P+ and P− also have the power tab: it exits at 90° to the balance one, from the free side
 * nearest the strip.
 */
function addTabs(project: Project, strips: Strip[], o: TabOptions, holderOpt: StripOptions['holderOutline']): void {
  const chosen = new Set(chosenStrips(strips));
  const sidesAcross: Record<TabSide, TabSide[]> = { top: ['left', 'right'], bottom: ['left', 'right'], left: ['top', 'bottom'], right: ['top', 'bottom'] };
  const cellR = (c: { typeId: string }) => (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2;
  // How far the pack extends in a direction, to choose the side nearest a strip.
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
  /** A quick guess at obstruction (cells of other joints and other strips of the face); the final check is further below. */
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
      // The free side nearest the pack edge; if both are obstructed, the nearest anyway.
      cands.sort((p, q) => Number(p.isBlocked) - Number(q.isBlocked) || p.gap - q.gap);
      const c = cands[0]!;
      plans.push({ kind: 'power', side: c.side, node: c.node, w: c.w, holeWant: pw.holeMm, lengthMm, rect: [] });
    }

    // How far the holder reaches along the tab (centre and two edges): the fold lies beyond.
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
      const hc = at(bendAlong + pl.lengthMm / 2, 0); // the hole is halfway along the folded part
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
  // Obstructions: cells of the other side and strips on the same face (with their tabs).
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

/** The tabs of a strip: the balance one and, on P+ and P−, the power one. */
export const tabsOf = (s: Strip): StripTab[] => [s.tab, s.powerTab].filter((t): t is StripTab => t !== undefined);

/** Useful width where the current flows: that of the bands between the cells. */
export const neckWidthMm = (strip: Strip): number => strip.bandMm;

/**
 * Pairs of neighbouring cells: all those at a distance of at most 1.2 times the minimum (in the honeycomb
 * they are the six neighbours, in the square lattice the four). If separate pieces remained, the
 * shortest connections are added to join them.
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
