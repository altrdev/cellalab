import { findCellType } from './catalog';
import { digitPolygons } from './engrave';
import { convexHull } from './polygon';
import { circlePolygon, closeRegions, differenceRegions, offsetRegions, regionArea, unionAll, type Region } from './clip';
import type { Rect } from './geometry';
import type { Pt } from './polygon';
import type { HolderSplit } from './holderSplit';
import type { Project } from './types';
import { t } from '../i18n';
import { len, lenLabel, lenNum, temp } from '../units';

/**
 * Monolithic two-plate holder (top and bottom). Each plate is a "cap":
 *  - a thin floor (`floorMm`) resting on the pole rim, with a hole for the terminal;
 *  - the walls (`lipMm`) wrapping the cells, with one pocket per cell (radius + clearance).
 * The two plates have the same plan layout; the finished pack is "cell height + 2 floors" tall.
 * The outer outline follows the cells, with the concave corners rounded and the outer edge chamfered.
 */

export type HolderShape = 'profile' | 'rounded';

export interface HolderSettings {
  /** Wall thickness around the cells, mm. */
  wallMm: number;
  /** Clearance per side between cell and pocket, mm. */
  clearanceMm: number;
  /** Floor thickness (the rim that holds the cell), mm. */
  floorMm: number;
  /** How far the walls wrap the cell, mm. */
  lipMm: number;
  /** Width of the retaining rim over the pole, mm: the hole has radius R − rim. */
  ledgeMm: number;
  /** `profile`: the outline follows the cells; `rounded`: convex outline with rounded corners. */
  shape: HolderShape;
  /** Fillet radius of the concave corners of the outline, mm (0 = sharp corners). Only with `profile`. */
  filletMm: number;
  /** Chamfer of the outer edge, mm (0 = none). */
  chamferMm: number;
  /** With the floor that locks the cells on the pole side; off, the walls are open from side to side. */
  lockCells: boolean;
  /** Print bed (usable area), mm. */
  bedXMm: number;
  bedYMm: number;
  /** Pocket for the NTC sensor (only if the BMS has an NTC input) and sensor diameter, mm. */
  ntc: boolean;
  ntcMm: number;
  /** Without balance tabs: a small hole in the holder next to each strip, from which the wire exits. */
  wireHoles: boolean;
}

export const DEFAULT_HOLDER_SETTINGS: HolderSettings = {
  wallMm: 1.6,
  clearanceMm: 0.15,
  floorMm: 0.6,
  lipMm: 8,
  ledgeMm: 0.8,
  shape: 'profile',
  filletMm: 3,
  chamferMm: 0.6,
  lockCells: true,
  bedXMm: 220,
  bedYMm: 220,
  ntc: true,
  ntcMm: 5,
  wireHoles: false,
};

/** Minimum wall thickness between two pockets to print it well (two passes with a 0.4 nozzle). */
export const MIN_PRINT_WALL_MM = 0.8;

/** Gaps between cells smaller than this (mm²) are filled with plastic. */
export const MIN_OPEN_GAP_MM2 = 25;

/** Chamfer step: like the layer of a typical print, 0.2 mm. */
const CHAMFER_STEP_MM = 0.2;

/** A slice of the plate: shapes from `z0` to `z1`, with z measured from the outer face of the floor towards the wall rim. */
export interface HolderLayer {
  z0: number;
  z1: number;
  regions: Region[];
}

export interface HolderModel {
  settings: HolderSettings;
  /** Cell height used for the two plates (the tallest). */
  cellHeightMm: number;
  /** Actual wall depth (limited to half a cell). */
  lipMm: number;
  /** Actual floor thickness (0 if the cells are not locked). */
  floorMm: number;
  /** Total thickness of a plate: floor + walls. */
  totalMm: number;
  /** Smusso effettivo, mm. */
  chamferMm: number;
  /** Floor: outer outline with the terminal holes (empty if the cells are not locked). */
  slab: Region[];
  /** Walls: outer outline with the cell pockets. */
  wall: Region[];
  /** Slices of the plate, from the outer face to the wall rim. */
  layers: HolderLayer[];
  /** The two plates when they are not equal (grooves only where the tabs pass): each is a complete model; the rest of this model is that of the top plate. */
  halves?: { top: HolderModel; bottom: HolderModel };
  /**
   * Continuous ramp chamfer (only with `smooth`): the slices step back by `chamferMm` on the two faces and the chamfer
   * is the sloped blend between the full outline (`a`) and the set-back one (`b`). Pairs of matching outlines.
   */
  ramp: { contours: { a: Pt[]; b: Pt[] }[] } | null;
  /** Diameter of the terminal hole on the smallest cell, mm (null if there is no floor). */
  openingDiameterMm: number | null;
  /** Ingombro in pianta. */
  bounds: Rect;
}

