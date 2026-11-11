import { describe, expect, it } from 'vitest';
import { expandArcs, ringWithArcs, type Circle } from './arcs';
import { circlePoints } from './polygon';

describe('ringWithArcs', () => {
  const c: Circle = { cx: 10, cy: -5, r: 6 };

  it('un cerchio intero diventa quattro archi da 90°', () => {
    const ring = circlePoints(c.cx, c.cy, c.r, 96);
    const out = ringWithArcs(ring, [c]);
    expect(out).toHaveLength(4);
    for (const v of out) expect(v.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 3);
  });

  it('antiorario → bulge positivo, orario → negativo', () => {
    const ccw = circlePoints(c.cx, c.cy, c.r, 96);
    const cw = [...ccw].reverse();
    expect(ringWithArcs(ccw, [c])[0]!.bulge).toBeGreaterThan(0);
    expect(ringWithArcs(cw, [c])[0]!.bulge).toBeLessThan(0);
  });

  it('un arco ricostruito sta sul cerchio vero', () => {
    const ring = circlePoints(c.cx, c.cy, c.r, 96);
    for (const p of expandArcs(ringWithArcs(ring, [c]), 0.02)) {
      expect(Math.hypot(p.x - c.cx, p.y - c.cy)).toBeCloseTo(c.r, 3);
    }
  });

  it('lati retti restano retti: un quadrato non ha archi', () => {
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

  it('un tratto rotondo e uno retto: i vertici degli archi sono molti meno dei segmenti', () => {
    // stadio: due semicerchi uniti da due lati lunghi
    const left = circlePoints(0, 0, 4, 96).filter((p) => p.x <= 1e-9);
    const right = circlePoints(20, 0, 4, 96).filter((p) => p.x >= 20 - 1e-9);
    // contorno antiorario: semicerchio destro (da -90° a +90°), poi sinistro (da 90° a 270°)
    const ring = [...right.sort((a, b) => Math.atan2(a.y, a.x - 20) - Math.atan2(b.y, b.x - 20)), ...left.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))];
    const out = ringWithArcs(ring, [{ cx: 0, cy: 0, r: 4 }, { cx: 20, cy: 0, r: 4 }]);
    expect(out.length).toBeLessThan(ring.length / 4);
    expect(out.some((v) => v.bulge === 0)).toBe(true);
    expect(out.some((v) => v.bulge !== 0)).toBe(true);
  });

  it('senza cerchi noti restituisce la polilinea com\'è', () => {
    const ring = circlePoints(0, 0, 5, 12);
    const out = ringWithArcs(ring, []);
    expect(out).toHaveLength(12);
    expect(out.every((v) => v.bulge === 0)).toBe(true);
  });
});
