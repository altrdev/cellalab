import { derived, writable } from 'svelte/store';
import { runDrc } from './core/drc';
import { createHistory } from './core/history';
import { createProject } from './core/project';
import { onLocaleChange } from './i18n';
import { onPrefsChange } from './prefs';

/** Global application state: the current project with undo/redo history. */
export const history = createHistory(createProject());

/** Changes at every language or unit change: the texts of the checks must be recomputed. */
const localeTick = writable(0);
onLocaleChange(() => localeTick.update((n) => n + 1));
onPrefsChange(() => localeTick.update((n) => n + 1));

/** Pack checks, recomputed at every change (and on language change) and shared by editor and panel. */
export const drc = derived([history, localeTick], ([view]) => runDrc(view.present));
