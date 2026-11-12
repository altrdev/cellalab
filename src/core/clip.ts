import ClipperLib from 'clipper-lib';
import type { Pt } from './polygon';

/**
 * 2D geometry for non-convex strips (with windows): union of polygons, offset (cut
 * compensation) and distance. Relies on Clipper, which works with integers: here microns are used.
 */

const S = 1000; // 1 mm = 1000 units
const { Clipper, ClipperOffset, ClipType, EndType, JoinType, PolyFillType, PolyType } = ClipperLib;

/** A shape with an outer outline and zero or more holes. */
export interface Region {
  outline: Pt[];
  holes: Pt[][];
}

type IPath = { X: number; Y: number }[];

const toPath = (pts: readonly Pt[]): IPath => pts.map((p) => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
const fromPath = (path: IPath): Pt[] => path.map((q) => ({ x: q.X / S, y: q.Y / S }));
/** Outer outlines have positive area, holes negative area. */
function oriented(path: IPath, positive: boolean): IPath {
  if (Clipper.Orientation(path) !== positive) path.reverse();
  return path;
}
const toPaths = (region: Region): IPath[] => [
  oriented(toPath(region.outline), true),
  ...region.holes.map((h) => oriented(toPath(h), false)),
];

function split(paths: IPath[]): Region {
  let outline: Pt[] = [];
  let best = 0;
  const holes: Pt[][] = [];
  for (const p of paths) {
    const a = Clipper.Area(p);
    if (a > best) {
      best = a;
      outline = fromPath(p);
    } else if (a < 0) holes.push(fromPath(p));
  }
  return { outline, holes };
}

/** Union of polygons (even overlapping or non-convex ones). */
export function unionPolygons(polys: readonly (readonly Pt[])[]): Region {
  const c = new Clipper();
  let any = false;
  for (const poly of polys) {
    if (poly.length < 3) continue;
    c.AddPaths([oriented(toPath(poly), true)], PolyType.ptSubject, true);
    any = true;
  }
  if (!any) return { outline: [], holes: [] };
  const out = new ClipperLib.Paths();
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return split(out);
}

/** Moves the edges by `d` mm outwards (negative = inwards); holes shrink. */
export function offsetRegion(region: Region, d: number): Region {
  if (d === 0) return { outline: region.outline.map((p) => ({ ...p })), holes: region.holes.map((h) => h.map((p) => ({ ...p }))) };
  const co = new ClipperOffset(2, 2);
  co.AddPaths(toPaths(region), JoinType.jtRound, EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, d * S);
  return split(out);
}

/** Area in mm² (contorno meno buchi). */
export function regionArea(region: Region): number {
  const a = (pts: readonly Pt[]) => Math.abs(Clipper.Area(toPath(pts))) / (S * S);
  return a(region.outline) - region.holes.reduce((s, h) => s + a(h), 0);
}

/** All the outlines to draw or cut: the outside first, then the holes. */
export const regionRings = (region: Region): Pt[][] => [region.outline, ...region.holes];

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Minimum distance between two shapes, 0 if they overlap or one contains the other. */
export function regionDistance(a: Region, b: Region): number {
  const c = new Clipper();
  c.AddPaths(toPaths(a), PolyType.ptSubject, true);
  c.AddPaths(toPaths(b), PolyType.ptClip, true);
  const common = new ClipperLib.Paths();
  c.Execute(ClipType.ctIntersection, common, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  if ((common as IPath[]).some((p) => Clipper.Area(p) > 0)) return 0;
  let best = Infinity;
  const rings = (r: Region) => regionRings(r).filter((x) => x.length > 1);
  for (const ra of rings(a)) {
    for (const rb of rings(b)) {
      for (let i = 0; i < ra.length; i++) {
        const a1 = ra[i]!;
        const a2 = ra[(i + 1) % ra.length]!;
        for (let j = 0; j < rb.length; j++) {
          const b1 = rb[j]!;
          const b2 = rb[(j + 1) % rb.length]!;
          best = Math.min(best, segDist(a1, b1, b2), segDist(a2, b1, b2), segDist(b1, a1, a2), segDist(b2, a1, a2));
        }
      }
    }
  }
  return best;
}

/** Circle as a polygon (counter-clockwise), with enough sides to stay smooth even when printed. */
export function circlePolygon(cx: number, cy: number, r: number, segments = Math.max(48, Math.min(120, Math.round(r * 4)))): Pt[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (2 * Math.PI * i) / segments;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/** Arranges outlines and holes into separate shapes: each hole goes into the smallest outline that contains it. */
function splitAll(paths: IPath[]): Region[] {
  const outers: { path: IPath; area: number; region: Region }[] = [];
  const holes: IPath[] = [];
  for (const p of paths) {
    const a = Clipper.Area(p);
    if (a > 0) outers.push({ path: p, area: a, region: { outline: fromPath(p), holes: [] } });
    else if (a < 0) holes.push(p);
  }
  for (const h of holes) {
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) {
      if (Clipper.PointInPolygon(h[0]!, o.path) !== 0 && (!best || o.area < best.area)) best = o;
    }
    best?.region.holes.push(fromPath(h));
  }
  return outers.map((o) => o.region);
}

/**
 * Subtracts polygons from a shape. May give several shapes (islands left inside holes),
 * each with its own holes.
 */
export function differenceRegions(subject: Region | readonly Region[], cuts: readonly (readonly Pt[])[]): Region[] {
  const c = new Clipper();
  for (const r of Array.isArray(subject) ? (subject as readonly Region[]) : [subject as Region]) c.AddPaths(toPaths(r), PolyType.ptSubject, true);
  for (const poly of cuts) {
    if (poly.length >= 3) c.AddPaths([oriented(toPath(poly), true)], PolyType.ptClip, true);
  }
  const out = new ClipperLib.Paths();
  c.Execute(ClipType.ctDifference, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return splitAll(out);
}

/** Part of `subject` that lies inside the `clips` polygons (their union). May give several shapes. */
export function intersectRegions(subject: Region | readonly Region[], clips: readonly (readonly Pt[])[]): Region[] {
  const c = new Clipper();
  for (const r of Array.isArray(subject) ? (subject as readonly Region[]) : [subject as Region]) c.AddPaths(toPaths(r), PolyType.ptSubject, true);
  let any = false;
  for (const poly of clips) {
    if (poly.length >= 3) {
      c.AddPaths([oriented(toPath(poly), true)], PolyType.ptClip, true);
      any = true;
    }
  }
  if (!any) return [];
  const out = new ClipperLib.Paths();
  c.Execute(ClipType.ctIntersection, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return splitAll(out);
}

/** True if the point is in the material of one of the shapes (inside the outline and outside the holes). */
export function pointInRegions(p: Pt, regions: readonly Region[]): boolean {
  const q = { X: Math.round(p.x * S), Y: Math.round(p.y * S) };
  return regions.some((r) => Clipper.PointInPolygon(q, toPath(r.outline)) !== 0 && !r.holes.some((h) => Clipper.PointInPolygon(q, toPath(h)) !== 0));
}

/** Union of polygons that may give several separate shapes (cell groups far from each other). */
export function unionAll(polys: readonly (readonly Pt[])[]): Region[] {
  const c = new Clipper();
  let any = false;
  for (const poly of polys) {
    if (poly.length < 3) continue;
    c.AddPaths([oriented(toPath(poly), true)], PolyType.ptSubject, true);
    any = true;
  }
  if (!any) return [];
  const out = new ClipperLib.Paths();
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return splitAll(out);
}

/** Like `offsetRegion`, for several shapes together. */
export function offsetRegions(regions: readonly Region[], d: number): Region[] {
  if (d === 0) return regions.map((r) => ({ outline: r.outline.map((p) => ({ ...p })), holes: r.holes.map((h) => h.map((p) => ({ ...p }))) }));
  const co = new ClipperOffset(2, 2);
  for (const r of regions) co.AddPaths(toPaths(r), JoinType.jtRound, EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, d * S);
  return splitAll(out);
}

/**
 * Rounds the concave corners with radius `radius` (closing: grow then shrink by that amount).
 * Also closes slits narrower than 2·radius and leaves convex corners unchanged.
 */
export function closeRegions(regions: readonly Region[], radius: number): Region[] {
  if (!(radius > 0)) return [...regions];
  return offsetRegions(offsetRegions(regions, radius), -radius);
}
