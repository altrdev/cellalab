import type { Region } from '../core/clip';
import { findCellType } from '../core/catalog';
import { boundsOfCells, type Rect } from '../core/geometry';
import { analyzeHolder, buildHolder, DEFAULT_HOLDER_SETTINGS, type HolderModel, type HolderReport, type HolderSettings } from '../core/holder';
import type { Pt } from '../core/polygon';
import type { Project } from '../core/types';

/** Portacelle condiviso da editor, 3D e pannello, con una piccola cache. */

let last: { project: Project; key: string; model: HolderModel | null; report: HolderReport | null } | null = null;

export function holderOf(project: Project, settings: HolderSettings): { model: HolderModel | null; report: HolderReport | null } {
  const key = JSON.stringify(settings);
  if (last && last.project === project && last.key === key) return last;
  const model = buildHolder(project, settings, true);
  const report = model ? analyzeHolder(project, model) : null;
  last = { project, key, model, report };
  return last;
}

/** Ingombro del pacco: solo celle, oppure con le due piastre del portacelle se `withHolder`. */
export interface PackExtent extends Rect {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  withHolder: boolean;
}

export function packExtent(project: Project, settings: HolderSettings, withHolder: boolean): PackExtent | null {
  const cells = boundsOfCells(project);
  if (!cells) return null;
  if (withHolder) {
    const { model, report } = holderOf(project, settings);
    if (model && report) {
      const b = model.bounds;
      return { ...b, widthMm: b.maxX - b.minX, depthMm: b.maxY - b.minY, heightMm: report.totalHeightMm, withHolder: true };
    }
  }
  let h = 0;
  for (const c of project.cells) h = Math.max(h, findCellType(project, c.typeId)?.heightMm ?? 0);
  return { ...cells, widthMm: cells.maxX - cells.minX, depthMm: cells.maxY - cells.minY, heightMm: h, withHolder: false };
}

const ring = (pts: readonly Pt[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';
/** Percorso SVG di un insieme di forme (da disegnare con fill-rule evenodd). */
export const regionsPath = (regions: readonly Region[]) => regions.flatMap((r) => [r.outline, ...r.holes]).map(ring).join(' ');

// ---- Impostazioni del portacelle: ricordate nel browser e scritte anche nel file del progetto

const KEY = 'cellalab:holder:v2';
type NumKey = Exclude<keyof HolderSettings, 'lockCells' | 'shape'>;
const LIMITS: Record<NumKey, [number, number]> = {
  wallMm: [0.8, 6],
  clearanceMm: [0, 1],
  floorMm: [0.6, 4],
  lipMm: [2, 30],
  ledgeMm: [0.5, 4],
  filletMm: [0, 10],
  chamferMm: [0, 2],
  bedXMm: [50, 1000],
  bedYMm: [50, 1000],
};

export const clampHolder = (key: NumKey, v: number): number =>
  Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], v));

/** Impostazioni valide da dati qualunque (file o browser): i campi sbagliati o mancanti tornano al valore di default. */
export function sanitizeHolderSettings(raw: unknown): HolderSettings {
  const base: HolderSettings = { ...DEFAULT_HOLDER_SETTINGS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const data = raw as Record<string, unknown>;
  for (const k of Object.keys(LIMITS) as NumKey[]) {
    const v = data[k];
    if (typeof v === 'number' && Number.isFinite(v)) base[k] = clampHolder(k, v);
  }
  if (typeof data.lockCells === 'boolean') base.lockCells = data.lockCells;
  if (data.shape === 'profile' || data.shape === 'rounded') base.shape = data.shape;
  return base;
}

export function loadHolderSettings(): HolderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeHolderSettings(JSON.parse(raw)) : { ...DEFAULT_HOLDER_SETTINGS };
  } catch {
    return { ...DEFAULT_HOLDER_SETTINGS };
  }
}

export function saveHolderSettings(s: HolderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage non disponibile: l'app funziona lo stesso */
  }
}

// ---- Aspetto del portacelle (colore, piastre visibili): solo grafica, non cambia la geometria

export interface HolderView {
  color: string;
  showTop: boolean;
  showBottom: boolean;
}

export const DEFAULT_HOLDER_VIEW: HolderView = { color: '#353b41', showTop: true, showBottom: true };
const VIEW_KEY = 'cellalab:holder-view';

export function loadHolderView(): HolderView {
  const base = { ...DEFAULT_HOLDER_VIEW };
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return base;
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color)) base.color = d.color;
    if (typeof d.showTop === 'boolean') base.showTop = d.showTop;
    if (typeof d.showBottom === 'boolean') base.showBottom = d.showBottom;
  } catch {
    /* si parte dai valori predefiniti */
  }
  return base;
}

export function saveHolderView(v: HolderView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* storage non disponibile: l'app funziona lo stesso */
  }
}
