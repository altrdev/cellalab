import { describe, expect, it } from 'vitest';
import { nextFreeGroup, suggestGroups } from './autogroup';
import { generateGrid } from './layout';
import { alternateGroupPolarity, assignGroups, replaceCells } from './ops';
import { createProject } from './project';
import { runDrc } from './drc';
import type { PlacedCell, Project } from './types';

const T = '21700-5000-10a';

/** Pacco senza gruppi, con le celle in ordine inverso (per non barare con l'ordine di partenza). */
const truth = new WeakMap<Project, Map<string, number>>();
function ungrouped(series: number, parallel: number, kind: 'hex' | 'square', gap = 1): Project {
  const p = replaceCells(
    createProject(),
    generateGrid({ typeId: T, diameterMm: 21.4, series, parallel, kind, gapMm: gap }),
  );
  const out = { ...p, cells: p.cells.map((c) => ({ ...c, group: null })).reverse() };
  truth.set(out, new Map(p.cells.map((c) => [c.id, c.group as number])));
  return out;
}

/** Per ogni gruppo originale (colonna g) controlla che finisca tutto nello stesso gruppo proposto. */
function sameColumnsAs(original: Project, groups: Map<string, number>, series: number) {
  // i gruppi generati hanno indice g: ogni gruppo proposto deve coincidere con uno originale
  const byOriginal = new Map<number, Set<number>>();
  for (const c of original.cells) {
    const key = truth.get(original)!.get(c.id)!;
    (byOriginal.get(key) ?? byOriginal.set(key, new Set()).get(key)!).add(groups.get(c.id)!);
  }
  expect([...byOriginal.values()].every((s) => s.size === 1)).toBe(true);
  expect(new Set([...groups.values()]).size).toBe(series);
}

