import { derived, writable } from 'svelte/store';
import { runDrc } from './core/drc';
import { createHistory } from './core/history';
import { createProject } from './core/project';
import { onLocaleChange } from './i18n';

/** Stato globale dell'applicazione: il progetto corrente con cronologia undo/redo. */
export const history = createHistory(createProject());

/** Cambia a ogni cambio di lingua: i testi delle verifiche vanno ricalcolati. */
const localeTick = writable(0);
onLocaleChange(() => localeTick.update((n) => n + 1));

/** Verifiche sul pacco, ricalcolate a ogni modifica (e al cambio di lingua) e condivise da editor e pannello. */
export const drc = derived([history, localeTick], ([view]) => runDrc(view.present));
