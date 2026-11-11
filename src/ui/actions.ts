import { removeCells, flipPolarity, setGroup } from '../core/ops';
import { history } from '../state';
import { ui } from './ui.svelte';

/** Azioni comuni a tastiera, barra degli strumenti e pannello. */

export function flipSelected() {
  const ids = [...ui.selected];
  if (ids.length) history.commit((p) => flipPolarity(p, ids));
}

export function deleteSelected() {
  const ids = [...ui.selected];
  if (!ids.length) return;
  history.commit((p) => removeCells(p, ids));
  ui.selected = new Set();
}

export function selectAll() {
  ui.selected = new Set(history.get().present.cells.map((c) => c.id));
}

/** `group` è l'indice 0-based, null per dissociare. */
export function assignGroupToSelected(group: number | null) {
  const ids = [...ui.selected];
  if (ids.length) history.commit((p) => setGroup(p, ids, group));
}

export function toggleAddTool() {
  ui.tool = ui.tool === 'add' ? 'select' : 'add';
}

export function fitView() {
  ui.fit(history.get().present);
}

export function toggleSeriesTool() {
  ui.tool = ui.tool === 'series' ? 'select' : 'series';
}

export function stepSeries(delta: number) {
  ui.activeSeries = Math.max(0, ui.activeSeries + delta);
}
