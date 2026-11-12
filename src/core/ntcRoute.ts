import { offsetRegion, offsetRegions, type Region } from './clip';
import type { Pt } from './polygon';
import { circlePoints, convexHull } from './polygon';
import type { NtcSide } from './ntc';

/**
 * Solco per il filo dell'NTC sulla faccia esterna del fondo del portacelle: dal foro del filo fino al bordo del lato di
 * uscita, senza passare sotto le lamelle. È il percorso più corto su una griglia fitta, poi raddrizzato.
 */

/** Larghezza del solco (due fili sottili con la guaina), mm. */
export const NTC_GROOVE_MM = 1.6;
/** Margine tra solco e lamella, mm. */
const AVOID_MARGIN_MM = 0.3;
const STEP_MM = 0.5;
/** Fondo che deve restare tra il solco e le aperture delle celle (o il bordo): una parete da stampare, mm. */
export const FLOOR_MARGIN_MM = 0.5;
/** Raggio attorno al foro dove non si applica il margine dalle lamelle, mm. */
const START_FREE_MM = 1.6;
/** Il bordo di uscita è quello dove la proiezione sul lato è a meno di questo dall'estremo del fondo, mm. */
const EDGE_BAND_MM = 2.5;
const MAX_NODES = 250_000;

const DIR: Record<NtcSide, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export interface NtcRoute {
  /** C'è un percorso libero fino al bordo. */
  found: boolean;
  /** Punti del percorso, dal foro al bordo (vuoto se non c'è). */
  path: Pt[];
  lengthMm: number;
  /** Il solco, come poligoni da togliere al fondo (capsule lungo il percorso). */
  polygons: Pt[][];
}

interface Ring {
  pts: Pt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const ringOf = (pts: Pt[]): Ring => ({
  pts,
  minX: Math.min(...pts.map((p) => p.x)),
  maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

function inRing(p: Pt, r: Ring): boolean {
  if (p.x < r.minX || p.x > r.maxX || p.y < r.minY || p.y > r.maxY) return false;
  let inside = false;
  const pts = r.pts;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface Area {
  outline: Ring;
  holes: Ring[];
}
const areaOf = (r: Region): Area => ({ outline: ringOf(r.outline), holes: r.holes.map(ringOf) });
const inArea = (p: Pt, a: Area) => inRing(p, a.outline) && !a.holes.some((h) => inRing(p, h));

export function ntcRoute(slab: readonly Region[], avoid: readonly Region[], start: Pt, side: NtcSide, grooveMm = NTC_GROOVE_MM): NtcRoute {
  const none: NtcRoute = { found: false, path: [], lengthMm: 0, polygons: [] };
  const half = grooveMm / 2;
  const walk = offsetRegions(slab, -(half + FLOOR_MARGIN_MM)).map(areaOf);
  const floor = slab.map(areaOf);
  const block = avoid.filter((r) => r.outline.length >= 3).map((r) => areaOf(offsetRegion(r, half + AVOID_MARGIN_MM)));
  if (walk.length === 0) return none;
  const d = DIR[side];

  // Vicino al foro di partenza il margine dalle lamelle non conta (il foro è già scelto fuori dalle lamelle).
  const near = (p: Pt) => Math.hypot(p.x - start.x, p.y - start.y) <= START_FREE_MM;
  const free = (p: Pt) => walk.some((a) => inArea(p, a)) && (near(p) || !block.some((a) => inArea(p, a)));
  if (!free(start)) return none;

  const extreme = Math.max(...walk.flatMap((a) => a.outline.pts.map((p) => p.x * d.x + p.y * d.y)));
  const isGoal = (p: Pt) => p.x * d.x + p.y * d.y >= extreme - EDGE_BAND_MM;

  // Dijkstra su una griglia con passo STEP_MM, otto vicini; la libertà di ogni nodo si calcola solo quando serve.
  const key = (ix: number, iy: number) => `${ix},${iy}`;
  const at = (ix: number, iy: number): Pt => ({ x: start.x + ix * STEP_MM, y: start.y + iy * STEP_MM });
  const memo = new Map<string, boolean>();
  const isFree = (ix: number, iy: number) => {
    const k = key(ix, iy);
    let v = memo.get(k);
    if (v === undefined) {
      v = free(at(ix, iy));
      memo.set(k, v);
    }
    return v;
  };
  const dist = new Map<string, number>([[key(0, 0), 0]]);
  const prev = new Map<string, string>();
  type Node = { ix: number; iy: number; d: number };
  const heap: Node[] = [{ ix: 0, iy: 0, d: 0 }];
  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.d <= heap[i]!.d) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): Node => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]!.d < heap[m]!.d) m = l;
        if (r < heap.length && heap[r]!.d < heap[m]!.d) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };

  let goal: string | null = null;
  let guard = 0;
  while (heap.length > 0 && guard++ < MAX_NODES) {
    const n = pop();
    const k = key(n.ix, n.iy);
    if (n.d > (dist.get(k) ?? Infinity) + 1e-9) continue;
    if (isGoal(at(n.ix, n.iy))) {
      goal = k;
      break;
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const jx = n.ix + dx;
        const jy = n.iy + dy;
        if (!isFree(jx, jy)) continue;
        const nd = n.d + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) * STEP_MM;
        const jk = key(jx, jy);
        if (nd < (dist.get(jk) ?? Infinity) - 1e-9) {
          dist.set(jk, nd);
          prev.set(jk, k);
          push({ ix: jx, iy: jy, d: nd });
        }
      }
    }
  }
  if (!goal) return none;

  const raw: Pt[] = [];
  for (let k: string | undefined = goal; k !== undefined; k = prev.get(k)) {
    const [ix, iy] = k.split(',').map(Number) as [number, number];
    raw.push(at(ix, iy));
  }
  raw.reverse();

  // Raddrizza: da ogni punto si va al più lontano raggiungibile in linea retta senza uscire dalla zona libera.
  const clear = (a: Pt, b: Pt) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / 0.25));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!free({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
    }
    return true;
  };
  const path: Pt[] = [raw[0]!];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !clear(raw[i]!, raw[j]!)) j--;
    path.push(raw[j]!);
    i = j;
  }

  // Il percorso si ferma a FLOOR_MARGIN_MM dal bordo: l'ultimo tratto va avanti nella stessa direzione fino a uscire dal fondo.
  const last = path[path.length - 1]!;
  let out = 0;
  for (let a = STEP_MM; a <= 12; a += STEP_MM) {
    if (!floor.some((f) => inArea({ x: last.x + d.x * a, y: last.y + d.y * a }, f))) break;
    out = a;
  }
  path.push({ x: last.x + d.x * (out + 1), y: last.y + d.y * (out + 1) });

  let lengthMm = 0;
  const caps = (p: Pt) => circlePoints(p.x, p.y, half, 16);
  const polygons: Pt[][] = [];
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]!;
    const b = path[k + 1]!;
    lengthMm += Math.hypot(b.x - a.x, b.y - a.y);
    polygons.push(convexHull([...caps(a), ...caps(b)]));
  }
  return { found: true, path, lengthMm, polygons };
}
