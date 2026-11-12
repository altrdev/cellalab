import { renderKey } from '../i18n';
import type { StripOptions } from '../core/strips';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS, stripOptionsOf, type LamellaReport, type LamellaSettings } from '../core/lamelle';
import type { Pt } from '../core/polygon';
import { AWG_TABLE, POWER_AWGS } from '../core/wire';
import { COOLING, spotPositions } from '../core/sizing';
import { computeStats } from '../core/stats';
import { buildStrips, tabsOf, type Face, type Strip, type TabSide } from '../core/strips';
import { buildHolder } from '../core/holder';
import { DEFAULT_HOLDER_SETTINGS, type HolderSettings } from '../core/holder';
import { holderOf, type HolderCuts } from './holder';
import { bmsOf } from '../core/bms';
import { buildHarness, type Harness } from '../core/harness';
import { ntcSite, type NtcSite } from '../core/ntc';
import { tabNotches } from '../core/tabNotches';
import type { WelderProfile } from '../core/profiles';
import type { Project } from '../core/types';

/** Calcoli delle lamelle condivisi da editor e pannello, con una piccola cache per non rifarli due volte. */

const stripCache = new WeakMap<Project, { key: string; strips: Strip[] }>();

/** Impostazioni del holder correnti: le registra lo stato dell'interfaccia (qui non si può importare senza un giro). */
let holderSettings: () => HolderSettings = () => DEFAULT_HOLDER_SETTINGS;
export function bindHolderSettings(get: () => HolderSettings): void {
  holderSettings = get;
}

export function stripsOf(project: Project, settings: LamellaSettings): Strip[] {
  const opts = optionsOf(project, settings);
  const hs = opts.tabs && project.bmsId !== undefined ? holderSettings() : null;
  const key = JSON.stringify(opts) + (hs ? JSON.stringify(hs) : '');
  const hit = stripCache.get(project);
  if (hit && hit.key === key) return hit.strips;
  // Le linguette si piegano oltre il holder: serve la sua sagoma esterna (senza le tasche delle celle).
  const model = hs ? holderOf(project, hs).model : null;
  const holderOutline = model ? model.wall.map((r) => ({ outline: r.outline, holes: [] })) : null;
  const strips = buildStrips(project, { ...opts, holderOutline });
  stripCache.set(project, { key, strips });
  return strips;
}

const cutsCache = new WeakMap<Project, { key: string; cuts: HolderCuts }>();
interface NtcPlan {
  site: NtcSite | null;
}
const ntcCache = new WeakMap<Project, { key: string; plan: NtcPlan }>();
const NO_CUTS: HolderCuts = { notches: [], pockets: [], through: [], };

/**
 * Il posto dell'NTC (se c'è un BMS con NTC, la tasca è accesa e c'è un vuoto tra tre celle). Preferisce i vuoti dove il
 * foro del filo non finisce sotto una lamella di nessuna faccia: per le lamelle usa la forma senza holder, che qui basta.
 */
