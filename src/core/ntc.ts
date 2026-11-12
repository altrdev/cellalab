import { findCellType } from './catalog';
import { circlePolygon, intersectRegions, regionArea, type Region } from './clip';
import type { Pt } from './polygon';
import type { Project } from './types';

/**
 * Posto per il sensore di temperatura (NTC): il vuoto tra tre celle vicine, dove il sensore tocca i fianchi di tutte e
 * tre. Si sceglie una cella centrale (la più calda) e, tra i vuoti che la toccano, quello più verso il lato di uscita
 * dei fili. La tasca è un foro tondo nelle pareti del portacelle, che si apre sulle tasche delle tre celle.
 */

export type NtcSide = 'top' | 'bottom' | 'left' | 'right';

export interface NtcSite {
  /** Centro del vuoto tra le tre celle, mm. */
  x: number;
  y: number;
  /** Raggio del foro, mm. */
  radiusMm: number;
  polygon: Pt[];
  /** Foro per il filo del sensore: passa anche nel fondo, così il filo esce sulla faccia esterna. */
  wirePolygon: Pt[];
  /** Il foro del filo cade sotto una lamella: il filo non esce (nessun altro vuoto era libero). */
  covered: boolean;
  /** Le tre celle che il sensore tocca. */
  cellIds: [string, string, string];
}

const DIR: Record<NtcSide, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** Diametro del foro per il filo del sensore (due fili sottili con la guaina), mm. */
export const NTC_WIRE_HOLE_MM = 2;
/** Due celle sono vicine se i centri distano al massimo 1,25 volte la distanza minima nel pacco. */
const NEIGHBOUR_FACTOR = 1.25;

function circumcenter(a: Pt, b: Pt, c: Pt): Pt | null {
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

/** Il vuoto più adatto per l'NTC, o null se non c'è (meno di tre celle vicine, tutte in fila…). */
export function ntcSite(project: Project, side: NtcSide, diameterMm: number, clearanceMm: number, avoid: readonly Region[] = []): NtcSite | null {
  const cells = project.cells.flatMap((c) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ id: c.id, x: c.x, y: c.y, pocket: t.diameterMm / 2 + clearanceMm }] : [];
  });
  if (cells.length < 3) return null;
  const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c.y, 0) / cells.length;
  let pitch = Infinity;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) pitch = Math.min(pitch, Math.hypot(cells[i]!.x - cells[j]!.x, cells[i]!.y - cells[j]!.y));
  }
  const near = pitch * NEIGHBOUR_FACTOR + 1e-6;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const d = DIR[side];
  const radiusMm = diameterMm / 2;
  const central = [...cells].sort((a, b) => dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy }));
  for (const c of central) {
    const around = cells.filter((o) => o !== c && dist(o, c) <= near);
    let best: { p: Pt; ids: [string, string, string]; score: number; covered: boolean } | null = null;
    for (let i = 0; i < around.length; i++) {
      for (let j = i + 1; j < around.length; j++) {
        const a = around[i]!;
        const b = around[j]!;
        if (dist(a, b) > near) continue;
        const p = circumcenter(c, a, b);
        if (!p) continue;
        // deve essere un vuoto vero: fuori dalle tasche di tutte le celle, e non più largo di quello che il sensore riempie
        if (cells.some((o) => dist(o, p) < o.pocket - 1e-6)) continue;
        // I vuoti liberi (senza lamelle sopra dove passa il filo) vincono su quelli coperti; poi conta il lato di uscita.
        const covered = avoid.length > 0 && intersectRegions(avoid, [circlePolygon(p.x, p.y, NTC_WIRE_HOLE_MM / 2)]).some((r) => regionArea(r) > 0.01);
        const score = p.x * d.x + p.y * d.y - (covered ? 1e6 : 0);
        if (!best || score > best.score) best = { p, ids: [c.id, a.id, b.id], score, covered };
      }
    }
    if (best) {
      const { p } = best;
      return { x: p.x, y: p.y, radiusMm, polygon: circlePolygon(p.x, p.y, radiusMm), wirePolygon: circlePolygon(p.x, p.y, NTC_WIRE_HOLE_MM / 2), covered: best.covered, cellIds: best.ids };
    }
  }
  return null;
}
