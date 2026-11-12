import { renderKey, t } from '../i18n';
import { len } from '../units';
import type { StripOptions } from '../core/strips';
import { analyzeBusbars, DEFAULT_BUSBAR_SETTINGS, stripOptionsOf, type BusbarReport, type BusbarSettings } from '../core/busbar';
import type { Pt } from '../core/polygon';
import { spotPositions } from '../core/sizing';
import { computeStats } from '../core/stats';
import { buildStrips, type Face, type Strip, type TabSide } from '../core/strips';
import { buildHolder } from '../core/holder';
import { findAroundExits, findWireRoutes, type WireExit } from '../core/wireExit';
import { circlePoints } from '../core/polygon';
import { holeForWireMm } from '../core/wire';
import { DEFAULT_HOLDER_SETTINGS, type HolderSettings } from '../core/holder';
import { holderOf, type HolderCuts } from './holder';
import { bmsOf } from '../core/bms';
import { buildHarness, type Harness } from '../core/harness';
import { ntcSite, type NtcSite } from '../core/ntc';
import { tabNotches } from '../core/tabNotches';
import type { WelderProfile } from '../core/profiles';
import type { Project } from '../core/types';

/** Strip calculations shared by editor and panel, with a small cache so they are not done twice. */

const stripCache = new WeakMap<Project, { key: string; strips: Strip[] }>();

/** Current holder settings: registered by the interface state (it cannot be imported here without a cycle). */
let holderSettings: () => HolderSettings = () => DEFAULT_HOLDER_SETTINGS;
export function bindHolderSettings(get: () => HolderSettings): void {
  holderSettings = get;
}

export function stripsOf(project: Project, settings: BusbarSettings): Strip[] {
  const opts = optionsOf(project, settings);
  const hs = opts.tabs && project.bmsId !== undefined ? holderSettings() : null;
  const key = JSON.stringify(opts) + (hs ? JSON.stringify(hs) : '');
  const hit = stripCache.get(project);
  if (hit && hit.key === key) return hit.strips;
  // The tabs fold beyond the holder: its outer outline is needed (without the cell pockets).
  const model = hs ? holderOf(project, hs).model : null;
  const outlineOf = (m: typeof model) => (m ? m.wall.map((r) => ({ outline: r.outline, holes: [] })) : null);
  // The two plates may have different grooves: each strip folds beyond the edge of its own.
  const holderOutline = model ? { top: outlineOf(model.halves?.top ?? model)!, bottom: outlineOf(model.halves?.bottom ?? model)! } : null;
  const strips = buildStrips(project, { ...opts, holderOutline });
  // Without balance tabs the wire exits from a holder hole next to the strip.
  if (hs) for (const e of wireExitsOf(project, settings, hs)) {
    const st = strips.find((x) => x.id === e.stripId);
    if (st) st.wireExit = e;
  }
  stripCache.set(project, { key, strips });
  return strips;
}

const cutsCache = new WeakMap<Project, { key: string; cuts: HolderCuts }>();
interface NtcPlan {
  site: NtcSite | null;
}
const ntcCache = new WeakMap<Project, { key: string; plan: NtcPlan }>();
const NO_CUTS: HolderCuts = { notches: { top: [], bottom: [] }, wireHoles: { top: [], bottom: [] }, wireBosses: { top: [], bottom: [] }, pockets: [], through: [] };

const exitCache = new WeakMap<Project, { key: string; exits: WireExit[] }>();
/**
 * Wire exits from the holder (only with holes in place of the balance tabs): for each joint the
 * solder point on the strip and the hole next to it. Empty if the option is off or there are tabs.
 */
export function wireExitsOf(project: Project, settings: BusbarSettings, holder: HolderSettings): WireExit[] {
  if (settings.tabs || !bmsOf(project)) return []; // with tabs the wire starts from there
  const key = JSON.stringify([settings, holder]);
  const hit = exitCache.get(project);
  if (hit && hit.key === key) return hit.exits;
  const plain = buildHolder(project, holder, false);
  const opts = optionsOf(project, settings);
  const strips = plain && opts.tabs ? buildStrips(project, opts) : [];
  // With holes in the holder the wire goes through there; with neither holes nor tabs it takes the around route on the holder plane.
  const exits = !plain || !opts.tabs ? [] : holder.wireHoles
    ? findWireRoutes(project, strips, plain.wall, opts.tabs.side, holeForWireMm(settings.balanceAwg), plain.totalMm, plain.floorMm, settings.tabBendMm, holder.chamferMm, holder.shape === 'profile')
    : findAroundExits(project, strips, plain.wall, opts.tabs.side, plain.totalMm, plain.floorMm, settings.tabBendMm);
  exitCache.set(project, { key, exits });
  return exits;
}

