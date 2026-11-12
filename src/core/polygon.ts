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

/** Versori dei quattro lati nel disegno (y verso il basso). */
export type Side = 'top' | 'bottom' | 'left' | 'right';
export const SIDE_VECTOR: Record<Side, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** Centro del cerchio per tre punti, o null se sono quasi allineati. */
export function circumcenter(a: Pt, b: Pt, c: Pt): Pt | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

/** Distanza di un punto da un rettangolo (poligono convesso); 0 se dentro. */
export function distToRect(p: Pt, rect: readonly Pt[]): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < rect.length; i++) {
    const a = rect[i]!;
    const b = rect[(i + 1) % rect.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    if (ex * (p.y - a.y) - ey * (p.x - a.x) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey)));
  }
  return inside ? 0 : best;
}
