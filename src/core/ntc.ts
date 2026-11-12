import { findCellType } from './catalog';
import { circlePolygon, intersectRegions, regionArea, type Region } from './clip';
import { circumcenter, SIDE_VECTOR, type Pt } from './polygon';
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
  /** Foro passante nel fondo, largo come la tasca: il sensore si infila da fuori, dopo aver montato il pacco, e il filo esce da lì. */
  wirePolygon: Pt[];
  /** Il foro cade sotto una lamella: il sensore non si infila da fuori (nessun altro vuoto era libero). */
  covered: boolean;
  /** Le tre celle che il sensore tocca. */
  cellIds: [string, string, string];
  /** Vuoto tra quattro celle (griglia quadrata): con la sagoma «a profilo» è già aperto e il foro non toglie niente; con quella arrotondata il contorno lo riempie e il foro serve. */
  open: boolean;
}

/** Due celle sono vicine se i centri distano al massimo 1,25 volte la distanza minima nel pacco. */
const NEIGHBOUR_FACTOR = 1.25;
/** Nella griglia quadrata le due celle accanto a una terza stanno in diagonale: fino a 1,5 volte il passo. */
const DIAGONAL_FACTOR = 1.5;

/**
 * I vuoti adatti all'NTC, dal migliore: prima quelli di una cella centrale, e a parità i liberi da lamelle e più verso il
 * lato di uscita. Vuota se non ce ne sono (meno di tre celle vicine, tutte in fila…).
 */
export function ntcSites(project: Project, side: NtcSide, diameterMm: number, clearanceMm: number, avoid: readonly Region[] = []): NtcSite[] {
  const cells = project.cells.flatMap((c) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ id: c.id, x: c.x, y: c.y, pocket: t.diameterMm / 2 + clearanceMm }] : [];
  });
  if (cells.length < 3) return [];
  const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c.y, 0) / cells.length;
  let pitch = Infinity;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) pitch = Math.min(pitch, Math.hypot(cells[i]!.x - cells[j]!.x, cells[i]!.y - cells[j]!.y));
  }
  const near = pitch * NEIGHBOUR_FACTOR + 1e-6;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const d = SIDE_VECTOR[side];
  const radiusMm = diameterMm / 2;
  const central = [...cells].sort((a, b) => dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy }));
  const collect = (pairNear: number, open: boolean): NtcSite[] => {
    const out: NtcSite[] = [];
    const seen = new Set<string>();
    for (const c of central) {
      const around = cells.filter((o) => o !== c && dist(o, c) <= near);
      const mine: { p: Pt; ids: [string, string, string]; score: number; covered: boolean }[] = [];
      for (let i = 0; i < around.length; i++) {
        for (let j = i + 1; j < around.length; j++) {
          const a = around[i]!;
          const b = around[j]!;
          if (dist(a, b) > pairNear) continue;
          const p = circumcenter(c, a, b);
          if (!p) continue;
          // deve essere un vuoto vero: fuori dalle tasche di tutte le celle
          if (cells.some((o) => dist(o, p) < o.pocket - 1e-6)) continue;
          const k = `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          // I vuoti liberi (senza lamelle sopra dove passa il filo) vincono su quelli coperti; poi conta il lato di uscita.
          const covered = avoid.length > 0 && intersectRegions(avoid, [circlePolygon(p.x, p.y, radiusMm)]).some((r) => regionArea(r) > 0.01);
          mine.push({ p, ids: [c.id, a.id, b.id], score: p.x * d.x + p.y * d.y, covered });
        }
      }
      mine.sort((a, b) => Number(a.covered) - Number(b.covered) || b.score - a.score);
      for (const m of mine) {
        out.push({ x: m.p.x, y: m.p.y, radiusMm, polygon: circlePolygon(m.p.x, m.p.y, radiusMm), wirePolygon: circlePolygon(m.p.x, m.p.y, radiusMm), covered: m.covered, cellIds: m.ids, open });
      }
    }
    return out;
  };
  const triples = collect(near, false);
  // Griglia quadrata: nessun vuoto tra tre celle, ma quello tra quattro (già aperto) va bene.
  return triples.length > 0 ? triples : collect(pitch * DIAGONAL_FACTOR + 1e-6, true);
}

/** Il vuoto più adatto per l'NTC, o null se non c'è. */
export function ntcSite(project: Project, side: NtcSide, diameterMm: number, clearanceMm: number, avoid: readonly Region[] = []): NtcSite | null {
  const all = ntcSites(project, side, diameterMm, clearanceMm, avoid);
  // una cella centrale con vuoti liberi vince su una più periferica con vuoti coperti
  return all.find((s) => !s.covered) ?? all[0] ?? null;
}
