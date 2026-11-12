import { findBmsType, bmsOf } from './bms';
import { findCellType } from './catalog';
import { SIDE_VECTOR, type Pt } from './polygon';
import type { Face, Strip, TabSide } from './strips';
import { DEFAULT_BMS_MOUNT, type BmsMount, type BmsSize, type Project } from './types';

/**
 * BMS harness: where the BMS sits on the pack flank and how long each balance wire is.
 *
 * The BMS (or the harness exit point) sits on the flank on the tab side, at mid height, between the two plates.
 * Each wire leaves the hole of its folded tab, goes down (or up) along the edge to mid height and goes to the
 * connector: no wire crosses from one plate to the other. Node B0 is the pack negative, BS the positive.
 *
 * Scene coordinates: the drawing (x, y) becomes (X, Z), the height is Y.
 */

export interface Pt3 {
  x: number;
  y: number;
  z: number;
}

export interface HarnessWire {
  /** Node index: B0 = pack negative, B{S} = positive. */
  node: number;
  label: string;
  /** Strip and face it is welded to. */
  stripId: string;
  face: Face;
  /** Path: tab hole, descent, entry underneath, lane, (over the box edge), pad or connector. */
  points: Pt3[];
  /** Length along the path, mm. */
  lengthMm: number;
  /** Length to cut: path plus slack (and tail if external), rounded up to 5 mm. */
  cutMm: number;
}

export interface BmsBox {
  center: Pt3;
  /** Dimensions along the scene X, Y, Z, mm. */
  size: Pt3;
}

export interface Harness {
  mount: BmsMount;
  side: TabSide;
  /** Connector point (centre of the sockets), mm. */
  connector: Pt3;
  /** The BMS box (only when mounted on the pack and with known dimensions). */
  box: BmsBox | null;
  wires: HarnessWire[];
  totalCutMm: number;
  /** Whether the BMS board fits in the space it has on the pack; null with no box (external BMS or unknown dimensions). */
  fit: HarnessFit | null;
}

/** Board size against its place on the pack: how much it sticks out, in length and in height (0 = it fits). */
export interface HarnessFit {
  /** On the flank the board length runs along the flank; at the head it runs in depth, towards the exit side. */
  lengthKind: 'flank' | 'head';
  boardLengthMm: number;
  packLengthMm: number;
  lengthOverMm: number;
  boardWidthMm: number;
  packHeightMm: number;
  heightOverMm: number;
}

/** Pitch of the balance connector contacts (JST-XH), mm. */
export const CONNECTOR_PITCH_MM = 2.5;
/** Distance between the cell flank and the harness, mm. */
const WIRE_CLEARANCE_MM = 1.5;
/** At the head: distance between the board edge facing the flank and the wire lanes, mm. */
const HEAD_FLANK_GAP_MM = 1.5;
/** Distance between the BMS end and the balance connector when it sits beyond the end, mm. */
const CONNECTOR_END_GAP_MM = 3;
/** Margin between the end and the first pad on the top face, mm. */
const TOP_MARGIN_MM = 4;
/** Depth of the lanes from the cell flank and minimum depth distance between descent and lane, mm. */
const LANE_DEPTH_MM = 1;
const DEPTH_SEP_MM = 1;
/** Distance of the wire from the box edge while it goes over it, mm. */
const EDGE_GAP_MM = 2;
/** Distance between two wires in neighbouring lanes, mm. */
const WIRE_LANE_MM = 1.5;


/** How far the strip rests over the cell edge (the button sticks out): as in the 3D scene. */
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
 * `strips` are the strips with tabs (one per joint); `thicknessMm` is the strip thickness in the scene.
 * Null if there is no BMS or no tab.
 */
