import { circumcenter, type Pt } from './polygon';

/**
 * Da una polilinea chiusa che approssima dei cerchi a una polilinea con archi veri (vertici con «bulge», come
 * nel DXF): i lati consecutivi con i vertici sullo stesso cerchio noto diventano un arco solo. Serve perché
 * un taglio laser o CNC segua il cerchio e non una spezzata.
 */

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/** Vertice della polilinea; `bulge` descrive il lato verso il vertice successivo: 0 = retto, altrimenti tan(angolo/4), positivo in senso antiorario. */
export interface ArcVertex extends Pt {
  bulge: number;
}

const DEFAULT_TOL_MM = 0.012;
/** Un arco di DXF può arrivare a 360°, ma sotto i 90° resta ben definito in ogni programma. */
const MAX_SWEEP = Math.PI / 2;
/** Lato massimo di un segmento che si considera parte di un arco, mm. */
const MAX_CHORD_MM = 1.2;

const onCircle = (p: Pt, c: Circle, tol: number) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) <= tol;

/** Angolo con segno (rad) da `a` a `b` visti dal centro del cerchio, in (−π, π]. */
function sweep(a: Pt, b: Pt, c: Circle): number {
  const ax = a.x - c.cx;
  const ay = a.y - c.cy;
  const bx = b.x - c.cx;
  const by = b.y - c.cy;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

export function ringWithArcs(ring: readonly Pt[], circles: readonly Circle[], tolMm = DEFAULT_TOL_MM): ArcVertex[] {
  const n = ring.length;
  if (n < 3 || circles.length === 0) return ring.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));

  // cerchio di ogni lato (indice nel vettore `circles`), o -1 se il lato è retto
  const edgeCircle = ring.map((a, i) => {
    const b = ring[(i + 1) % n]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) > MAX_CHORD_MM) return -1;
    return circles.findIndex((c) => onCircle(a, c, tolMm) && onCircle(b, c, tolMm));
  });

  // si parte da un lato dove cambia il cerchio, così nessun arco attraversa l'inizio della lista
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (edgeCircle[i] !== edgeCircle[(i + n - 1) % n]) {
      start = i;
      break;
    }
  }

  const out: ArcVertex[] = [];
  let i = 0;
  while (i < n) {
    const e = (start + i) % n;
    const ci = edgeCircle[e]!;
    if (ci < 0) {
      out.push({ x: ring[e]!.x, y: ring[e]!.y, bulge: 0 });
      i++;
      continue;
    }
    // tutti i lati consecutivi sullo stesso cerchio, spezzati in archi di al massimo 90°
    const c = circles[ci]!;
    let pieceStart = e;
    let pieceSweep = 0;
    while (i < n && edgeCircle[(start + i) % n] === ci) {
      const k = (start + i) % n;
      const a = ring[k]!;
      const b = ring[(k + 1) % n]!;
      const d = sweep(a, b, c);
      if (pieceStart !== k && Math.abs(pieceSweep + d) > MAX_SWEEP + 1e-6) {
        out.push({ ...ring[pieceStart]!, bulge: Math.tan(pieceSweep / 4) });
        pieceStart = k;
        pieceSweep = 0;
      }
      pieceSweep += d;
      i++;
    }
    out.push({ ...ring[pieceStart]!, bulge: Math.tan(pieceSweep / 4) });
  }
  return out;
}

/**
 * Cerchi non noti: una catena di lati corti consecutivi i cui vertici stanno su uno stesso cerchio (per esempio un angolo
 * arrotondato dal kerf, che arriva dal calcolo come una spezzata di 8–12 lati) diventa un arco solo. Lascia stare i lati
 * già archi e le catene quasi dritte; ogni arco fa al massimo 90°.
 */
export function fitFreeArcs(ring: readonly ArcVertex[], tolMm = DEFAULT_TOL_MM): ArcVertex[] {
  const n = ring.length;
  if (n < 4) return ring.map((v) => ({ ...v }));
  const short = (i: number) => {
    const a = ring[i % n]!;
    const b = ring[(i + 1) % n]!;
    return a.bulge === 0 && Math.hypot(a.x - b.x, a.y - b.y) <= MAX_CHORD_MM;
  };
  // si parte dopo un lato che non può far parte di un arco, così nessuna catena attraversa l'inizio (se sono tutti corti, da 0)
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (!short(i)) {
      start = (i + 1) % n;
      break;
    }
  }
  const at = (k: number) => ring[(start + k) % n]!;
  /** La catena dal punto i al punto j sta su un cerchio e gira sempre dalla stessa parte, per un angolo ≤ 90°? */
  const fit = (i: number, j: number): { c: Circle; sweepRad: number } | null => {
    const a = at(i);
    const b = at(j);
    const m = at(Math.floor((i + j) / 2));
    const o = circumcenter(a, m, b);
    const c: Circle | null = o ? { cx: o.x, cy: o.y, r: Math.hypot(a.x - o.x, a.y - o.y) } : null;
    if (!c || c.r > 80 || c.r < 0.05) return null;
    let total = 0;
    let sign = 0;
    for (let k = i; k < j; k++) {
      const p = at(k);
      if (Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) > tolMm) return null;
      const d = sweep(p, at(k + 1), c);
      if (sign === 0) sign = Math.sign(d);
      if (Math.sign(d) !== sign || d === 0) return null;
      total += d;
    }
    if (Math.abs(Math.hypot(b.x - c.cx, b.y - c.cy) - c.r) > tolMm) return null;
    return Math.abs(total) <= MAX_SWEEP + 1e-6 ? { c, sweepRad: total } : null;
  };

  const out: ArcVertex[] = [];
  let i = 0;
  while (i < n) {
    if (!short(start + i)) {
      out.push({ ...at(i) });
      i++;
      continue;
    }
    // la catena più lunga che sta su un cerchio (almeno 3 lati e un po' di curva)
    let best: { j: number; sweepRad: number } | null = null;
    for (let j = i + 3; j <= n && j - i <= 64; j++) {
      if (j > i + 3 && !short(start + j - 1)) break;
      const f = fit(i, j);
      if (f) best = { j, sweepRad: f.sweepRad };
      else if (best) break;
    }
    if (best && Math.abs(best.sweepRad) > 0.15) {
      out.push({ x: at(i).x, y: at(i).y, bulge: Math.tan(best.sweepRad / 4) });
      i = best.j;
    } else {
      out.push({ ...at(i) });
      i++;
    }
  }
  return out;
}

/** Riporta una polilinea con archi a punti (per verificarla e per i programmi che non leggono il bulge). */
export function expandArcs(ring: readonly ArcVertex[], stepRad = 0.05): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    out.push({ x: a.x, y: a.y });
    if (a.bulge === 0) continue;
    const theta = 4 * Math.atan(a.bulge);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const chord = Math.hypot(dx, dy);
    const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
    // centro: a metà corda, spostato lungo la normale sinistra (arco antiorario) o destra (oraria)
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const h = radius * Math.cos(theta / 2);
    const sgn = theta > 0 ? 1 : -1;
    const cx = mx + (-dy / chord) * h * sgn;
    const cy = my + (dx / chord) * h * sgn;
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    const steps = Math.max(1, Math.ceil(Math.abs(theta) / stepRad));
    for (let s = 1; s < steps; s++) {
      const t = a0 + (theta * s) / steps;
      out.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) });
    }
  }
  return out;
}