export type HolderIssueLevel = 'error' | 'warning' | 'info';
export interface HolderIssue {
  level: HolderIssueLevel;
  text: string;
}

export interface HolderReport {
  widthMm: number;
  depthMm: number;
  /** Total pack height with the holder: cells + two floors. */
  totalHeightMm: number;
  /** Thinnest wall between two neighbouring pockets, mm (null with a single cell). */
  minWallBetweenMm: number | null;
  /** Plastic volume of one plate, mm³. */
  volumeMm3: number;
  /** Pieces each plate is split into (1 if it fits the bed). */
  pieces: number;
  issues: HolderIssue[];
}

const regionsArea = (rs: readonly Region[]) => rs.reduce((s, r) => s + regionArea(r), 0);

function boundsOf(regions: readonly Region[]): Rect {
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

/** Builds the outlines of the two plates. Null if there are no cells. */
const centroidOf = (pts: readonly Pt[]): Pt => ({
  x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
  y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
});

/** Pairs the outlines of `A` with those of `B` by nearness of centroids; null if the counts differ. */
function matchContours(A: readonly Pt[][], B: readonly Pt[][]): { a: Pt[]; b: Pt[] }[] | null {
  if (A.length !== B.length) return null;
  const free = new Set(B.map((_, i) => i));
  const out: { a: Pt[]; b: Pt[] }[] = [];
  for (const a of A) {
    const ca = centroidOf(a);
    let best = -1;
    let bestD = Infinity;
    for (const i of free) {
      const cb = centroidOf(B[i]!);
      const d = (ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    free.delete(best);
    out.push({ a, b: B[best]! });
  }
  return out;
}

/** Paired full and set-back outlines (outer outline and holes of each region); null if the set-back changes the topology. */
function rampContours(outer: readonly Region[], inner: readonly Region[]): { a: Pt[]; b: Pt[] }[] | null {
  const regions = matchContours(outer.map((r) => r.outline), inner.map((r) => r.outline));
  if (!regions) return null;
  const out = [...regions];
  for (const m of regions) {
    const ro = outer.find((r) => r.outline === m.a)!;
    const ri = inner.find((r) => r.outline === m.b)!;
    const holes = matchContours(ro.holes, ri.holes);
    if (!holes) return null;
    out.push(...holes);
  }
  return out;
}


/** Options for special pieces (test piece); the normal holder does not use them. */
export interface BuildOptions {
  /** Clearance per cell (same order as `project.cells`) in place of `settings.clearanceMm`. */
  clearances?: readonly number[];
  /** Solid shapes to join to the outer outline (for example a strip for the labels). */
  addOuter?: readonly (readonly Pt[])[];
  /** Shapes to engrave on the wall rim, `engraveMm` deep. */
  engrave?: readonly (readonly Pt[])[];
  engraveMm?: number;
  /** Notches to remove from the outer outline (grooves for the wires): through the whole plate thickness. */
  notches?: readonly (readonly Pt[])[];
  /** Extra pockets in the walls (not in the floor), for example the NTC one: holes between the cell pockets. */
  extraPockets?: readonly (readonly Pt[])[];
  /** Extra holes that also go through the floor (for example the NTC wire). */
  throughHoles?: readonly (readonly Pt[])[];
}

/**
 * With `smooth` the chamfer is not a staircase of steps (needed only if you want to see them as print layers) but a
 * continuous sloped ramp: the slices stay few and `ramp` holds the outlines to blend.
 */
export function buildHolder(
  project: Project,
  settings: HolderSettings = DEFAULT_HOLDER_SETTINGS,
  smooth = false,
  opts: BuildOptions = {},
): HolderModel | null {
  const { clearances } = opts;
  const cells = project.cells.flatMap((c, i) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ c, r: t.diameterMm / 2, h: t.heightMm, cl: clearances?.[i] ?? settings.clearanceMm }] : [];
  });
  if (cells.length === 0) return null;
  const s = settings;
  const cellHeightMm = Math.max(...cells.map((x) => x.h));
  const floorMm = s.lockCells ? s.floorMm : 0;
  const lipMm = Math.max(1, Math.min(s.lipMm, cellHeightMm / 2 - 1 - floorMm));
  const totalMm = floorMm + lipMm;
  // the chamfer cannot eat the whole wall nor more than half the plate
  const chamferMm = Math.max(0, Math.min(s.chamferMm, s.wallMm * 0.75, totalMm / 2 - 0.05));

  const merged = unionAll([...cells.map(({ c, r, cl }) => circlePolygon(c.x, c.y, r + cl + s.wallMm)), ...(opts.addOuter ?? [])]);
  let outer: Region[];
  if (s.shape === 'rounded') {
    // Convex outline of each cell group: the round edges are the arcs of the corner cells.
    outer = unionAll(merged.map((reg) => convexHull(reg.outline)));
  } else {
    // Fillet of the concave corners; the tiny slits that remain cannot be printed: they are filled.
    outer = closeRegions(merged, s.filletMm).map((reg) => ({
      outline: reg.outline,
      holes: reg.holes.filter((hole) => regionArea({ outline: hole, holes: [] }) >= MIN_OPEN_GAP_MM2),
    }));
  }
  if (opts.notches && opts.notches.length > 0) outer = differenceRegions(outer, opts.notches);
  const pockets = cells.map(({ c, r, cl }) => circlePolygon(c.x, c.y, r + cl));
  const openings = cells.map(({ c, r }) => circlePolygon(c.x, c.y, Math.max(r - s.ledgeMm, 1)));
  const through = opts.throughHoles ?? [];
  const extra = opts.extraPockets ?? [];
  const wallPocketsCut = [...pockets, ...extra, ...through];
  const slabOpeningsCut = [...openings, ...through];
  // Reference outlines (drawing, split into pieces): without the NTC pocket, which is on one plate only and only in the slices.
  const wall = differenceRegions(outer, pockets);
  const slab = s.lockCells ? differenceRegions(outer, openings) : [];

  // Ramp chamfer: set-back outline and pairs of outlines to blend (if the topology holds).
  let ramp: HolderModel['ramp'] = null;
  if (smooth && chamferMm > 0) {
    const contours = rampContours(outer, offsetRegions(outer, -chamferMm));
    if (contours) ramp = { contours };
  }

  // Slices: at the chamfer edges the outer outline steps back; below `floorMm` it is cut with the holes, above with the pockets.
  const engrave = opts.engrave && opts.engrave.length > 0 ? opts.engrave : null;
  const engraveFromZ = totalMm - Math.max(0, Math.min(opts.engraveMm ?? 0, totalMm - floorMm - 0.4));
  const makeLayers = (wallPockets: readonly (readonly Pt[])[], slabOpenings: readonly (readonly Pt[])[]): HolderLayer[] => {
    const cuts = new Set<number>([0, floorMm, totalMm]);
    if (engrave) cuts.add(engraveFromZ);
    if (ramp) {
      cuts.add(chamferMm);
      cuts.add(totalMm - chamferMm);
    } else if (chamferMm > 0) {
      const n = Math.max(1, Math.ceil(chamferMm / CHAMFER_STEP_MM - 1e-9));
      for (let i = 0; i <= n; i++) {
        cuts.add((chamferMm * i) / n);
        cuts.add(totalMm - (chamferMm * i) / n);
      }
    }
    const zs = [...cuts].map((z) => Math.round(z * 1e6) / 1e6).sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1]! > 1e-6);
    const cache = new Map<string, Region[]>();
    const layers: HolderLayer[] = [];
    let lastKey = '';
    for (let i = 0; i + 1 < zs.length; i++) {
      const z0 = zs[i]!;
      const z1 = zs[i + 1]!;
      const mid = (z0 + z1) / 2;
      const inset = ramp
        ? mid < chamferMm || mid > totalMm - chamferMm
          ? chamferMm
          : 0
        : chamferMm > 0
          ? Math.max(0, chamferMm - mid, mid - (totalMm - chamferMm))
          : 0;
      const useSlab = s.lockCells && mid < floorMm;
      const engraved = !!engrave && mid > engraveFromZ && !useSlab;
      const key = `${inset.toFixed(4)}|${useSlab ? 's' : 'w'}${engraved ? 'e' : ''}`;
      let regions = cache.get(key);
      if (!regions) {
        regions = differenceRegions(inset > 1e-9 ? offsetRegions(outer, -inset) : outer, useSlab ? slabOpenings : wallPockets);
        if (engraved) regions = differenceRegions(regions, engrave!);
        cache.set(key, regions);
      }
      const prev = layers[layers.length - 1];
      if (prev && key === lastKey) prev.z1 = z1;
      else layers.push({ z0, z1, regions });
      lastKey = key;
    }
    return layers;
  };
  const layers = makeLayers(wallPocketsCut, slabOpeningsCut);

  const minR = Math.min(...cells.map((x) => x.r));
  return {
    settings: s,
    cellHeightMm,
    lipMm,
    floorMm,
    totalMm,
    chamferMm,
    slab,
    wall,
    layers,
    ramp,
    openingDiameterMm: s.lockCells ? 2 * Math.max(minR - s.ledgeMm, 1) : null,
    bounds: boundsOf(outer),
  };
}

