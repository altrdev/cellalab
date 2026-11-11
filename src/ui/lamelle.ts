import { renderKey } from '../i18n';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS, stripOptionsOf, type LamellaReport, type LamellaSettings } from '../core/lamelle';
import type { Pt } from '../core/polygon';
import { COOLING, spotPositions } from '../core/sizing';
import { computeStats } from '../core/stats';
import { buildStrips, type Strip } from '../core/strips';
import type { WelderProfile } from '../core/profiles';
import type { Project } from '../core/types';

/** Calcoli delle lamelle condivisi da editor e pannello, con una piccola cache per non rifarli due volte. */

const stripCache = new WeakMap<Project, { key: string; strips: Strip[] }>();

export function stripsOf(project: Project, settings: LamellaSettings): Strip[] {
  const opts = stripOptionsOf(settings);
  const key = JSON.stringify(opts);
  const hit = stripCache.get(project);
  if (hit && hit.key === key) return hit.strips;
  const strips = buildStrips(project, opts);
  stripCache.set(project, { key, strips });
  return strips;
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