export function ntcPlanOf(project: Project, settings: LamellaSettings, holder: HolderSettings): NtcPlan {
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
 * Tagli del portacelle legati al BMS: scanalature per le linguette (con un BMS e le linguette accese), tasca dell'NTC
 * con il suo foro per il filo. Le scanalature si ricavano dalle lamelle senza holder, perché la posizione delle
 * linguette non dipende da lui. Li usa `holderOf`.
 */
export function holderCutsOf(project: Project, settings: LamellaSettings, holder: HolderSettings): HolderCuts {
  if (project.bmsId === undefined) return NO_CUTS;
  const opts = optionsOf(project, settings);
  const key = JSON.stringify([opts, holder.wallMm, holder.clearanceMm, settings.balanceAwg, settings.powerAwg, holder.ntc, holder.ntcMm, holder.shape, holder.filletMm, holder.ledgeMm, holder.lockCells, holder.floorMm]);
  const hit = cutsCache.get(project);
  if (hit && hit.key === key) return hit.cuts;
  const notches = opts.tabs ? tabNotches(buildStrips(project, opts), holder, settings).map((n) => n.polygon) : [];
  const { site } = ntcPlanOf(project, settings, holder);
  const cuts = { notches, pockets: site && !site.open ? [site.polygon] : [], through: site && !site.open ? [site.wirePolygon] : [] };
  cutsCache.set(project, { key, cuts });
  return cuts;
}

const TAB_SIDES: readonly TabSide[] = ['top', 'bottom', 'left', 'right'];
const blocksCache = new WeakMap<Project, { key: string; blocks: Record<TabSide, number> }>();

/**
 * Per ogni lato, quante linguette passerebbero sopra altre celle o lamelle (con il holder attuale, senza scanalature).
 * Serve al menu per non proporre i lati impossibili e alla scelta automatica.
 */
function tabBlocks(project: Project, settings: LamellaSettings): Record<TabSide, number> {
  const none: Record<TabSide, number> = { top: 0, bottom: 0, left: 0, right: 0 };
  const opts = stripOptionsOf(settings);
  if (!opts.tabs || project.bmsId === undefined) return none;
  const hs = holderSettings();
  const key = JSON.stringify([opts, hs]);
  const hit = blocksCache.get(project);
  if (hit && hit.key === key) return hit.blocks;
  const model = buildHolder(project, hs, false);
  const holderOutline = model ? model.wall.map((r) => ({ outline: r.outline, holes: [] })) : null;
  const blocks = { ...none };
  for (const side of TAB_SIDES) {
    blocks[side] = buildStrips(project, { ...opts, tabs: { ...opts.tabs, side }, holderOutline }).filter((s) => tabsOf(s).some((tb) => tb.blockedBy)).length;
  }
  blocksCache.set(project, { key, blocks });
  return blocks;
}

/** Lati da cui tutte le linguette escono liberamente. */
export function freeTabSides(project: Project, settings: LamellaSettings): Record<TabSide, boolean> {
  const b = tabBlocks(project, settings);
  return { top: b.top === 0, bottom: b.bottom === 0, left: b.left === 0, right: b.right === 0 };
}

/** Il lato usato: quello scelto, o in automatico il primo libero (alto, basso, sinistra, destra), altrimenti il meno intralciato. */
export function tabSideOf(project: Project, settings: LamellaSettings): TabSide {
  if (settings.tabSide !== 'auto') return settings.tabSide;
  const b = tabBlocks(project, settings);
  return TAB_SIDES.reduce((best, s) => (b[s] < b[best] ? s : best), TAB_SIDES[0]!);
}

/** Opzioni di forma delle lamelle con il lato delle linguette già risolto. */
function optionsOf(project: Project, settings: LamellaSettings): StripOptions {
  const o = stripOptionsOf(settings);
  return o.tabs ? { ...o, tabs: { ...o.tabs, side: tabSideOf(project, settings) } } : o;
}

/** Cablaggio del BMS (posizione e lunghezza dei fili), con lo spessore delle lamelle che si vede nella scena. */
export function harnessOf(project: Project, settings: LamellaSettings): Harness | null {
  if (project.bmsId === undefined) return null;
  const report = reportOf(project, settings);
  return buildHarness(project, stripsOf(project, settings), Math.max(0.3, report.totalThicknessMm ?? report.requiredMm ?? 0.3));
}

let last: { project: Project; key: string; report: LamellaReport } | null = null;

export function reportOf(project: Project, settings: LamellaSettings): LamellaReport {
  const key = renderKey() + JSON.stringify(settings); // i messaggi del rapporto dipendono da lingua e unità
  if (last && last.project === project && last.key === key) return last.report;
  const packCurrentA = computeStats(project).maxCurrentA ?? 0;
  const report = analyzeLamelle(project, stripsOf(project, settings), settings, packCurrentA);
  last = { project, key, report };
  return report;
}

/** Posizioni assolute dei punti di saldatura consigliati su una lamella. */
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
/** Percorso SVG di una lamella: contorno più finestre (da disegnare con fill-rule evenodd). */
export const pathOf = (strip: Pick<Strip, 'outline' | 'holes'>) => [strip.outline, ...strip.holes].map(ring).join(' ');

// ---- Impostazioni: ricordate nel browser e scritte anche nel file del progetto

const KEY = 'cellalab:lamelle';

/** Impostazioni valide da dati qualunque (file o browser): i campi sbagliati o mancanti tornano al valore di default. */
export function sanitizeLamellaSettings(raw: unknown): LamellaSettings {
  const base: LamellaSettings = { ...DEFAULT_LAMELLA_SETTINGS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const data = raw as Record<string, unknown>;
  const out = base as unknown as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof LamellaSettings)[]) {
    const v = data[k];
    const def = base[k];
    const nullable = k === 'thicknessMm' || k === 'contactDiameterMm' || k === 'widthMm' || k === 'spotsPerTerminal' || k === 'spotCurrentA' || k === 'spotSpacingMm';
    if (nullable) {
      out[k] = v === null ? null : typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    } else if (typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  if (!['auto', 'top', 'bottom', 'left', 'right'].includes(base.tabSide)) base.tabSide = DEFAULT_LAMELLA_SETTINGS.tabSide;
  for (const k of ['tabWidthMm', 'tabLengthMm'] as const) {
    if (!(base[k] > 0)) base[k] = DEFAULT_LAMELLA_SETTINGS[k];
  }
  if (!(base.tabBendMm >= 0)) base.tabBendMm = DEFAULT_LAMELLA_SETTINGS.tabBendMm;
  if (!AWG_TABLE.some((a) => a.awg === base.balanceAwg)) base.balanceAwg = DEFAULT_LAMELLA_SETTINGS.balanceAwg;
  if (!POWER_AWGS.includes(base.powerAwg)) base.powerAwg = DEFAULT_LAMELLA_SETTINGS.powerAwg;
  if (!(base.cooling in COOLING)) base.cooling = DEFAULT_LAMELLA_SETTINGS.cooling;
  if (base.spotsPerTerminal !== null) base.spotsPerTerminal = Math.min(Math.max(Math.round(base.spotsPerTerminal), 1), 12);
  base.layers = Math.min(Math.max(Math.floor(base.layers) || 1, 1), 5);
  return base;
}

export function loadLamellaSettings(): LamellaSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeLamellaSettings(JSON.parse(raw)) : { ...DEFAULT_LAMELLA_SETTINGS };
  } catch {
    return { ...DEFAULT_LAMELLA_SETTINGS };
  }
}

export function saveLamellaSettings(s: LamellaSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage non disponibile: l'app funziona lo stesso */
  }
}
