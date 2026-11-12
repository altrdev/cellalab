import { describe, expect, it } from 'vitest';
import { boundsOfCells, cellsInRect, normalizeRect, snapTo } from './geometry';
import { addCell } from './ops';
import { createProject } from './project';

const T = '21700-5000-10a'; // Ø 21,4

describe('geometry', () => {
  it('snapTo rounds to the step and does not produce -0', () => {
    expect(snapTo(12.4, 5)).toBe(10);
    expect(snapTo(12.6, 5)).toBe(15);
    expect(Object.is(snapTo(-0.3, 1), 0)).toBe(true);
    expect(snapTo(12.345, 0)).toBe(12.345);
  });

  it('normalizeRect orders the corners', () => {
    expect(normalizeRect(10, 20, 0, 5)).toEqual({ minX: 0, minY: 5, maxX: 10, maxY: 20 });
  });

  it('boundsOfCells includes the radius and can be limited to a selection', () => {
    let p = createProject();
    p = addCell(p, { typeId: T, x: 0, y: 0, id: 'a' });
    p = addCell(p, { typeId: T, x: 50, y: 30, id: 'b' });
    expect(boundsOfCells(p)).toEqual({ minX: -10.7, minY: -10.7, maxX: 60.7, maxY: 40.7 });
    expect(boundsOfCells(p, new Set(['b']))).toEqual({ minX: 39.3, minY: 19.3, maxX: 60.7, maxY: 40.7 });
    expect(boundsOfCells(createProject())).toBeNull();
  });

  it('cellsInRect selects by centre, edges included', () => {
    let p = createProject();
    p = addCell(p, { typeId: T, x: 0, y: 0, id: 'a' });
    p = addCell(p, { typeId: T, x: 50, y: 0, id: 'b' });
    expect(cellsInRect(p, normalizeRect(-5, -5, 20, 5))).toEqual(['a']);
    expect(cellsInRect(p, normalizeRect(-5, -5, 50, 5))).toEqual(['a', 'b']);
    expect(cellsInRect(p, normalizeRect(100, 100, 120, 120))).toEqual([]);
  });
});
