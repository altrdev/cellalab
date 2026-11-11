import { derived } from 'svelte/store';
import { runDrc } from './core/drc';
import { createHistory } from './core/history';
import { createProject } from './core/project';

/** Stato globale dell'applicazione: il progetto corrente con cronologia undo/redo. */
export const history = createHistory(createProject());

/** Verifiche sul pacco, ricalcolate a ogni modifica e condivise da editor e pannello. */
export const drc = derived(history, (view) => runDrc(view.present));