describe('suggestGroups', () => {
  it('ritrova i gruppi (diagonali) di un pacco esagonale 4S3P e le mette in serie da sinistra a destra', () => {
    const p = ungrouped(4, 3, 'hex');
    const r = suggestGroups(p.cells, 3);
    expect(r.strategy).toBe('x');
    expect(r.groupCount).toBe(4);
    sameColumnsAs(p, r.groups, 4);
    // ordine in serie come il pacco generato: da sinistra a destra
    for (const c of p.cells) expect(r.groups.get(c.id)).toBe(truth.get(p)!.get(c.id));
  });

  it('ritrova le righe quando i gruppi sono orizzontali', () => {
    const p = ungrouped(3, 4, 'square');
    // trasposta: ogni gruppo diventa una riga
    const rows = { ...p, cells: p.cells.map((c) => ({ ...c, x: c.y, y: c.x })) };
    const r = suggestGroups(rows.cells, 4);
    expect(r.strategy).toBe('y');
    const byY = new Map<number, Set<number>>();
    for (const c of rows.cells) (byY.get(Math.round(c.y)) ?? byY.set(Math.round(c.y), new Set()).get(Math.round(c.y))!).add(r.groups.get(c.id)!);
    expect([...byY.values()].every((s) => s.size === 1)).toBe(true);
  });

  it('con una strategia forzata a blocchi forma quadrati 2×2', () => {
    const p = ungrouped(4, 4, 'square'); // griglia 4×4
    const r = suggestGroups(p.cells, 4, { strategy: 'blob' });
    expect(r.strategy).toBe('blob');
    for (let g = 0; g < 4; g++) {
      const cells = p.cells.filter((c) => r.groups.get(c.id) === g);
      expect(cells).toHaveLength(4);
      const xs = new Set(cells.map((c) => Math.round(c.x)));
      const ys = new Set(cells.map((c) => Math.round(c.y)));
      expect(xs.size).toBe(2);
      expect(ys.size).toBe(2);
    }
  });

  it('in automatico usa i blocchi quando colonne e righe non sono allineate (3×3 in una griglia 6×6)', () => {
    const p = ungrouped(6, 6, 'square');
    const r = suggestGroups(p.cells, 9);
    expect(r.strategy).toBe('blob');
    for (let g = 0; g < 4; g++) {
      const cells = p.cells.filter((c) => r.groups.get(c.id) === g);
      expect(new Set(cells.map((c) => Math.round(c.x))).size).toBe(3);
      expect(new Set(cells.map((c) => Math.round(c.y))).size).toBe(3);
    }
  });

  it('in automatico preferisce le colonne quando sono allineate (anche se i blocchi 2×2 sarebbero possibili)', () => {
    const p = ungrouped(4, 4, 'square');
    expect(suggestGroups(p.cells, 4).strategy).toBe('x');
  });

  it('applica l offset iniziale dei gruppi', () => {
    const p = ungrouped(2, 2, 'square');
    const r = suggestGroups(p.cells, 2, { startGroup: 5 });
    expect([...new Set(r.groups.values())].sort()).toEqual([5, 6]);
  });

  it('è deterministico', () => {
    const p = ungrouped(5, 3, 'hex');
    const a = suggestGroups(p.cells, 3);
    const b = suggestGroups([...p.cells].reverse(), 3);
    expect([...a.groups].sort()).toEqual([...b.groups].sort());
  });

  it.each([
    ['numero di celle non multiplo di P', 7, 3],
    ['P non valido', 6, 0],
  ])('rifiuta: %s', (_n, count, parallel) => {
    const cells: PlacedCell[] = Array.from({ length: count }, (_, i) => ({
      id: `c${i}`, typeId: T, x: i * 22, y: 0, plusUp: true, group: null,
    }));
    expect(() => suggestGroups(cells, parallel)).toThrow(RangeError);
  });

  it('rifiuta un insieme vuoto', () => {
    expect(() => suggestGroups([], 2)).toThrow(RangeError);
  });

  it('con le celle in una sola fila, i gruppi sono tratti consecutivi', () => {
    const cells: PlacedCell[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`, typeId: T, x: i * 22.4, y: 0, plusUp: true, group: null,
    }));
    const r = suggestGroups(cells, 2);
    expect(cells.map((c) => r.groups.get(c.id))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('nextFreeGroup, assignGroups, alternateGroupPolarity', () => {
  it('nextFreeGroup ignora le celle escluse', () => {
    const cells: PlacedCell[] = [
      { id: 'a', typeId: T, x: 0, y: 0, plusUp: true, group: 0 },
      { id: 'b', typeId: T, x: 0, y: 0, plusUp: true, group: 3 },
      { id: 'c', typeId: T, x: 0, y: 0, plusUp: true, group: null },
    ];
    expect(nextFreeGroup(cells, new Set())).toBe(4);
    expect(nextFreeGroup(cells, new Set(['b']))).toBe(1);
    expect(nextFreeGroup(cells, new Set(['a', 'b']))).toBe(0);
  });

  it('assignGroups applica i gruppi e non crea un nuovo progetto se non cambia nulla', () => {
    const p = ungrouped(2, 2, 'square');
    const r = suggestGroups(p.cells, 2);
    const q = assignGroups(p, r.groups);
    expect(q.cells.every((c) => c.group !== null)).toBe(true);
    expect(assignGroups(q, r.groups)).toBe(q);
  });

  it('dopo il raggruppamento automatico + alternanza il pacco è pulito per le verifiche', () => {
    const p = ungrouped(4, 3, 'hex');
    const grouped = assignGroups(p, suggestGroups(p.cells, 3).groups);
    const flat = { ...grouped, cells: grouped.cells.map((c) => ({ ...c, plusUp: true })) };
    expect(runDrc(flat).map((i) => i.code)).toContain('series-same-polarity');
    const fixed = alternateGroupPolarity(flat);
    expect(runDrc(fixed)).toEqual([]);
  });

  it('alternateGroupPolarity rispetta la selezione e salta le celle senza gruppo', () => {
    const cells: PlacedCell[] = [
      { id: 'a', typeId: T, x: 0, y: 0, plusUp: true, group: 1 },
      { id: 'b', typeId: T, x: 0, y: 0, plusUp: true, group: 1 },
      { id: 'c', typeId: T, x: 0, y: 0, plusUp: true, group: null },
    ];
    const p = { ...createProject(), cells };
    const q = alternateGroupPolarity(p, ['a']);
    expect(q.cells.map((c) => c.plusUp)).toEqual([false, true, true]);
    expect(alternateGroupPolarity(p, ['c'])).toBe(p);
  });
});
