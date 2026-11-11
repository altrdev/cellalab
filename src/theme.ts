/**
 * Tema dell'interfaccia: automatico (segue il sistema), chiaro o scuro. Si ricorda nel browser e si applica
 * come attributo `data-theme` su <html>; in automatico l'attributo non c'è e decide `prefers-color-scheme`.
 */

export type Theme = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'cellalab:theme';

export function sanitizeTheme(raw: unknown): Theme {
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

function load(): Theme {
  if (typeof window === 'undefined') return 'auto';
  try {
    return sanitizeTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

let current: Theme = load();

export const getTheme = (): Theme => current;

const listeners = new Set<() => void>();
/** Chiama `cb` quando cambia il tema scelto (la vista 3D rilegge i colori). */
export function onThemeChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  const next = sanitizeTheme(theme);
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage non disponibile: la scelta vale per questa sessione */
  }
  apply(next);
  for (const cb of listeners) cb();
}

/** All'avvio: applica il tema salvato prima del primo disegno. */
export function initTheme(): void {
  apply(current);
}
