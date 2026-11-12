import { findCellType } from './catalog';
import { CABLE_GAP_MM, type Harness, type HarnessCable, type Pt3 } from './harness';
import type { PlacedCell } from './types';
import type { Pt } from './polygon';
import type { Project } from './types';

/**
 * Fermacavi stampati a scatto per i cavi di potenza. Ogni fermacavo è una fascia a C che si incastra su una cella del fianco
 * (si spinge da fuori, le braccia si aprono e si chiudono sulla cella) con, ai bordi della bocca, due ganci dove il cavo
 * si preme dall'alto e resta fermo, appoggiato alla cella. Qui si decide dove vanno e di che misure; la forma la fa `ui/clipMesh.ts`.
 */

/**
 * `valley`: blocco che sta nel vuoto tra due celle del fianco (una lama sottile nella fessura, un corpo con un incavo a U per
 * il cavo): è quello della foto. `band`: fascia a C attorno a una cella, per i tratti dove non c'è un vuoto tra due celle.
 */
export type ClipKind = 'valley' | 'band';

export interface ClipSpec {
  kind: ClipKind;
  cellDiameterMm: number;
  cableOdMm: number;
  /** Solo valley: spessore della lama nella fessura tra due celle, e quanto scende, mm. */
  bladeMm: number;
  bladeDepthMm: number;
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
  /** Band: asse della cella a metà altezza. Valley: punto sulla tangente del fianco nel vuoto, all'altezza del cavo. Nella scena. */
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

/** Distanza minima tra le superfici di due celle del pacco, mm. */
export function minCellGap(project: Project): number {
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
  return Number.isFinite(gap) ? gap : 1.5;
}

export function clipSpec(project: Project, cellDiameterMm: number, cableOdMm: number, kind: ClipKind = 'band'): ClipSpec {
  // Spessore: quello che entra nel vuoto tra due celle (distanza minima tra le celle meno il gioco).
  const gap = minCellGap(project);
  const t = Math.max(0.8, Math.min(1.4, gap - 0.25 - CLIP_FIT_MM));
  return {
    kind,
    cellDiameterMm,
    cableOdMm,
    bladeMm: Math.round(Math.max(0.6, Math.min(1.2, gap - 0.4)) * 100) / 100,
    bladeDepthMm: Math.round(Math.min(8, cellDiameterMm / 2 - 1) * 10) / 10,
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
    // I tratti sul fianco vanno dal piede della discesa fino all'angolo dove i cavi si incontrano (poi c'è la coda libera).
    for (let k = 2; k + 1 <= cable.tailFrom; k++) {
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
      // Prima i vuoti tra due celle vicine del fianco (blocco a lama); se non ce ne sono, una fascia sulle celle del fianco.
      const near = pitchOf(info.map((i) => i.c)) * 1.25 + 1e-6;
      const valleys: { t: number }[] = [];
      for (let i = 0; i + 1 < flank.length; i++) {
        const [fa, fb] = [flank[i]!, flank[i + 1]!];
        if (Math.hypot(fa.c.x - fb.c.x, fa.c.y - fb.c.y) <= near) valleys.push({ t: (fa.t + fb.t) / 2 });
      }
      let lastT = -Infinity;
      if (valleys.length > 0) {
        for (const v of valleys) {
          if (v.t < 0 || v.t > len || v.t - lastT < spacingMm) continue;
          lastT = v.t;
          const od = cable.odMm;
          const pt = { x: a.x + u.x * v.t, z: a.z + u.y * v.t };
          const off = CABLE_GAP_MM + od / 2; // dalla tangente del fianco al centro del cavo
          out.push({
            cellId: '',
            cable: cable.label,
            center: { x: pt.x - n.x * off, y: a.y, z: pt.z - n.y * off },
            out: n,
            along: u,
            spec: clipSpec(project, flank[0]!.r * 2, od, 'valley'),
          });
        }
        continue;
      }
      for (const f of flank) {
        if (f.t - lastT < spacingMm) continue;
        lastT = f.t;
        out.push({
          cellId: f.c.id,
          cable: cable.label,
          center: { x: f.c.x, y: cable.points[1]!.y, z: f.c.y },
          out: n,
          along: u,
          spec: clipSpec(project, f.r * 2, cable.odMm, 'band'),
        });
      }
    }
  }
  return out;
}

/** Distanza minima tra i centri di due celle. */
function pitchOf(cells: readonly PlacedCell[]): number {
  let p = Infinity;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) p = Math.min(p, Math.hypot(cells[i]!.x - cells[j]!.x, cells[i]!.y - cells[j]!.y));
  return p;
}
