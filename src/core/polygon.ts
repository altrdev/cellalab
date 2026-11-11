/** Geometria 2D di poligoni convessi (coordinate del disegno, mm). */

export interface Pt {
  x: number;
  y: number;
}

/** Area con segno (formula del lacciolo): positiva se i vertici girano in senso antiorario nel piano x-y standard. */
export function signedArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const polygonArea = (poly: readonly Pt[]) => Math.abs(signedArea(poly));

/** Inviluppo convesso (Andrew), con orientamento a area positiva. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = [...lower, ...upper];
  return signedArea(hull) < 0 ? hull.reverse() : hull;
}

/** Punti equispaziati su un cerchio. */
export function circlePoints(cx: number, cy: number, r: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Sposta il contorno verso l'esterno di `d` mm (negativo = verso l'interno). Solo poligoni convessi. */
export function offsetConvex(poly: readonly Pt[], d: number): Pt[] {
  if (d === 0 || poly.length < 3) return poly.map((p) => ({ ...p }));
  const ccw = signedArea(poly) > 0;
  const n = poly.length;
  const normal = (a: Pt, b: Pt): Pt => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // normale uscente: a destra della direzione per un poligono antiorario
    return ccw ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
  };
  return poly.map((v, i) => {
    const prev = poly[(i - 1 + n) % n]!;
    const next = poly[(i + 1) % n]!;
    const n1 = normal(prev, v);
    const n2 = normal(v, next);
    const k = 1 + n1.x * n2.x + n1.y * n2.y;
    const f = d / Math.max(k, 1e-6);
    return { x: v.x + (n1.x + n2.x) * f, y: v.y + (n1.y + n2.y) * f };
  });
}

/** Lunghezza del tratto di retta (punto `p`, direzione `dir`) che cade dentro il poligono convesso. */
export function chordLength(poly: readonly Pt[], p: Pt, dir: Pt): number {
  let lo = Infinity;
  let hi = -Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ax = a.x - p.x;
    const ay = a.y - p.y;
    const u = (ax * ey - ay * ex) / den; // parametro lungo la retta
    const s = (ax * dir.y - ay * dir.x) / den; // parametro lungo il lato
    if (s >= -1e-9 && s <= 1 + 1e-9) {
      lo = Math.min(lo, u);
      hi = Math.max(hi, u);
    }
  }
  return hi > lo ? hi - lo : 0;
}

/** Larghezza minima (distanza minima tra due rette parallele che racchiudono il poligono convesso). */
export function minWidth(poly: readonly Pt[]): number {
  const n = poly.length;
  if (n < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    let far = 0;
    for (const v of poly) far = Math.max(far, Math.abs((b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x)) / len);
    best = Math.min(best, far);
  }
  return Number.isFinite(best) ? best : 0;
}

function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const pointSeg = (p: Pt, s: Pt, e: Pt) => {
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / l2));
    return Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy));
  };
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

/** Distanza minima tra due poligoni convessi; 0 se si toccano o si sovrappongono. */
export function convexDistance(a: readonly Pt[], b: readonly Pt[]): number {
  // Asse separatore: se esiste, i poligoni sono disgiunti.
  const separated = (p: readonly Pt[], q: readonly Pt[]) => {
    for (let i = 0; i < p.length; i++) {
      const s = p[i]!;
      const e = p[(i + 1) % p.length]!;
      const nx = e.y - s.y;
      const ny = -(e.x - s.x);
      let pMin = Infinity;
      let pMax = -Infinity;
      for (const v of p) {
        const d = v.x * nx + v.y * ny;
        pMin = Math.min(pMin, d);
        pMax = Math.max(pMax, d);
      }
      let qMin = Infinity;
      let qMax = -Infinity;
      for (const v of q) {
        const d = v.x * nx + v.y * ny;
        qMin = Math.min(qMin, d);
        qMax = Math.max(qMax, d);
      }
      if (qMin > pMax + 1e-9 || pMin > qMax + 1e-9) return true;
    }
    return false;
  };
  if (!separated(a, b) && !separated(b, a)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      best = Math.min(best, segmentDistance(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!));
    }
  }
  return best;
}
