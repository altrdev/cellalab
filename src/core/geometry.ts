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

/** Arrotonda al multiplo di `step` più vicino; con step <= 0 non fa nulla. */
export function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step + 0 : value; // "+ 0" evita il -0
}

/** Rettangolo che contiene tutte le celle (o solo quelle in `ids`), bordo esterno incluso. */
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

/** Id delle celle il cui centro cade dentro il rettangolo (selezione a trascinamento). */
export function cellsInRect(project: Project, rect: Rect): string[] {
  return project.cells
    .filter((c) => c.x >= rect.minX && c.x <= rect.maxX && c.y >= rect.minY && c.y <= rect.maxY)
    .map((c) => c.id);
}
