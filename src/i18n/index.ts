import { CURRENCIES, getPrefs } from '../prefs';
import { en } from './en';
import { it } from './it';

/**
 * Translations of the interface and of the core messages. Module with no DOM and no dependencies: the current language is a
 * module variable, so `t()` can be used in the core too. The interface remounts when the language changes
 * (`{#key ui.locale}` in App.svelte), so no other reactivity is needed.
 *
 * The keys are in `it.ts` (source language); `en.ts` is typed on them, so a missing key
 * in English does not compile. In the texts parameters are written `{name}`; for plurals use the keys
 * `base_one` and `base_other` with `tn(base, n)`.
 */

export type Locale = 'it' | 'en';
export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: 'it', label: 'IT' },
  { id: 'en', label: 'EN' },
];
export type MsgKey = keyof typeof it;
type PluralBase = MsgKey extends infer K ? (K extends `${infer B}_one` ? B : never) : never;
type Params = Record<string, string | number>;

const dictionaries: Record<Locale, Record<MsgKey, string>> = { it, en };
const STORAGE_KEY = 'cellalab:lang';

// in the browser the language is the saved or browser one from the first import; outside (tests, node) it stays Italian
let current: Locale = typeof window === 'undefined' ? 'it' : loadLocale();

export const getLocale = (): Locale => current;

const listeners = new Set<() => void>();
/** Calls `cb` when the language changes: used to recompute results that contain text (checks, reports). */
export function onLocaleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  for (const cb of listeners) cb();
}

const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;

/** Field labels carry the unit in brackets, written in metric: "(mm)", "(°C)", "(g)", "(€/cell)". */
function unitize(text: string): string {
  const p = getPrefs();
  if (!text.includes('(')) return text;
  return text
    .replace('(mm)', p.length === 'in' ? '(in)' : '(mm)')
    .replace('(°C)', p.temp === 'F' ? '(°F)' : '(°C)')
    .replace('(g)', p.weight === 'imperial' ? '(oz)' : '(g)')
    .replace(/\(€\//, `(${CURRENCIES[p.currency].symbol}/`);
}

/** Text in the current language; if missing (it should not be) falls back to Italian. */
export function t(key: MsgKey, params?: Params): string {
  return unitize(fill(dictionaries[current][key] ?? it[key] ?? key, params));
}

/** Plural: uses `base_one` for 1 and `base_other` otherwise; `{n}` is available in the text. */
export function tn(base: PluralBase, n: number, params?: Params): string {
  return t(`${base}_${n === 1 ? 'one' : 'other'}` as MsgKey, { n, ...params });
}

/** Number with `d` decimals and the language's separator (comma in Italian, dot in English). */
export function fmtNum(n: number, d = 2): string {
  const s = n.toFixed(d);
  return current === 'it' ? s.replace('.', ',') : s;
}

/** Browser language: Italian if it is "it", otherwise English. */
export function browserLocale(): Locale {
  // outside the browser (tests, node) it stays on the source Italian
  if (typeof window === 'undefined') return 'it';
  const lang = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? '') : '';
  return lang.toLowerCase().startsWith('it') ? 'it' : 'en';
}

/** Language chosen and saved by the user, otherwise the browser's. */
export function loadLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'it' || saved === 'en') return saved;
  } catch {
    /* storage not available */
  }
  return browserLocale();
}

export function saveLocale(l: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* storage not available: the choice holds for this session */
  }
}

/** Changes when the language or a preference changes: key for caches of results that contain formatted text. */
export const renderKey = (): string => current + JSON.stringify(getPrefs());
