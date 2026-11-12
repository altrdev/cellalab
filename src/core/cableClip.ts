import { findCellType } from './catalog';
import type { Harness, HarnessCable, Pt3 } from './harness';
import type { Pt } from './polygon';
import type { Project } from './types';

/**
 * Fermacavi stampati a scatto per i cavi di potenza. Ogni fermacavo è una fascia a C che si incastra su una cella del fianco
 * (si spinge da fuori, le braccia si aprono e si chiudono sulla cella) con, ai bordi della bocca, due ganci dove il cavo
 * si preme dall'alto e resta fermo, appoggiato alla cella. Qui si decide dove vanno e di che misure; la forma la fa `ui/clipMesh.ts`.
 */

export interface ClipSpec {
  cellDiameterMm: number;
  cableOdMm: number;
  /** Spessore della fascia: sta nello spazio tra due celle vicine. */
  thicknessMm: number;
  /** Altezza della fascia lungo la cella. */
  heightMm: number;
  /** Larghezza della bocca, mm. */
  mouthMm: number;
}

export interface CableClip {
  cellId: string;
  cable: HarnessCable['label'];
  /** Asse della cella a metà altezza, nella scena. */
  center: Pt3;
  /** Versori nel disegno: verso l'esterno del pacco e lungo il cavo. */
  out: Pt;
  along: Pt;
  spec: ClipSpec;
}

/** Gioco tra la fascia e la cella, mm. */
export const CLIP_FIT_MM = 0.15;
/** Distanza minima tra due fermacavi sullo stesso cavo, mm. */
export const CLIP_SPACING_MM = 35;

export function clipSpec(project: Project, cellDiameterMm: number, cableOdMm: number): ClipSpec {
  // Spessore: quello che entra nel vuoto tra due celle (distanza minima tra le celle meno il gioco).
  let gap = Infinity;
  for (let i = 0; i < project.cells.length; i++) {
    const a = project.cells[i]!;
    const ra = (findCellType(project, a.typeId)?.diameterMm ?? 0) / 2;
    for (let j = i + 1; j < project.cells.length; j++) {
      const b = project.cells[j]!;
      const rb = (findCellType(project, b.typeId)?.diameterMm ?? 0) / 2;
      gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y) - ra - rb);
    }
  }
  const t = Math.max(0.8, Math.min(1.4, (Number.isFinite(gap) ? gap : 1.5) - 0.25 - CLIP_FIT_MM));
  return {
    cellDiameterMm,
    cableOdMm,
    thicknessMm: Math.round(t * 100) / 100,
    heightMm: Math.round((cableOdMm + 5) * 10) / 10,
    mouthMm: Math.round(cellDiameterMm * 0.78 * 10) / 10,
  };
}

/** Dove vanno i fermacavi: sulle celle del fianco che il cavo sfiora, distanziati di `spacingMm`. */
export function cableClips(project: Project, h: Harness, spacingMm = CLIP_SPACING_MM): CableClip[] {
  const out: CableClip[] = [];
  if (h.cables.length === 0) return out;
  const cx = project.cells.reduce((a, c) => a + c.x, 0) / project.cells.length;
  const cy = project.cells.reduce((a, c) => a + c.y, 0) / project.cells.length;
  for (const cable of h.cables) {
    const pts = cable.points;
    // I tratti sul fianco sono gli ultimi due prima dell'estremità: lungo il lato laterale e lungo il lato di uscita.
    for (let k = pts.length - 3; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const u = { x: (b.x - a.x) / len, y: (b.z - a.z) / len };
      // Normale: dal centro del pacco verso il tratto, tolta la componente lungo il tratto.
      const rel = { x: a.x - cx, y: a.z - cy };
      const along = rel.x * u.x + rel.y * u.y;
      let n = { x: rel.x - u.x * along, y: rel.y - u.y * along };
      const nl = Math.hypot(n.x, n.y);
      if (nl < 1e-6) continue;
      n = { x: n.x / nl, y: n.y / nl };
      const info = project.cells.flatMap((c) => {
        const t = findCellType(project, c.typeId);
        return t ? [{ c, r: t.diameterMm / 2, ext: c.x * n.x + c.y * n.y + t.diameterMm / 2 }] : [];
      });
      const extreme = Math.max(...info.map((i) => i.ext));
      // Solo le celle che toccano il fianco: il cavo corre a filo di quelle.
      const flank = info
        .filter((i) => i.ext >= extreme - 0.3)
        .map((i) => ({ ...i, t: (i.c.x - a.x) * u.x + (i.c.y - a.z) * u.y }))
        .filter((i) => i.t >= -i.r && i.t <= len + i.r)
        .sort((p, q) => p.t - q.t);
      let lastT = -Infinity;
      for (const f of flank) {
        if (f.t - lastT < spacingMm) continue;
        lastT = f.t;
        out.push({
          cellId: f.c.id,
          cable: cable.label,
          center: { x: f.c.x, y: cable.points[1]!.y, z: f.c.y },
          out: n,
          along: u,
          spec: clipSpec(project, f.r * 2, cable.odMm),
        });
      }
    }
  }
  return out;
}
