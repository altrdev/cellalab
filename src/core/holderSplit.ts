import { findCellType } from './catalog';
import { intersectRegions, pointInRegions, unionAll, type Region } from './clip';
import { buildHolder, fitsBed, type BuildOptions, type HolderModel, type HolderSettings } from './holder';
import type { Pt } from './polygon';
import type { Project } from './types';

/**
 * Divisione di un portacelle più grande del piano di stampa in pezzi da incollare.
 *
 * Le celle si dividono in gruppi con una griglia di tagli verticali e orizzontali (il minor numero di pezzi che
 * entra nel piano). Il pezzo di un gruppo è la sagoma del portacelle intersecata con la regione delle sue celle,
 * calcolata col «diagramma di potenza» dei cerchi delle tasche: il confine tra due celle è la retta (asse radicale)
 * che passa nella parete tra le due tasche, quindi **un taglio non attraversa mai una tasca**, nemmeno nel nido d'ape.
 * I pezzi sono fatti con lo smusso a gradini (la rampa liscia non si può tagliare lungo le giunzioni); le facce di
 * taglio sono piatte e senza smusso, da incollare.
 */

export interface HolderPiece {
  /** Sigla del pezzo: riga (A, B, …) e colonna (1, 2, …), per esempio «B2». */
  id: string;
  cellIds: string[];
  /** Le due piastre di questo pezzo (stessa forma sopra e sotto), pronte per la mesh e per l'STL. */
  model: HolderModel;
  widthMm: number;
  depthMm: number;
  /** Il pezzo entra nel piano solo ruotato di 90°. */
  rotated: boolean;
  /** Entra nel piano di stampa (anche ruotato). */
  fits: boolean;
}

export interface HolderSplit {
  pieces: HolderPiece[];
  /** Segmenti delle linee di taglio dentro il materiale (per disegnarle). */
  seams: [Pt, Pt][];
  /** Tutti i pezzi entrano nel piano. */
  allFit: boolean;
}

const MAX_SPLITS_PER_AXIS = 8;

interface Disc {
  id: string;
  x: number;
  y: number;
  /** Raggio della tasca. */
  r: number;
}

/** Ritaglia un poligono convesso col semipiano `nx·x + ny·y ≤ k` (Sutherland–Hodgman). */
function clipHalfPlane(poly: readonly Pt[], nx: number, ny: number, k: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = nx * a.x + ny * a.y - k;
    const db = nx * b.x + ny * b.y - k;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}

