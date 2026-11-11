import { parseProject, serializeProject } from '../core/project';
import { history } from '../state';

const KEY = 'cellalab:project';

/** Ripristina l'ultimo progetto salvato nel browser. Se manca o è rovinato, parte da vuoto. */
export function restoreSaved(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    history.reset(parseProject(raw));
    return true;
  } catch {
    return false;
  }
}

/** Salva automaticamente a ogni modifica (con una breve attesa per non scrivere a ogni pixel). */
export function startAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  let dirty = false;

  const flush = () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    try {
      localStorage.setItem(KEY, serializeProject(history.get().present));
    } catch {
      /* spazio esaurito o storage bloccato: l'app funziona lo stesso */
    }
  };

  history.subscribe(() => {
    if (first) {
      first = false;
      return;
    }
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  });

  // Chiudendo o nascondendo la scheda non si aspetta l'attesa: l'ultima modifica non va persa.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
