import { boundsOfCells } from './geometry';
import type { Project } from './types';

export interface Offset {
  dx: number;
  dy: number;
}

/**
 * Offsets for the exploded view: each cell moves away from the pack centre along the
 * line joining them, in proportion to the distance. The farthest cell moves exactly
 * `distanceMm`; the proportion preserves the pack shape and the cells do not overlap.
 */
export function explodeOffsets(project: Project, distanceMm: number): Map<string, Offset> {
  const out = new Map<string, Offset>();
  const b = boundsOfCells(project);
  if (!b || !(distanceMm > 0)) return out;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  let maxR = 0;
  for (const c of project.cells) maxR = Math.max(maxR, Math.hypot(c.x - cx, c.y - cy));
  if (maxR === 0) return out;
  const k = distanceMm / maxR;
  for (const c of project.cells) out.set(c.id, { dx: (c.x - cx) * k, dy: (c.y - cy) * k });
  return out;
}