/** Volume of the two wedges of the ramp chamfer: ring between full and set-back outline, for half of the chamfer, on each face. */
function rampVolume(model: HolderModel): number {
  if (!model.ramp) return 0;
  const area = (pts: Pt[]) => regionArea({ outline: pts, holes: [] });
  return model.ramp.contours.reduce((v, c) => v + Math.abs(area(c.a) - area(c.b)), 0) * model.chamferMm;
}

/** Fits the print bed, even rotated by 90°. */
export const fitsBed = (w: number, d: number, s: Pick<HolderSettings, 'bedXMm' | 'bedYMm'>) =>
  (w <= s.bedXMm && d <= s.bedYMm) || (w <= s.bedYMm && d <= s.bedXMm);

export function analyzeHolder(project: Project, model: HolderModel, split: HolderSplit | null = null): HolderReport {
  const s = model.settings;
  const widthMm = model.bounds.maxX - model.bounds.minX;
  const depthMm = model.bounds.maxY - model.bounds.minY;
  const issues: HolderIssue[] = [];

  let minWall: number | null = null;
  const list = project.cells.flatMap((c) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ x: c.x, y: c.y, r: t.diameterMm / 2 }] : [];
  });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > a.r + b.r + 8) continue;
      const wall = d - a.r - b.r - 2 * s.clearanceMm;
      if (minWall === null || wall < minWall) minWall = wall;
    }
  }
  if (minWall !== null) {
    if (minWall <= 0) {
      issues.push({
        level: 'error',
        text: t('holder.issue.overlap'),
      });
    } else if (minWall < MIN_PRINT_WALL_MM) {
      issues.push({
        level: 'warning',
        text: t('holder.issue.thinWall', { wall: len(minWall, 2), min: len(MIN_PRINT_WALL_MM, 1) }),
      });
    }
  }

  const bedArgs = { w: lenNum(widthMm, 0), d: lenNum(depthMm, 0), bx: lenNum(s.bedXMm, 0), by: lenNum(s.bedYMm, 0), u: lenLabel() };
  if (split) {
    // too big for the bed: split into pieces (and, if some still do not fit that way, a warning)
    issues.push({ level: 'info', text: t('holder.issue.split', { ...bedArgs, n: split.pieces.length, ids: split.pieces.map((p) => p.id).join(', ') }) });
    if (!split.allFit) {
      issues.push({ level: 'warning', text: t('holder.issue.pieceBed', { ids: split.pieces.filter((p) => !p.fits).map((p) => p.id).join(', ') }) });
    }
  } else if (!fitsBed(widthMm, depthMm, s)) {
    issues.push({ level: 'warning', text: t('holder.issue.bed', bedArgs) });
  }
  if (model.lipMm < s.lipMm - 1e-9) {
    issues.push({ level: 'info', text: t('holder.issue.lip', { lip: len(model.lipMm, 1) }) });
  }
  if (model.chamferMm < s.chamferMm - 1e-9) {
    issues.push({ level: 'info', text: t('holder.issue.chamfer', { chamfer: len(model.chamferMm, 2) }) });
  }
  if (!s.lockCells) {
    issues.push({ level: 'info', text: t('holder.issue.noFloor') });
  }
  issues.push({
    level: 'info',
    text: t('holder.issue.material', { temp: temp(60, 0) }),
  });

  return {
    widthMm,
    depthMm,
    totalHeightMm: model.cellHeightMm + 2 * model.floorMm,
    minWallBetweenMm: minWall,
    volumeMm3: model.layers.reduce((v, l) => v + regionsArea(l.regions) * (l.z1 - l.z0), 0) + rampVolume(model),
    pieces: split?.pieces.length ?? 1,
    issues,
  };
}