/** Soglie che separano `parts` gruppi lungo un asse: vicine a quote uguali, a metà tra due valori diversi. */
function thresholds(values: readonly number[], parts: number): number[] {
  const u = [...new Set(values.map((v) => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);
  if (parts <= 1 || u.length <= 1) return [];
  const lo = u[0]!;
  const hi = u[u.length - 1]!;
  const out = new Set<number>();
  for (let k = 1; k < parts; k++) {
    const ideal = lo + ((hi - lo) * k) / parts;
    let i = 0;
    while (i + 1 < u.length && u[i + 1]! <= ideal) i++;
    if (i + 1 < u.length) out.add((u[i]! + u[i + 1]!) / 2);
  }
  return [...out].sort((a, b) => a - b);
}

const indexOf = (v: number, cuts: readonly number[]) => cuts.filter((c) => c < v).length;
const rowLetter = (i: number) => String.fromCharCode(65 + i);

function bounds(regions: readonly Region[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of regions) {
    for (const p of r.outline) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Divide il portacelle in pezzi che entrano nel piano di stampa. Null se non ci sono celle o se la piastra intera
 * entra già nel piano (non c'è niente da dividere).
 */
export function splitHolder(project: Project, settings: HolderSettings, opts: BuildOptions = {}): HolderSplit | null {
  const full = buildHolder(project, settings, false, opts);
  if (!full) return null;
  const width = full.bounds.maxX - full.bounds.minX;
  const depth = full.bounds.maxY - full.bounds.minY;
  if (fitsBed(width, depth, settings)) return null;

  const discs: Disc[] = project.cells.flatMap((c) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ id: c.id, x: c.x, y: c.y, r: t.diameterMm / 2 + settings.clearanceMm }] : [];
  });
  if (discs.length < 2) return null;
  const reach = Math.max(...discs.map((d) => d.r)) + settings.wallMm; // quanto la sagoma esce dal centro di una cella

  // candidati (colonne × righe) dal minor numero di pezzi in su, a parità i più «quadrati»
  const candidates: [number, number][] = [];
  for (let nx = 1; nx <= MAX_SPLITS_PER_AXIS; nx++) for (let ny = 1; ny <= MAX_SPLITS_PER_AXIS; ny++) if (nx * ny > 1) candidates.push([nx, ny]);
  candidates.sort((a, b) => a[0] * a[1] - b[0] * b[1] || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]));

  const box = { minX: full.bounds.minX - 2, minY: full.bounds.minY - 2, maxX: full.bounds.maxX + 2, maxY: full.bounds.maxY + 2 };
  const rect: Pt[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];

  const build = (nx: number, ny: number): HolderSplit => {
    const cx = thresholds(discs.map((d) => d.x), nx);
    const cy = thresholds(discs.map((d) => d.y), ny);
    const groups = new Map<string, { row: number; col: number; cells: Disc[] }>();
    for (const d of discs) {
      const row = indexOf(d.y, cy);
      const col = indexOf(d.x, cx);
      const key = `${row}:${col}`;
      const g = groups.get(key) ?? { row, col, cells: [] };
      g.cells.push(d);
      groups.set(key, g);
    }
    const ordered = [...groups.values()].sort((a, b) => a.row - b.row || a.col - b.col);
    const pieces: HolderPiece[] = [];
    const seams: [Pt, Pt][] = [];
    for (const g of ordered) {
      const inGroup = new Set(g.cells);
      const others = discs.filter((d) => !inGroup.has(d));
      // regione di ogni cella del gruppo: i punti più «vicini» (in potenza) a lei che a una cella di un altro gruppo
      const masks: Pt[][] = g.cells.map((c) => {
        let poly = rect;
        for (const o of others) {
          const nxp = o.x - c.x;
          const nyp = o.y - c.y;
          const k = (o.x * o.x + o.y * o.y - c.x * c.x - c.y * c.y + c.r * c.r - o.r * o.r) / 2;
          poly = clipHalfPlane(poly, nxp, nyp, k);
          if (poly.length < 3) break;
        }
        return poly;
      });
      const layers = full.layers
        .map((l) => ({ z0: l.z0, z1: l.z1, regions: intersectRegions(l.regions, masks) }))
        .filter((l) => l.regions.length > 0);
      const wall = intersectRegions(full.wall, masks);
      const slab = intersectRegions(full.slab, masks);
      const b = bounds(wall.length ? wall : layers.flatMap((l) => l.regions));
      const model: HolderModel = { ...full, layers, wall, slab, ramp: null, bounds: b };
      const w = b.maxX - b.minX;
      const d = b.maxY - b.minY;
      const fits = fitsBed(w, d, settings);
      pieces.push({
        id: `${rowLetter(g.row)}${g.col + 1}`,
        cellIds: g.cells.map((c) => c.id),
        model,
        widthMm: w,
        depthMm: d,
        rotated: fits && !(w <= settings.bedXMm && d <= settings.bedYMm),
        fits,
      });
      // linee di taglio: i lati della regione del gruppo che stanno dentro il materiale
      for (const region of unionAll(masks)) {
        const ring = region.outline;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]!;
          const q = ring[(i + 1) % ring.length]!;
          if (pointInRegions({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, full.wall)) seams.push([p, q]);
        }
      }
    }
    return { pieces, seams, allFit: pieces.every((p) => p.fits) };
  };

  let best: HolderSplit | null = null;
  for (const [nx, ny] of candidates) {
    // stima prudente prima di costruire: riquadro delle celle del gruppo + quanto esce la sagoma
    const cx = thresholds(discs.map((d) => d.x), nx);
    const cy = thresholds(discs.map((d) => d.y), ny);
    const boxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    for (const d of discs) {
      const key = `${indexOf(d.y, cy)}:${indexOf(d.x, cx)}`;
      const b = boxes.get(key) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      b.minX = Math.min(b.minX, d.x);
      b.maxX = Math.max(b.maxX, d.x);
      b.minY = Math.min(b.minY, d.y);
      b.maxY = Math.max(b.maxY, d.y);
      boxes.set(key, b);
    }
    if (![...boxes.values()].every((b) => fitsBed(b.maxX - b.minX + 2 * reach, b.maxY - b.minY + 2 * reach, settings))) continue;
    const attempt = build(nx, ny);
    if (attempt.pieces.length < 2) continue;
    if (attempt.allFit) return attempt;
    best ??= attempt;
  }
  // nessuna griglia basta: si restituisce la divisione più fine provata, con i pezzi che non entrano segnalati
  return best ?? build(MAX_SPLITS_PER_AXIS, MAX_SPLITS_PER_AXIS);
}
