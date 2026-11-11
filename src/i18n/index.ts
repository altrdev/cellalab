import { en } from './en';
import { it } from './it';

/**
 * Traduzioni dell'interfaccia e dei messaggi del core. Modulo senza DOM né dipendenze: la lingua corrente è una
 * variabile del modulo, quindi `t()` si può usare anche nel core. L'interfaccia si rimonta quando la lingua cambia
 * (`{#key ui.locale}` in App.svelte), così non serve altra reattività.
 *
 * Le chiavi sono in `it.ts` (lingua di partenza); `en.ts` è tipizzato su di esse, quindi una chiave mancante
 * in inglese non compila. Nei testi i parametri si scrivono `{nome}`; per i plurali si usano le chiavi
 * `base_one` e `base_other` con `tn(base, n)`.
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

// nel browser la lingua è quella salvata o del browser fin dal primo import; fuori (test, node) resta l'italiano
let current: Locale = typeof window === 'undefined' ? 'it' : loadLocale();

export const getLocale = (): Locale => current;

const listeners = new Set<() => void>();
/** Chiama `cb` quando la lingua cambia: serve a ricalcolare i risultati che contengono testo (verifiche, rapporti). */
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

/** Testo nella lingua corrente; se manca (non dovrebbe) ripiega sull'italiano. */
export function t(key: MsgKey, params?: Params): string {
  return fill(dictionaries[current][key] ?? it[key] ?? key, params);
}

/** Plurale: usa `base_one` per 1 e `base_other` altrimenti; `{n}` è disponibile nel testo. */
export function tn(base: PluralBase, n: number, params?: Params): string {
  return t(`${base}_${n === 1 ? 'one' : 'other'}` as MsgKey, { n, ...params });
}

/** Numero con `d` decimali e il separatore della lingua (virgola in italiano, punto in inglese). */
export function fmtNum(n: number, d = 2): string {
  const s = n.toFixed(d);
  return current === 'it' ? s.replace('.', ',') : s;
}

/** Lingua del browser: italiano se è «it», altrimenti inglese. */
export function browserLocale(): Locale {
  // fuori dal browser (test, node) si resta sull'italiano di partenza
  if (typeof window === 'undefined') return 'it';
  const lang = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? '') : '';
  return lang.toLowerCase().startsWith('it') ? 'it' : 'en';
}

/** Lingua scelta e salvata dall'utente, altrimenti quella del browser. */
export function loadLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'it' || saved === 'en') return saved;
  } catch {
    /* storage non disponibile */
  }
  return browserLocale();
}

export function saveLocale(l: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* storage non disponibile: la scelta vale per questa sessione */
  }
}