export function buildHarness(project: Project, strips: readonly Strip[], thicknessMm: number): Harness | null {
  const bms = bmsOf(project) ?? (project.bmsId ? findBmsType(project, project.bmsId) : undefined);
  const withTab = strips.filter((s) => s.tab || s.wireExit); // with a tab, or with the hole in the holder
  if (!bms || withTab.length === 0 || project.cells.length === 0) return null;
  const mount = bmsMountOf(project);
  const side = withTab[0]!.tab?.side ?? withTab[0]!.wireExit!.side;
  const d = SIDE_VECTOR[side];
  const perp = { x: -d.y, y: d.x };

  let height = 0;
  for (const c of project.cells) height = Math.max(height, findCellType(project, c.typeId)?.heightMm ?? 0);
  const lift = busbarLiftMm(project);
  const sheetTop = height + lift + thicknessMm; // top face: the bend starts here and goes down
  const sheetBottom = -lift - thicknessMm; // bottom face: it starts here and goes up
  const yMid = height / 2;

  // End of the flank along the exit direction and stretch occupied along the side.
  let edge = -Infinity;
  let aMin = Infinity;
  let pMin = Infinity;
  let pMax = -Infinity;
  for (const c of project.cells) {
    const r = (findCellType(project, c.typeId)?.diameterMm ?? 0) / 2;
    edge = Math.max(edge, c.x * d.x + c.y * d.y + r);
    aMin = Math.min(aMin, c.x * d.x + c.y * d.y - r);
    const p = c.x * perp.x + c.y * perp.y;
    pMin = Math.min(pMin, p - r);
    pMax = Math.max(pMax, p + r);
  }
  const aWire = edge + WIRE_CLEARANCE_MM;
  const aIn = edge + LANE_DEPTH_MM; // lane depth, close to the cells
  const size: BmsSize | undefined = bms.sizeMm;
  const box = mount.mode === 'pack' && size !== undefined;
  const aConn = aWire; // the connector is on the face of the BMS towards the pack
  const boxSize = box ? size : undefined;
  // At the head the box sits beyond one end of the flank (on the same row), and the wires come along the flank.
  const head = !!boxSize && mount.place === 'head';
  const headSgn = mount.connectorEnd === 'end' ? 1 : -1;
  // At the head the board sits against the pack end, turned 90°: its thickness is along the flank, its length
  // in depth (towards the exit side) and the edge facing the flank, flush with the lanes, carries the pads.
  const headT = boxSize?.thicknessMm ?? 0;
  const headL = boxSize?.lengthMm ?? 0;
  const pHead = headSgn > 0 ? pMax + WIRE_CLEARANCE_MM + headT / 2 : pMin - WIRE_CLEARANCE_MM - headT / 2;
  const aBoxCenter = aIn - HEAD_FLANK_GAP_MM - headL / 2;
  const pc = head ? pHead : pMin + mount.along * (pMax - pMin);
  // With the box known the wires arrive either on the top face (pad or connector: they go over the box edge above or below the
  // box) or at a connector beyond an end. Never behind: that is where the board is.
  const pins = withTab.length * CONNECTOR_PITCH_MM;
  const sgn = head ? -headSgn : mount.connectorEnd === 'end' ? 1 : -1; // at the head the pads are on the part of the box towards the pack
  const pEnd = boxSize ? pc + sgn * (boxSize.lengthMm / 2) : pc; // chosen end, along the side
  const onEnd = !!boxSize && !head && mount.connector === 'end';
  const onTop = !!boxSize && !onEnd;
  const pConn = head ? pHead : onEnd ? pEnd + sgn * (pins / 2 + CONNECTOR_END_GAP_MM) : onTop ? pEnd - sgn * Math.min(boxSize!.lengthMm / 2, pins / 2 + TOP_MARGIN_MM) : pc;
  const aTop = aConn + (boxSize?.thicknessMm ?? 0); // top face of the board
  const to3 = (a: number, p: number, y: number): Pt3 => ({ x: d.x * a + perp.x * p, y, z: d.y * a + perp.y * p });

  // One node per joint: B0 is the last (pack negative).
  const joints = withTab.map((s) => s.joint);
  const last = Math.max(...joints);
  const n = last + 1;
  // Lane of each wire among those of the same face: the one farthest from the BMS is on the lane closest to the box
  // (the lowest for the top face), the one from the nearest tab on the highest. This way the descents from the tabs
  // do not cross the others' lanes and the ribbon fans out as in photos of real packs.
  const startPt = (x: Strip): Pt => (x.tab ? { x: x.tab.holeX, y: x.tab.holeY } : (x.wireExit!.hole ?? x.wireExit!.edge ?? x.wireExit!.solder));
  const holeP = (x: Strip) => startPt(x).x * perp.x + startPt(x).y * perp.y;
  const faceRank = new Map<string, number>();
  for (const face of ['top', 'bottom'] as const) {
    const group = withTab.filter((x) => x.face === face);
    if (head) {
      // At the head the pads are in a row along the board, in node order: the wire of the innermost pad takes the lane farthest
      // from the board, so the descents onto the pads do not cross the others' lanes. The descents from the tabs
      // may cross the lanes: they pass at a different depth.
      group.sort((x, y) => y.joint - x.joint).forEach((x, i) => faceRank.set(x.id, group.length - 1 - i));
    } else {
      group.sort((x, y) => Math.abs(holeP(y) - pConn) - Math.abs(holeP(x) - pConn) || y.joint - x.joint).forEach((x, i) => faceRank.set(x.id, i));
    }
  }
  // Depth: lanes close to the cells, descents from the tabs further out, rise to the connector further out still.
  const bendAt = (s: Strip) =>
    s.tab ? ((s.tab.bend[0].x + s.tab.bend[1].x) / 2) * d.x + ((s.tab.bend[0].y + s.tab.bend[1].y) / 2) * d.y : ((s.wireExit!.hole ?? s.wireExit!.edge ?? s.wireExit!.solder).x * d.x + (s.wireExit!.hole ?? s.wireExit!.edge ?? s.wireExit!.solder).y * d.y) + 0.5;
  const aDown = Math.max(aIn + DEPTH_SEP_MM, ...withTab.map(bendAt));
  const aUp = aDown + DEPTH_SEP_MM;
  const wires: HarnessWire[] = withTab
    .map((s): HarnessWire => {
      const node = last - s.joint;
      const pPin = pConn + (node - (n - 1) / 2) * CONNECTOR_PITCH_MM;
      const len = (x: Pt3, y: Pt3) => Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z);
      const points: Pt3[] = [];
      let pHole: number;
      let yHole: number;
      let aOut: number;
      if (s.tab) {
        const tab = s.tab;
        const bend = { x: (tab.bend[0].x + tab.bend[1].x) / 2, y: (tab.bend[0].y + tab.bend[1].y) / 2 };
        const u = (tab.holeX - bend.x) * d.x + (tab.holeY - bend.y) * d.y; // from the fold to the hole, along the tab
        const aBend = bend.x * d.x + bend.y * d.y;
        pHole = tab.holeX * perp.x + tab.holeY * perp.y;
        yHole = s.face === 'top' ? sheetTop - u : sheetBottom + u;
        aOut = Math.max(aBend, aDown); // the descents are further out than the lanes
        points.push(to3(aBend, pHole, yHole));
      } else {
        // Without a tab: the wire leaves the solder point on the strip, goes to the holder hole, passes through it
        // (floor and walls) and leaves the inner edge of the plate, from where it goes down the flank.
        const ex = s.wireExit!;
        const top = s.face === 'top';
        const ySurf = top ? sheetTop + 0.3 : sheetBottom - 0.3;
        const solderA = ex.solder.x * d.x + ex.solder.y * d.y;
        const solderP = ex.solder.x * perp.x + ex.solder.y * perp.y;
        if (ex.hole) {
          const yInner = top ? height + ex.floorMm - ex.plateMm : -ex.floorMm + ex.plateMm;
          const aH = ex.hole.x * d.x + ex.hole.y * d.y;
          pHole = ex.hole.x * perp.x + ex.hole.y * perp.y;
          yHole = yInner;
          aOut = Math.max(aH, aDown);
          points.push(to3(solderA, solderP, ySurf), to3(aH, pHole, ySurf), to3(aH, pHole, yInner));
        } else {
          // Around route: from the solder point on the holder plane to the plate edge, then down along the flank.
          const aE = ex.edge!.x * d.x + ex.edge!.y * d.y;
          pHole = ex.edge!.x * perp.x + ex.edge!.y * perp.y;
          yHole = ySurf;
          aOut = Math.max(aE, aDown);
          points.push(to3(solderA, solderP, ySurf), to3(aE, pHole, ySurf));
        }
      }
      // Each wire has its own lane (height) and touches no other: it goes down (or up) along the pack edge, enters
      // underneath (towards the pack) where it must cross, runs on its lane and reaches the pad or connector. The descents
      // from the tabs and those onto the pads are at different depths from the lanes, so when they cross one wire
      // passes under the other.
      const lane = (faceRank.get(s.id) ?? 0) * WIRE_LANE_MM;
      const half = boxSize ? boxSize.widthMm / 2 : 0;
      const yE = s.face === 'top' ? Math.min(yHole, yMid + half + EDGE_GAP_MM + lane) : Math.max(yHole, yMid - half - EDGE_GAP_MM - lane);
      points.push(to3(aOut, pHole, yE), to3(aIn, pHole, yE));
      if (head) {
        // along the flank to the end, then towards the board above (or below) its edge and down (or up) onto the pad
        const aPad = aBoxCenter + (node - (n - 1) / 2) * CONNECTOR_PITCH_MM;
        const yEdge = s.face === 'top' ? yMid + half : yMid - half;
        points.push(to3(aIn, pHead, yE), to3(aPad, pHead, yE), to3(aPad, pHead, yEdge));
      } else points.push(to3(aIn, pPin, yE));
      if (head) {
        // already arrived at the pad
      } else if (onTop) points.push(to3(aTop + EDGE_GAP_MM, pPin, yE), to3(aTop, pPin, yMid));
      else points.push(to3(aUp, pPin, yE), to3(aUp, pPin, yMid)); // the rise to the connector is outside the lanes
      const lengthMm = points.slice(1).reduce((acc, q, i) => acc + len(points[i]!, q), 0);
      const extra = mount.slackMm + (mount.mode === 'external' ? mount.tailMm : 0);
      return {
        node,
        label: `B${node}`,
        stripId: s.id,
        face: s.face,
        points,
        lengthMm,
        cutMm: Math.ceil((lengthMm + extra) / 5 - 1e-9) * 5,
      };
    })
    .sort((a, b) => a.node - b.node);

  const connector = head ? to3(aBoxCenter, pHead, yMid) : to3(onTop ? aTop : aUp, pConn, yMid);
  let boxOut: BmsBox | null = null;
  if (box && size) {
    // Length along the side, width in height, thickness outwards; the face towards the pack is the connector's.
    const along = d.x === 0 ? { x: size.lengthMm, z: size.thicknessMm } : { x: size.thicknessMm, z: size.lengthMm };
    if (head) {
      // turned 90°: the thickness is along the flank, the length in depth
      const turned = d.x === 0 ? { x: headT, z: headL } : { x: headL, z: headT };
      boxOut = { center: to3(aBoxCenter, pHead, yMid), size: { x: turned.x, y: size.widthMm, z: turned.z } };
    } else {
      const out = to3(aConn + size.thicknessMm / 2, pc, yMid);
      boxOut = { center: out, size: { x: along.x, y: size.widthMm, z: along.z } };
    }
  }
  let fit: HarnessFit | null = null;
  if (boxSize) {
    const packLength = head ? edge - aMin : pMax - pMin; // at the head the board goes in depth, on the flank along the flank
    fit = {
      lengthKind: head ? 'head' : 'flank',
      boardLengthMm: boxSize.lengthMm,
      packLengthMm: packLength,
      lengthOverMm: Math.max(0, boxSize.lengthMm - packLength),
      boardWidthMm: boxSize.widthMm,
      packHeightMm: height,
      heightOverMm: Math.max(0, boxSize.widthMm - height),
    };
  }
  return { mount, side, connector, box: boxOut, wires, totalCutMm: wires.reduce((a, w) => a + w.cutMm, 0), fit };
}
