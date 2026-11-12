import { replaceCells } from './ops';
import { runDrc } from './drc';
import { generateGrid } from './layout';
import { createProject } from './project';
import type { Project } from './types';

export type P3 = { x: number; y: number; z: number };
/** Points every 0.1 mm along a 3D polyline. */
export function samplePath(pts: readonly P3[]): P3[] {
  const out: P3[] = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
    for (let t = 0; t <= steps; t++) out.push({ x: a.x + ((b.x - a.x) * t) / steps, y: a.y + ((b.y - a.y) * t) / steps, z: a.z + ((b.z - a.z) * t) / steps });
  }
  return out;
}
/** The minimum distance between two different paths. */
export function closestApart(paths: readonly (readonly P3[])[]): number {
  let closest = Infinity;
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) for (const a of paths[i]!) for (const b of paths[j]!) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  return closest;
}


export const T = '21700-5000-10a';
export const pack = (s: number, p: number): Project =>
  replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: s, parallel: p, kind: 'hex', gapMm: 1 }));
export const codes = (p: Project) => runDrc(p).map((i) => i.code);
