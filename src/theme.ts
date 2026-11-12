/**
 * Interface theme: automatic (follows the system), light or dark. Remembered in the browser and applied
 * as a `data-theme` attribute on <html>; in automatic the attribute is absent and `prefers-color-scheme` decides.
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
/** Calls `cb` when the chosen theme changes (the 3D view re-reads the colours). */
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
    /* storage not available: the choice holds for this session */
  }
  apply(next);
  for (const cb of listeners) cb();
}

/** At startup: applies the saved theme before the first paint. */
export function initTheme(): void {
  apply(current);
}
