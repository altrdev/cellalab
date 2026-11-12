import { MIN_PRINT_WALL_MM, type HolderSettings } from './holder';
import { SIDE_VECTOR, type Pt } from './polygon';
import { tabsOf, type Face, type Strip } from './strips';
import { findAwg } from './wire';

/** Side clearance between tab and groove, mm. */
const SIDE_CLEARANCE_MM = 0.3;
/** Extra space beyond the wire: the folded tab and the solder, mm. */
const DEPTH_EXTRA_MM = 0.2;
/** A groove thinner than this is useless. */
const MIN_DEPTH_MM = 0.3;


export interface Notch {
  stripId: string;
  /** Strip face: the groove is only for the plate of that face. */
  face: Face;
  polygon: Pt[];
  /** Actual depth into the wall, mm. */
  depthMm: number;
  /** The wire sticks out of the groove: the wall is too thin to house all of it. */
  shallow: boolean;
}

/**
 * Grooves on the holder edge where the folded tab and its wire rest. Depth: as much as
 * the wire needs (chosen AWG), but the wall must stay at least `MIN_PRINT_WALL_MM`. They start from the theoretical edge of the
 * wall of the cell the tab leaves from and go outwards. If the tab is obstructed (passes over other
 * cells) there is no groove: it would cut the walls of the neighbouring cells.
 */
export function tabNotches(strips: readonly Strip[], holder: HolderSettings, wires: { balanceAwg: number; powerAwg: number }): Notch[] {
  const out: Notch[] = [];
  const maxDepth = holder.wallMm - MIN_PRINT_WALL_MM;
  for (const s of strips) {
    for (const tab of tabsOf(s)) {
      // A tab passing over other cells or strips has no free edge to sit on: no groove.
      if (tab.blockedBy) continue;
      const node = s.nodes.find((n) => Math.hypot(n.x - tab.anchor.x, n.y - tab.anchor.y) < 1e-6);
      if (!node) continue;
      const wanted = findAwg(tab.kind === 'power' ? wires.powerAwg : wires.balanceAwg).outerMm + DEPTH_EXTRA_MM;
      const depth = Math.min(wanted, maxDepth);
      if (depth < MIN_DEPTH_MM) continue;
      const d = SIDE_VECTOR[tab.side];
      const perp = { x: -d.y, y: d.x };
      const a0 = node.cellRadiusMm + holder.clearanceMm + holder.wallMm - depth;
      const a1 = a0 + depth + 2;
      const v = tab.widthMm / 2 + SIDE_CLEARANCE_MM;
      const at = (a: number, p: number): Pt => ({ x: tab.anchor.x + d.x * a + perp.x * p, y: tab.anchor.y + d.y * a + perp.y * p });
      out.push({ stripId: s.id, face: s.face, polygon: [at(a0, -v), at(a1, -v), at(a1, v), at(a0, v)], depthMm: depth, shallow: depth < wanted - 1e-9 });
    }
  }
  return out;
}