/**
 * The NTC place (if there is a BMS with NTC, the pocket is on and there is a gap between three cells). Prefers the gaps where the
 * wire hole does not end up under a strip of any face: for the strips it uses the shape without holder, which is enough here.
 */
export function ntcPlanOf(project: Project, settings: BusbarSettings, holder: HolderSettings): NtcPlan {
  if (!holder.ntc || !bmsOf(project)?.ntc) return { site: null };
  const side = tabSideOf(project, settings);
  const opts = optionsOf(project, settings);
  const key = JSON.stringify([opts, side, holder.ntcMm, holder.clearanceMm]);
  const hit = ntcCache.get(project);
  if (hit && hit.key === key) return hit.plan;
  const all = buildStrips(project, opts).map((s) => ({ outline: s.outline, holes: s.holes }));
  const plan: NtcPlan = { site: ntcSite(project, side, holder.ntcMm, holder.clearanceMm, all) };
  ntcCache.set(project, { key, plan });
  return plan;
}

/**
 * Holder cuts tied to the BMS: grooves for the tabs (with a BMS and tabs on), NTC pocket
 * with its wire hole. The grooves come from the strips without holder, because the position of the
 * tabs does not depend on it. Used by `holderOf`.
 */
export function holderCutsOf(project: Project, settings: BusbarSettings, holder: HolderSettings): HolderCuts {
  if (project.bmsId === undefined) return NO_CUTS;
  const opts = optionsOf(project, settings);
  const key = JSON.stringify([opts, holder.wallMm, holder.clearanceMm, settings.balanceAwg, settings.powerAwg, holder.ntc, holder.ntcMm, holder.shape, holder.filletMm, holder.ledgeMm, holder.lockCells, holder.floorMm, holder.wireHoles, settings.tabs, settings.tabSide]);
  const hit = cutsCache.get(project);
  if (hit && hit.key === key) return hit.cuts;
  const all = opts.tabs ? tabNotches(buildStrips(project, opts), holder, settings) : [];
  const notches = { top: all.filter((n) => n.face === 'top').map((n) => n.polygon), bottom: all.filter((n) => n.face === 'bottom').map((n) => n.polygon) };
  const { site } = ntcPlanOf(project, settings, holder);
  const exits = wireExitsOf(project, settings, holder);
  const holeOf = (e: WireExit) => circlePoints(e.hole!.x, e.hole!.y, e.diameterMm / 2, 16);
  const holed = exits.filter((e) => e.hole); // the around route makes no holes
  const bossOf = (e: WireExit) => circlePoints(e.hole!.x, e.hole!.y, e.bossMm ?? 0, 24);
  const wireBosses = {
    top: holed.filter((e) => e.face === 'top' && (e.bossMm ?? 0) > 0).map(bossOf),
    bottom: holed.filter((e) => e.face === 'bottom' && (e.bossMm ?? 0) > 0).map(bossOf),
  };
  const wireHoles = { top: holed.filter((e) => e.face === 'top').map(holeOf), bottom: holed.filter((e) => e.face === 'bottom').map(holeOf) };
  const cuts = { notches, wireHoles, wireBosses, pockets: site ? [site.polygon] : [], through: site ? [site.wirePolygon] : [] };
  cutsCache.set(project, { key, cuts });
  return cuts;
}

const TAB_SIDES: readonly TabSide[] = ['top', 'bottom', 'left', 'right'];
const blocksCache = new WeakMap<Project, { key: string; blocks: Record<TabSide, number> }>();

/**
 * For each side, how many tabs would pass over other cells or strips (with the current holder, without grooves).
 * Used by the menu not to offer impossible sides and by the automatic choice.
 */
