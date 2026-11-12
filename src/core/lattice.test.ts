import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { slotIndexOf, slotPosition, slotsInRect, snapToSlot, type Lattice } from './lattice';

const hex: Lattice = { kind: 'hex', pitchMm: 22.4 };
const square: Lattice = { kind: 'square', pitchMm: 22.4 };

describe('slotPosition', () => {
  it('origin at (0, 0) and expected pitches', () => {
    expect(slotPosition(square, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(slotPosition(square, 2, 3)).toEqual({ x: 44.8, y: 67.2 });
    // hexagonal: odd row offset by half a pitch
    expect(slotPosition(hex, 0, 1)).toEqual({ x: 11.2, y: 19.399 });
    expect(slotPosition(hex, 0, 2)).toEqual({ x: 0, y: 38.798 });
  });

  it('hexagonal: every slot has neighbours at the same distance (= pitch)', () => {
    const a = slotPosition(hex, 2, 2);
    for (const [dc, dr] of [[1, 0], [-1, 0]] as [number, number][]) {
      const b = slotPosition(hex, 2 + dc, 2 + dr);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(22.4, 2);
    }
    // neighbours in the adjacent rows (the odd row is offset by +half a pitch)
    for (const b of [slotPosition(hex, 2, 3), slotPosition(hex, 1, 3), slotPosition(hex, 2, 1), slotPosition(hex, 1, 1)]) {
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(22.4, 2);
    }
  });

  it('negative indices follow the same parity rule', () => {
    expect(slotPosition(hex, 0, -1).x).toBeCloseTo(11.2, 6);
    expect(slotPosition(hex, 0, -2).x).toBe(0);
    expect(Object.is(slotPosition(square, 0, 0).x, -0)).toBe(false);
  });

  it('the S×P generator places the cells exactly on the slots', () => {
    for (const kind of ['hex', 'square'] as const) {
      const cells = generateGrid({ typeId: 't', diameterMm: 21.4, series: 5, parallel: 4, kind, gapMm: 1 });
      const lattice: Lattice = { kind, pitchMm: 22.4 };
      for (const c of cells) {
        const s = snapToSlot(lattice, c.x, c.y);
        expect(s).toEqual({ x: c.x, y: c.y });
      }
    }
  });
});

describe('snapToSlot', () => {
  it('is idempotent: a slot snaps to itself', () => {
    for (const l of [hex, square]) {
      for (let col = -3; col <= 3; col++) {
        for (let row = -3; row <= 3; row++) {
          const p = slotPosition(l, col, row);
          expect(snapToSlot(l, p.x, p.y)).toEqual(p);
        }
      }
    }
  });

  it('snaps to the nearest, even moving the point by a few mm', () => {
    expect(snapToSlot(square, 3, -2)).toEqual({ x: 0, y: 0 });
    expect(snapToSlot(square, 20, 24)).toEqual({ x: 22.4, y: 22.4 });
    expect(snapToSlot(hex, 9, 21)).toEqual(slotPosition(hex, 0, 1));
  });

  it('hexagonal: picks the truly nearest slot, even in a neighbouring row', () => {
    // point halfway between two rows, chosen to be closer to an offset slot
    const p = { x: 11.2, y: 9.6 };
    const snapped = snapToSlot(hex, p.x, p.y);
    const dist = (a: { x: number; y: number }) => Math.hypot(a.x - p.x, a.y - p.y);
    for (let col = -1; col <= 3; col++) {
      for (let row = -2; row <= 3; row++) {
        expect(dist(snapped)).toBeLessThanOrEqual(dist(slotPosition(hex, col, row)) + 1e-9);
      }
    }
  });

  it('the difference between two slots is a translation that maps the lattice onto itself', () => {
    const a = slotPosition(hex, 1, 2);
    const b = slotPosition(hex, 4, -1);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const [c, r] of [[0, 0], [1, 1], [2, -3], [-2, 2]] as [number, number][]) {
      const s = slotPosition(hex, c, r);
      const moved = snapToSlot(hex, s.x + dx, s.y + dy);
      expect(Math.hypot(moved.x - (s.x + dx), moved.y - (s.y + dy))).toBeLessThan(0.01);
    }
  });
});

describe('slotsInRect', () => {
  it('returns the visible slots, with about one slot per pitch² in the square', () => {
    const slots = slotsInRect(square, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, 1000)!;
    expect(slots.length).toBeGreaterThanOrEqual(16); // 5×5 inside, some margin outside
    expect(slots.some((s) => s.x === 0 && s.y === 0)).toBe(true);
    expect(slots.every((s) => s.x >= -22.4 && s.x <= 122.4)).toBe(true);
  });

  it('when zoomed far out it draws nothing', () => {
    expect(slotsInRect(hex, { minX: 0, minY: 0, maxX: 5000, maxY: 5000 }, 800)).toBeNull();
  });

  it('invalid pitch: no slots', () => {
    expect(slotsInRect({ kind: 'square', pitchMm: 0 }, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 100)).toBeNull();
  });
});

describe('slotIndexOf', () => {
  it('finds the column and row of a slot, even with negative indices', () => {
    for (const l of [hex, square]) {
      for (const [col, row] of [[0, 0], [3, 2], [-2, 1], [4, -3]] as [number, number][]) {
        const p = slotPosition(l, col, row);
        expect(slotIndexOf(l, p.x, p.y)).toEqual({ col, row });
      }
    }
  });

  it('null if the point is not on a slot', () => {
    expect(slotIndexOf(square, 5, 5)).toBeNull();
    expect(slotIndexOf({ kind: 'square', pitchMm: 0 }, 0, 0)).toBeNull();
  });
});
