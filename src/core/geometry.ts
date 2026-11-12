import { findCellType } from './catalog';
import type { Project } from './types';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
}

/** Rounds to the nearest multiple of `step`; with step <= 0 it does nothing. */
export function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step + 0 : value; // "+ 0" avoids -0
}

/** Rectangle containing all the cells (or only those in `ids`), outer edge included. */
export function boundsOfCells(project: Project, ids?: ReadonlySet<string>): Rect | null {
  let rect: Rect | null = null;
  for (const c of project.cells) {
    if (ids && !ids.has(c.id)) continue;
    const t = findCellType(project, c.typeId);
    if (!t) continue;
    const r = t.diameterMm / 2;
    if (!rect) {
      rect = { minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r };
    } else {
      rect.minX = Math.min(rect.minX, c.x - r);
      rect.minY = Math.min(rect.minY, c.y - r);
      rect.maxX = Math.max(rect.maxX, c.x + r);
      rect.maxY = Math.max(rect.maxY, c.y + r);
    }
  }
  return rect;
}

/** Ids of the cells whose centre falls inside the rectangle (drag selection). */
export function cellsInRect(project: Project, rect: Rect): string[] {
  return project.cells
    .filter((c) => c.x >= rect.minX && c.x <= rect.maxX && c.y >= rect.minY && c.y <= rect.maxY)
    .map((c) => c.id);
}
