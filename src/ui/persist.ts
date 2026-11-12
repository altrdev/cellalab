import { parseProject, serializeProject } from '../core/project';
import { history } from '../state';

const KEY = 'cellalab:project';

/** Restores the last project saved in the browser. If it is missing or damaged, starts empty. */
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

/** Saves automatically at every change (with a short delay so it does not write at every pixel). */
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
      /* storage full or blocked: the app works anyway */
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

  // When the tab is closed or hidden the delay is not waited: the last change must not be lost.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
