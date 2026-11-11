import { boundsOfCells } from './geometry';
import type { Project } from './types';

export interface Offset {
  dx: number;
  dy: number;
}

/**
 * Spostamenti per la vista esplosa: ogni cella si allontana dal centro del pacco lungo la
 * retta che le unisce, in proporzione alla distanza. La cella più lontana si sposta esattamente
 * di `distanceMm`; la proporzione conserva la forma del pacco e le celle non si sovrappongono.
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
