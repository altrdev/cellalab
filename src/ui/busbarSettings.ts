import { DEFAULT_BUSBAR_SETTINGS, type BusbarSettings } from '../core/busbar';
import { COOLING } from '../core/sizing';
import { AWG_TABLE, POWER_AWGS } from '../core/wire';

// ---- Settings: remembered in the browser and also written in the project file

const KEY = 'cellalab:busbar';

/** Valid settings from any data (file or browser): wrong or missing fields go back to the default value. */
export function sanitizeBusbarSettings(raw: unknown): BusbarSettings {
  const base: BusbarSettings = { ...DEFAULT_BUSBAR_SETTINGS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const data = raw as Record<string, unknown>;
  const out = base as unknown as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof BusbarSettings)[]) {
    const v = data[k];
    const def = base[k];
    const nullable = k === 'thicknessMm' || k === 'contactDiameterMm' || k === 'widthMm' || k === 'spotsPerTerminal' || k === 'spotCurrentA' || k === 'spotSpacingMm';
    if (nullable) {
      out[k] = v === null ? null : typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    } else if (typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  if (!['auto', 'top', 'bottom', 'left', 'right'].includes(base.tabSide)) base.tabSide = DEFAULT_BUSBAR_SETTINGS.tabSide;
  if (typeof base.powerTabs !== 'boolean') base.powerTabs = true;
  for (const k of ['tabWidthMm', 'tabLengthMm'] as const) {
    if (!(base[k] > 0)) base[k] = DEFAULT_BUSBAR_SETTINGS[k];
  }
  if (!(base.tabBendMm >= 0)) base.tabBendMm = DEFAULT_BUSBAR_SETTINGS.tabBendMm;
  if (!AWG_TABLE.some((a) => a.awg === base.balanceAwg)) base.balanceAwg = DEFAULT_BUSBAR_SETTINGS.balanceAwg;
  if (!POWER_AWGS.includes(base.powerAwg)) base.powerAwg = DEFAULT_BUSBAR_SETTINGS.powerAwg;
  if (!(base.cooling in COOLING)) base.cooling = DEFAULT_BUSBAR_SETTINGS.cooling;
  if (base.spotsPerTerminal !== null) base.spotsPerTerminal = Math.min(Math.max(Math.round(base.spotsPerTerminal), 1), 12);
  base.layers = Math.min(Math.max(Math.floor(base.layers) || 1, 1), 5);
  return base;
}

export function loadBusbarSettings(): BusbarSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeBusbarSettings(JSON.parse(raw)) : { ...DEFAULT_BUSBAR_SETTINGS };
  } catch {
    return { ...DEFAULT_BUSBAR_SETTINGS };
  }
}

export function saveBusbarSettings(s: BusbarSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage not available: the app works anyway */
  }
}
