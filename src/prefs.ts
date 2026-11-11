/**
 * Preferenze di visualizzazione: unità di lunghezza, temperatura e peso, valuta. Modulo senza DOM (come i18n):
 * il progetto resta sempre in mm, °C, g ed euro, e queste scelte cambiano solo come si mostrano e si scrivono
 * i valori. Si ricordano nel browser.
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
  /** Unità della valuta scelta per 1 €: i prezzi del catalogo sono in euro. */
  rate: number;
}

export const DEFAULT_PREFS: Prefs = { length: 'mm', temp: 'C', weight: 'metric', currency: 'EUR', rate: 1 };

const STORAGE_KEY = 'cellalab:prefs';

/** Preferenze valide da dati qualunque: i campi sbagliati o mancanti tornano al valore di partenza. */
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
/** Chiama `cb` quando cambiano le preferenze: serve a ricalcolare i risultati che contengono valori formattati. */
export function onPrefsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Aggiorna le preferenze (cambiando valuta il cambio torna al valore di partenza della nuova). */
export function setPrefs(patch: Partial<Prefs>): void {
  const merged: Prefs = { ...current, ...patch };
  if (patch.currency && patch.currency !== current.currency && patch.rate === undefined) merged.rate = CURRENCIES[patch.currency].defaultRate;
  const next = sanitizePrefs(merged);
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage non disponibile: la scelta vale per questa sessione */
  }
  for (const cb of listeners) cb();
}

/** Solo per i test: riporta le preferenze ai valori di partenza senza salvare. */
export function resetPrefsForTests(): void {
  current = { ...DEFAULT_PREFS };
}
