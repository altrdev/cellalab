import { describe, expect, it } from 'vitest';
import { expandArcs, fitFreeArcs, ringWithArcs, type Circle } from './arcs';
import { circlePoints } from './polygon';

describe('ringWithArcs', () => {
  const c: Circle = { cx: 10, cy: -5, r: 6 };

  it('a full circle becomes four 90° arcs', () => {
    const ring = circlePoints(c.cx, c.cy, c.r, 96);
    const out = ringWithArcs(ring, [c]);
    expect(out).toHaveLength(4);
    for (const v of out) expect(v.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 3);
  });

  it('counter-clockwise → positive bulge, clockwise → negative', () => {
    const ccw = circlePoints(c.cx, c.cy, c.r, 96);
    const cw = [...ccw].reverse();
    expect(ringWithArcs(ccw, [c])[0]!.bulge).toBeGreaterThan(0);
    expect(ringWithArcs(cw, [c])[0]!.bulge).toBeLessThan(0);
  });

  it('a rebuilt arc lies on the true circle', () => {
    const ring = circlePoints(c.cx, c.cy, c.r, 96);
    for (const p of expandArcs(ringWithArcs(ring, [c]), 0.02)) {
      expect(Math.hypot(p.x - c.cx, p.y - c.cy)).toBeCloseTo(c.r, 3);
    }
  });

  it('straight sides stay straight: a square has no arcs', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const out = ringWithArcs(sq, [c]);
    expect(out).toHaveLength(4);
    expect(out.every((v) => v.bulge === 0)).toBe(true);
  });

  it('a round stretch and a straight one: the arc vertices are far fewer than the segments', () => {
    // stadio: due semicerchi uniti da due lati lunghi
    const left = circlePoints(0, 0, 4, 96).filter((p) => p.x <= 1e-9);
    const right = circlePoints(20, 0, 4, 96).filter((p) => p.x >= 20 - 1e-9);
    // counter-clockwise outline: right semicircle (-90° to +90°), then left (90° to 270°)
    const ring = [...right.sort((a, b) => Math.atan2(a.y, a.x - 20) - Math.atan2(b.y, b.x - 20)), ...left.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))];
    const out = ringWithArcs(ring, [{ cx: 0, cy: 0, r: 4 }, { cx: 20, cy: 0, r: 4 }]);
    expect(out.length).toBeLessThan(ring.length / 4);
    expect(out.some((v) => v.bulge === 0)).toBe(true);
    expect(out.some((v) => v.bulge !== 0)).toBe(true);
  });

  it('without known circles it returns the polyline as it is', () => {
    const ring = circlePoints(0, 0, 5, 12);
    const out = ringWithArcs(ring, []);
    expect(out).toHaveLength(12);
    expect(out.every((v) => v.bulge === 0)).toBe(true);
  });
});

describe('fitFreeArcs', () => {
  /** Rectangle with corners rounded by a radius, each corner as a polyline of `n` sides (as it comes out of the kerf). */
  function roundedRect(w: number, h: number, r: number, n: number) {
    const pts: { x: number; y: number; bulge: number }[] = [];
    const corner = (cx: number, cy: number, a0: number) => {
      for (let k = 0; k <= n; k++) {
        const a = a0 + (Math.PI / 2) * (k / n);
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), bulge: 0 });
      }
    };
    corner(w - r, h - r, 0);
    corner(r, h - r, Math.PI / 2);
    corner(r, r, Math.PI);
    corner(w - r, r, (3 * Math.PI) / 2);
    return pts;
  }

  it('corners rounded as a polyline each become a single arc', () => {
    const ring = roundedRect(30, 10, 0.5, 11);
    const out = fitFreeArcs(ring);
    expect(out.filter((v) => v.bulge !== 0)).toHaveLength(4);
    expect(out.length).toBeLessThan(ring.length / 2);
    // each arc is 90°: bulge = tan(90°/4)
    for (const v of out.filter((q) => q.bulge !== 0)) expect(Math.abs(v.bulge)).toBeCloseTo(Math.tan(Math.PI / 8), 3);
  });

  it('the shape stays the same (deviation under 0.02 mm)', () => {
    const ring = roundedRect(30, 10, 0.5, 11);
    const back = expandArcs(fitFreeArcs(ring), 0.02);
    const dist = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => Math.max(...a.map((p) => Math.min(...b.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))));
    expect(dist(ring, back)).toBeLessThan(0.02);
  });

  it('a polyline circle becomes arcs of at most 90°, and straight sides stay straight', () => {
    const out = fitFreeArcs(circlePoints(0, 0, 3, 48).map((p) => ({ ...p, bulge: 0 })));
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out.every((v) => v.bulge !== 0)).toBe(true);
    const sq = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1.5, y: 0 }, { x: 1.5, y: 5 }, { x: 0, y: 5 }].map((p) => ({ ...p, bulge: 0 }));
    expect(fitFreeArcs(sq).every((v) => v.bulge === 0)).toBe(true);
  });
});