function tabBlocks(project: Project, settings: BusbarSettings): Record<TabSide, number> {
  const none: Record<TabSide, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  const opts = stripOptionsOf(settings, holderSettings().wireHoles);
  if (!opts.tabs || project.bmsId === undefined) return none;
  const hs = holderSettings();
  const key = JSON.stringify([opts, hs]);
  const hit = blocksCache.get(project);
  if (hit && hit.key === key) return hit.blocks;
  const model = buildHolder(project, hs, false);
  const holderOutline = model ? model.wall.map((r) => ({ outline: r.outline, holes: [] })) : null;
  const blocks = { ...none };
  for (const side of TAB_SIDES) {
    blocks[side] = buildStrips(project, { ...opts, tabs: { ...opts.tabs, side }, holderOutline }).filter((s) => s.tab?.blockedBy).length; // counts only the balance tabs: they choose the side
  }
  blocksCache.set(project, { key, blocks });
  return blocks;
}

/** Sides from which all the tabs exit freely. */
export function freeTabSides(project: Project, settings: BusbarSettings): Record<TabSide, boolean> {
  const b = tabBlocks(project, settings);
  return { top: b.top === 0, bottom: b.bottom === 0, left: b.left === 0, right: b.right === 0 };
}

/** The side used: the chosen one, or automatically the first free one (top, bottom, left, right), otherwise the least obstructed. */
export function tabSideOf(project: Project, settings: BusbarSettings): TabSide {
  if (settings.tabSide !== 'auto') return settings.tabSide;
  const b = tabBlocks(project, settings);
  return TAB_SIDES.reduce((best, s) => (b[s] < b[best] ? s : best), TAB_SIDES[0]!);
}

/** Strip shape options with the tab side already resolved. */
function optionsOf(project: Project, settings: BusbarSettings): StripOptions {
  const o = stripOptionsOf(settings, holderSettings().wireHoles);
  return o.tabs ? { ...o, tabs: { ...o.tabs, side: tabSideOf(project, settings) } } : o;
}

/** Warnings about the BMS board footprint: if it is larger than the space it has on the pack, it sticks out. */
export function bmsFitIssues(project: Project, settings: BusbarSettings): { severity: 'warning'; message: string; cellIds: string[] }[] {
  const fit = harnessOf(project, settings)?.fit;
  if (!fit) return [];
  const out: { severity: 'warning'; message: string; cellIds: string[] }[] = [];
  const hint = t('bms.fitHint');
  if (fit.lengthOverMm > 0.05) {
    out.push({
      severity: 'warning',
      message: t(fit.lengthKind === 'head' ? 'bms.fitDepth' : 'bms.fitFlank', { board: len(fit.boardLengthMm, 0), pack: len(fit.packLengthMm, 0), over: len(fit.lengthOverMm, 0), hint }),
      cellIds: [],
    });
  }
  if (fit.heightOverMm > 0.05) {
    out.push({ severity: 'warning', message: t('bms.fitHeight', { board: len(fit.boardWidthMm, 0), pack: len(fit.packHeightMm, 0), over: len(fit.heightOverMm, 0), hint }), cellIds: [] });
  }
  return out;
}

/** BMS harness (position and length of the wires), with the strip thickness seen in the scene. */
export function harnessOf(project: Project, settings: BusbarSettings): Harness | null {
  if (project.bmsId === undefined) return null;
  const report = reportOf(project, settings);
  return buildHarness(project, stripsOf(project, settings), Math.max(0.3, report.totalThicknessMm ?? report.requiredMm ?? 0.3));
}

let last: { project: Project; key: string; report: BusbarReport } | null = null;

export function reportOf(project: Project, settings: BusbarSettings): BusbarReport {
  const key = renderKey() + JSON.stringify(settings); // the report messages depend on language and units
  if (last && last.project === project && last.key === key) return last.report;
  const packCurrentA = computeStats(project).maxCurrentA ?? 0;
  const report = analyzeBusbars(project, stripsOf(project, settings), settings, packCurrentA);
  last = { project, key, report };
  return report;
}

/** Absolute positions of the recommended weld spots on a strip. */
export function spotMarks(strip: Strip, spotsPerTerminal: number, welder: WelderProfile): Pt[] {
  const out: Pt[] = [];
  for (const n of strip.nodes) {
    for (const p of spotPositions(n.contactRadiusMm, welder.spotDiameterMm, welder.spotSpacingMm, spotsPerTerminal)) {
      out.push({ x: n.x + p.x, y: n.y + p.y });
    }
  }
  return out;
}

const ring = (pts: readonly Pt[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ') + ' Z';
/** SVG path of a strip: outline plus windows (to draw with fill-rule evenodd). */
export const pathOf = (strip: Pick<Strip, 'outline' | 'holes'>) => [strip.outline, ...strip.holes].map(ring).join(' ');
