import { describe, expect, it } from 'vitest';
import { runDrc } from './drc';
import { generateGrid } from './layout';
import { addCell, replaceCells, setCurrentLimit, setGroup } from './ops';
import { createProject } from './project';
import type { Project } from './types';

const T = '21700-5000-10a'; // Ø 21,4
const pack = (s: number, p: number, gapMm = 1): Project =>
  replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: s, parallel: p, kind: 'hex', gapMm }));
const codes = (p: Project, opts = {}) => runDrc(p, opts).map((i) => i.code);

describe('runDrc', () => {
  it('un pacco generato dal wizard è pulito', () => {
    expect(runDrc(pack(4, 3))).toEqual([]);
    expect(runDrc(pack(13, 4))).toEqual([]);
    expect(runDrc(createProject())).toEqual([]);
  });

  it('segnala celle sovrapposte come errore', () => {
    let p = addCell(createProject(), { typeId: T, x: 0, y: 0, group: 0, id: 'a' });
    p = addCell(p, { typeId: T, x: 10, y: 0, group: 0, id: 'b' });
    const [issue] = runDrc(p);
    expect(issue).toMatchObject({ code: 'overlap', severity: 'error' });
    expect(issue!.cellIds.sort()).toEqual(['a', 'b']);
  });

  it('celle tangenti o troppo vicine: avviso, non errore', () => {
    for (const x of [21.4, 21.8]) {
      let p = addCell(createProject(), { typeId: T, x: 0, y: 0, group: 0 });
      p = addCell(p, { typeId: T, x, y: 0, group: 0 });
      expect(runDrc(p)[0]).toMatchObject({ code: 'too-close', severity: 'warning' });
    }
  });

  it('lo spazio minimo è configurabile', () => {
    const p = pack(3, 2, 0.5);
    expect(codes(p)).toContain('too-close');
    expect(codes(p, { minGapMm: 0.4 })).not.toContain('too-close');
  });

  it('polarità opposta in parallelo = errore con le celle del gruppo', () => {
    const p = pack(3, 3);
    const victim = p.cells.find((c) => c.group === 1)!;
    const bad = { ...p, cells: p.cells.map((c) => (c.id === victim.id ? { ...c, plusUp: !c.plusUp } : c)) };
    const issue = runDrc(bad).find((i) => i.code === 'parallel-polarity')!;
    expect(issue.severity).toBe('error');
    expect(issue.message).toContain('S2');
    expect(issue.cellIds).toHaveLength(3);
  });

  it('celle senza gruppo', () => {
    const p = addCell(pack(2, 2), { typeId: T, x: 200, y: 0 });
    const issue = runDrc(p).find((i) => i.code === 'ungrouped')!;
    expect(issue.cellIds).toHaveLength(1);
  });

  it('gruppi mancanti', () => {
    const p = pack(3, 2);
    const ids = p.cells.filter((c) => c.group === 1).map((c) => c.id);
    const gap = setGroup(p, ids, 5);
    const issue = runDrc(gap).find((i) => i.code === 'group-gap')!;
    expect(issue.severity).toBe('error');
    expect(issue.message).toContain('S2');
  });

  it('gruppi con numero di celle diverso dalla maggioranza', () => {
    let p = pack(3, 2);
    p = addCell(p, { typeId: T, x: 10.7, y: 90, group: 0, plusUp: true });
    const issue = runDrc(p).find((i) => i.code === 'unequal-parallel')!;
    expect(issue.message).toContain('S1');
    expect(issue.message).toContain('(2)');
  });

  it('tipi misti nello stesso gruppo', () => {
    let p = addCell(createProject(), { typeId: T, x: 0, y: 0, group: 0 });
    p = addCell(p, { typeId: '21700-4000-30a', x: 22.4, y: 0, group: 0 });
    expect(codes(p)).toContain('mixed-types');
  });

  it('gruppo con celle lontane', () => {
    let p = addCell(createProject(), { typeId: T, x: 0, y: 0, group: 0 });
    p = addCell(p, { typeId: T, x: 22.4, y: 0, group: 0 });
    p = addCell(p, { typeId: T, x: 200, y: 0, group: 0 });
    expect(codes(p)).toContain('split-group');
    // celle adiacenti non fanno scattare l'avviso
    expect(codes(pack(4, 4))).not.toContain('split-group');
  });

  it('gruppi consecutivi con la stessa polarità: informazione', () => {
    const p = pack(4, 2);
    const same = { ...p, cells: p.cells.map((c) => ({ ...c, plusUp: true })) };
    const issue = runDrc(same).find((i) => i.code === 'series-same-polarity')!;
    expect(issue.severity).toBe('info');
    expect(issue.message).toContain('3 coppie');
  });

  it('gli errori vengono prima degli avvisi e delle informazioni', () => {
    let p = pack(3, 2);
    p = { ...p, cells: p.cells.map((c) => ({ ...c, plusUp: true })) }; // info
    p = addCell(p, { typeId: T, x: 200, y: 0 }); // warning (senza gruppo)
    p = addCell(p, { typeId: T, x: 203, y: 0 }); // error (sovrapposta)
    const severities = runDrc(p).map((i) => i.severity);
    expect(severities).toEqual([...severities].sort((a, b) => 'ewi'.indexOf(a[0]!) - 'ewi'.indexOf(b[0]!)));
    expect(severities[0]).toBe('error');
  });

  it('regge pacchi grandi senza confrontare tutte le coppie', () => {
    const big = pack(40, 25); // 1000 celle
    const t0 = performance.now();
    expect(runDrc(big)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('limite di corrente sopra quello delle celle: avviso', () => {
    const p = pack(3, 2); // 2 × 10 A = 20 A
    expect(codes(setCurrentLimit(p, 15))).not.toContain('current-over-cells');
    expect(codes(setCurrentLimit(p, 20))).not.toContain('current-over-cells');
    expect(codes(setCurrentLimit(p, 30))).toContain('current-over-cells');
    expect(codes(p)).not.toContain('current-over-cells');
  });
});
