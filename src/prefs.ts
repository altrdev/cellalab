/**
 * Display preferences: length, temperature and weight units, currency. Module with no DOM (like i18n):
 * the project always stays in mm, °C, g and euro, and these choices only change how values are shown and
 * typed. They are remembered in the browser.
 */

export type LengthUnit = 'mm' | 'in';
export type TempUnit = 'C' | 'F';
export type WeightUnit = 'metric' | 'imperial';
export type Currency = 'EUR' | 'USD' | 'GBP';

export const CURRENCIES: Record<Currency, { symbol: string; defaultRate: number }> = {
  EUR: { symbol: '€', defaultRate: 1 },
  USD: { symbol: '$', defaultRate: 1.1 },
  GBP: { symbol: '£', defaultRate: 0.85 },
};

export interface Prefs {
  length: LengthUnit;
  temp: TempUnit;
  weight: WeightUnit;
  currency: Currency;
  /** Units of the chosen currency per 1 €: catalogue prices are in euro. */
  rate: number;
}

export const DEFAULT_PREFS: Prefs = { length: 'mm', temp: 'C', weight: 'metric', currency: 'EUR', rate: 1 };

const STORAGE_KEY = 'cellalab:prefs';

/** Valid preferences from any data: wrong or missing fields go back to the starting value. */
export function sanitizePrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULT_PREFS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const d = raw as Record<string, unknown>;
  if (d.length === 'mm' || d.length === 'in') out.length = d.length;
  if (d.temp === 'C' || d.temp === 'F') out.temp = d.temp;
  if (d.weight === 'metric' || d.weight === 'imperial') out.weight = d.weight;
  if (d.currency === 'EUR' || d.currency === 'USD' || d.currency === 'GBP') out.currency = d.currency;
  out.rate = out.currency === 'EUR' ? 1 : CURRENCIES[out.currency].defaultRate;
  if (out.currency !== 'EUR' && typeof d.rate === 'number' && Number.isFinite(d.rate) && d.rate > 0 && d.rate < 1e6) out.rate = d.rate;
  return out;
}

function load(): Prefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let current: Prefs = load();

export const getPrefs = (): Prefs => current;

const listeners = new Set<() => void>();
/** Calls `cb` when the preferences change: used to recompute results that contain formatted values. */
export function onPrefsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Updates the preferences (changing currency the rate goes back to the new one's starting value). */
export function setPrefs(patch: Partial<Prefs>): void {
  const merged: Prefs = { ...current, ...patch };
  if (patch.currency && patch.currency !== current.currency && patch.rate === undefined) merged.rate = CURRENCIES[patch.currency].defaultRate;
  const next = sanitizePrefs(merged);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage not available: the choice holds for this session */
  }
  for (const cb of listeners) cb();
}

/** Tests only: resets the preferences to the starting values without saving. */
export function resetPrefsForTests(): void {
  current = { ...DEFAULT_PREFS };
}
