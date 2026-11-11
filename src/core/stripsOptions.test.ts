import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { replaceCells } from './ops';
import { createProject } from './project';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS } from './lamelle';
import { buildStrips } from './strips';

const project = () =>
  replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 3, parallel: 2, kind: 'hex', gapMm: 1 }));

describe('forma delle lamelle', () => {
  const p = project();
  const base = buildStrips(p);
  const series = (l: ReturnType<typeof buildStrips>) => l.filter((x) => x.kind === 'series');

  it('ogni cella ha lo stesso appoggio, di default quanto il bottone + più il bordo', () => {
    for (const s of base) for (const n of s.nodes) expect(n.reachMm).toBeCloseTo(0.41 * 10.7 + 1, 6);
  });
  it('più bordo = appoggio e lamella più grandi', () => {
    expect(series(buildStrips(p, { marginMm: 3 }))[0]!.areaMm2).toBeGreaterThan(series(base)[0]!.areaMm2);
  });
  it("Ø d'appoggio forzato cambia l'appoggio (con limite sulla cella)", () => {
    expect(buildStrips(p, { contactDiameterMm: 12 })[0]!.nodes[0]!.reachMm).toBeCloseTo(6);
    expect(buildStrips(p, { contactDiameterMm: 100 })[0]!.nodes[0]!.reachMm).toBeCloseTo(21.4 / 2 - 0.3);
  });
  it('le serie hanno finestre tra le bande; i terminali a due celle no', () => {
    // 3S2P: due gruppi da due celle per lamella in serie → anello (guide, traversini, diagonale)
    for (const s of series(base)) expect(s.holes.length).toBeGreaterThanOrEqual(1);
    for (const s of base.filter((x) => x.kind !== 'series')) expect(s.holes).toHaveLength(0);
  });
  it('allargando le bande le finestre si chiudono e l’area cresce', () => {
    const narrow = series(buildStrips(p, { widthMm: 5 }))[0]!;
    const wide = series(buildStrips(p, { widthMm: 20 }))[0]!;
    expect(wide.areaMm2).toBeGreaterThan(narrow.areaMm2);
    expect(wide.holes.length).toBeLessThanOrEqual(narrow.holes.length);
    expect(narrow.bandMm).toBeCloseTo(5);
  });
  it('larghezza forzata con limite al diametro della cella', () => {
    expect(series(buildStrips(p, { widthMm: 500 }))[0]!.bandMm).toBeCloseTo(21.4);
  });
  it("il collo è la larghezza delle bande e l'analisi divide la corrente tra le celle in parallelo (I/P)", () => {
    const strips = buildStrips(p, { widthMm: 8 });
    const r = analyzeLamelle(p, strips, { ...DEFAULT_LAMELLA_SETTINGS, currentA: 30 }, 30);
    const row = r.strips.find((x) => x.label.startsWith('S'))!;
    expect(row.neckMm).toBeCloseTo(8);
    expect(row.neckCurrentA).toBeCloseTo(30 / 2); // P = 2
    expect(r.issues.some((i) => /si toccano/.test(i.message))).toBe(false);
  });
});