/** Wall depth of the test piece, mm: enough to feel the clearance without wasting plastic. */
const TOLERANCE_TEST_LIP_MM = 4;
/** Engraved digits: height, stroke (two passes with a 0.4 nozzle) and depth, mm. */
const TEST_DIGIT_MM = 5;
const TEST_STROKE_MM = 0.8;
const TEST_ENGRAVE_MM = 1;

export const DEFAULT_TEST_CLEARANCES_MM = [0.1, 0.2, 0.3];

/** The clearance written on the piece: hundredths of a mm, so 0.15 mm → "15". */
export const clearanceLabel = (clearanceMm: number) => String(Math.round(clearanceMm * 100));

/**
 * Test piece to calibrate the clearance: a low plate with a row of pockets, each with a different clearance
 * (from the tightest on the left to the loosest on the right). Under each pocket a strip with the clearance engraved
 * in hundredths of a mm ("10" = 0.10 mm). It has the same settings as the real holder, so the test holds
 * for what is printed afterwards. Null if the cell type does not exist or there are no clearances.
 */
export function buildToleranceTest(
  project: Pick<Project, 'customCellTypes'>,
  typeId: string,
  clearancesMm: readonly number[] = DEFAULT_TEST_CLEARANCES_MM,
  settings: HolderSettings = DEFAULT_HOLDER_SETTINGS,
): HolderModel | null {
  const t = findCellType(project, typeId);
  if (!t || clearancesMm.length === 0) return null;
  const clearances = [...clearancesMm].sort((a, b) => a - b);
  const r = t.diameterMm / 2;
  const clMax = clearances[clearances.length - 1]!;
  const pitch = t.diameterMm + 2 * clMax + settings.wallMm;
  const cells = clearances.map((_, i) => ({
    id: `test${i}`,
    typeId,
    x: i * pitch,
    y: 0,
    plusUp: true,
    group: null,
  }));
  const test: Project = { version: 1, name: 'test', customCellTypes: project.customCellTypes, cells };

  // strip under the row: partly inside the pockets (which cut into it) and reaching under the outer radius
  const edge = r + clMax + settings.wallMm;
  const textY = edge + 1.2 + TEST_DIGIT_MM / 2;
  const strip: Pt[] = [
    { x: -edge, y: 0 },
    { x: (clearances.length - 1) * pitch + edge, y: 0 },
    { x: (clearances.length - 1) * pitch + edge, y: textY + TEST_DIGIT_MM / 2 + 1.2 },
    { x: -edge, y: textY + TEST_DIGIT_MM / 2 + 1.2 },
  ];
  const engrave = clearances.flatMap((cl, i) => digitPolygons(clearanceLabel(cl), i * pitch, textY + i * 0.021, TEST_DIGIT_MM, TEST_STROKE_MM));
  return buildHolder(test, { ...settings, lipMm: Math.min(settings.lipMm, TOLERANCE_TEST_LIP_MM) }, true, {
    clearances,
    addOuter: [strip],
    engrave,
    engraveMm: TEST_ENGRAVE_MM,
  });
}
