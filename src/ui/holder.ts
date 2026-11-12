import { renderKey } from '../i18n';
import type { Region } from '../core/clip';
import { findCellType } from '../core/catalog';
import { boundsOfCells, type Rect } from '../core/geometry';
import { analyzeHolder, buildHolder, DEFAULT_HOLDER_SETTINGS, type HolderModel, type HolderReport, type HolderSettings } from '../core/holder';
import { splitHolder, type HolderSplit } from '../core/holderSplit';
import type { Pt } from '../core/polygon';
import type { Project } from '../core/types';

/** Holder shared by editor, 3D and panel, with a small cache. */

let last: { project: Project; key: string; model: HolderModel | null; report: HolderReport | null; split: HolderSplit | null } | null = null;

/** `split` is set only if the plate is larger than the print bed and must be split into pieces to glue. */
/** Holder cuts tied to the BMS: grooves for the wires and NTC pocket. Computed by the strips panel (it cannot be imported here without a cycle). */
export interface HolderCuts {
  /** Grooves for the tabs, per plate: only where the strips of that face pass. */
  notches: { top: Pt[][]; bottom: Pt[][] };
  /** Holes for the balance wires without tabs: they go through floor and walls of the plate of the strip's face. */
  wireHoles: { top: Pt[][]; bottom: Pt[][] };
  /** Outline bosses around those holes (only with the cell profile). */
  wireBosses: { top: Pt[][]; bottom: Pt[][] };
  pockets: Pt[][];
  /** Holes that also go through the floor (the NTC wire). */
  through: Pt[][];
}
const NO_CUTS: HolderCuts = { notches: { top: [], bottom: [] }, wireHoles: { top: [], bottom: [] }, wireBosses: { top: [], bottom: [] }, pockets: [], through: [] };
let cutsSource: (project: Project, settings: HolderSettings) => HolderCuts = () => NO_CUTS;
export function bindHolderCuts(get: (project: Project, settings: HolderSettings) => HolderCuts): void {
  cutsSource = get;
}

export function holderOf(project: Project, settings: HolderSettings): { model: HolderModel | null; report: HolderReport | null; split: HolderSplit | null } {
  const cuts = cutsSource(project, settings);
  const hasCuts = cuts.notches.top.length > 0 || cuts.notches.bottom.length > 0 || cuts.wireHoles.top.length > 0 || cuts.wireHoles.bottom.length > 0 || cuts.wireBosses.top.length > 0 || cuts.wireBosses.bottom.length > 0 || cuts.pockets.length > 0 || cuts.through.length > 0;
  const key = renderKey() + JSON.stringify(settings) + (hasCuts ? JSON.stringify(cuts) : ''); // the report messages depend on language and units
  if (last && last.project === project && last.key === key) return last;
  const buildFor = (face: 'top' | 'bottom') => ({ notches: cuts.notches[face], extraPockets: cuts.pockets, throughHoles: [...cuts.through, ...cuts.wireHoles[face]], addOuter: cuts.wireBosses[face] });
  const same = JSON.stringify([cuts.notches.top, cuts.wireHoles.top, cuts.wireBosses.top]) === JSON.stringify([cuts.notches.bottom, cuts.wireHoles.bottom, cuts.wireBosses.bottom]);
  const topModel = buildHolder(project, settings, true, buildFor('top'));
  let model = topModel;
  if (!same && topModel) {
    const bottomModel = buildHolder(project, settings, true, buildFor('bottom'));
    if (bottomModel) model = { ...topModel, halves: { top: topModel, bottom: bottomModel } };
  }
  // Split plates (too big for the bed) still have the grooves and holes of both faces.
  const both = { notches: [...cuts.notches.top, ...cuts.notches.bottom], extraPockets: cuts.pockets, throughHoles: [...cuts.through, ...cuts.wireHoles.top, ...cuts.wireHoles.bottom], addOuter: [...cuts.wireBosses.top, ...cuts.wireBosses.bottom] };
  const split = model ? splitHolder(project, settings, same ? buildFor('top') : both) : null;
  const report = model ? analyzeHolder(project, model, split) : null;
  last = { project, key, model, report, split };
  return last;
}

/** Pack extent: cells only, or with the two holder plates if `withHolder`. */
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
/** SVG path of a set of shapes (to draw with fill-rule evenodd). */
/** Segments of the cut lines as an SVG path. */
export const seamsPath = (seams: readonly (readonly [Pt, Pt])[]) =>
  seams.map(([a, b]) => `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}`).join(' ');

export const regionsPath = (regions: readonly Region[]) => regions.flatMap((r) => [r.outline, ...r.holes]).map(ring).join(' ');

// ---- Holder settings: remembered in the browser and also written in the project file

const KEY = 'cellalab:holder:v2';
type NumKey = Exclude<keyof HolderSettings, 'lockCells' | 'shape' | 'ntc' | 'wireHoles'>;
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
  ntcMm: [2, 12],
};

export const clampHolder = (key: NumKey, v: number): number =>
  Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], v));

/** Valid settings from any data (file or browser): wrong or missing fields go back to the default value. */
export function sanitizeHolderSettings(raw: unknown): HolderSettings {
  const base: HolderSettings = { ...DEFAULT_HOLDER_SETTINGS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const data = raw as Record<string, unknown>;
  for (const k of Object.keys(LIMITS) as NumKey[]) {
    const v = data[k];
    if (typeof v === 'number' && Number.isFinite(v)) base[k] = clampHolder(k, v);
  }
  if (typeof data.lockCells === 'boolean') base.lockCells = data.lockCells;
  if (typeof data.ntc === 'boolean') base.ntc = data.ntc;
  if (typeof data.wireHoles === 'boolean') base.wireHoles = data.wireHoles;
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
    /* storage not available: the app works anyway */
  }
}

// ---- Holder appearance (colour, visible plates): graphics only, does not change the geometry

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
    /* storage not available: the app works anyway */
  }
}
