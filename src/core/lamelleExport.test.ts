import { afterEach, describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS } from './lamelle';
import { buildCutListCsv, buildCutSummary, buildSvg } from './lamelleExport';
import { resetPrefsForTests, setPrefs } from '../prefs';
import { replaceCells } from './ops';
import { createProject } from './project';
import { buildStrips } from './strips';

function pack() {
  const cells = generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 3, parallel: 2, kind: 'hex', gapMm: 1 });
  return replaceCells(createProject(), cells);
}

describe('esportazione lamelle', () => {
  const p = pack();
  const strips = buildStrips(p);
  it('SVG: dimensioni in mm, un path per lamella della faccia, barra di scala', () => {
    const svg = buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false });
    const n = strips.filter((s) => s.face === 'top').length;
    expect(svg.match(/stroke="#d00"/g)?.length).toBe(n);
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).toContain('50 mm');
  });
  it('SVG: le etichette stanno fuori dai pezzi, sotto ognuno, e dentro il foglio', () => {
    const svg = buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false });
    const top = strips.filter((s) => s.face === 'top');
    const texts = [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" font-size="3.5"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3]! }));
    expect(texts.map((t) => t.t)).toEqual(top.map((s) => s.label));
    texts.forEach((t, i) => {
      for (const s of top) {
        const inside = t.x > Math.min(...s.outline.map((p) => p.x)) && t.x < Math.max(...s.outline.map((p) => p.x)) && t.y - 3.5 < Math.max(...s.outline.map((p) => p.y)) && t.y > Math.min(...s.outline.map((p) => p.y));
        expect(inside).toBe(false);
      }
      expect(t.y).toBeGreaterThan(Math.max(...top[i]!.outline.map((p) => p.y)));
    });
    // il foglio arriva fino alle etichette
    const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!;
    expect(Number(vb[2]) + Number(vb[4])).toBeGreaterThan(Math.max(...texts.map((t) => t.y)));
  });
  it('CSV: intestazione + una riga per lamella', () => {
    const rep = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 10);
    const csv = buildCutListCsv(strips, rep).trim().split('\n');
    expect(csv.length).toBe(strips.length + 1);
    expect(buildCutSummary(rep, 'Prova')).toContain('Prova');
  });
});

describe('esportazioni in pollici', () => {
  const p = pack();
  const strips = buildStrips(p);
  afterEach(() => resetPrefsForTests());

  it('SVG: dimensione dichiarata in pollici, disegno uguale, barra di scala da 2 in', () => {
    const mm = buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false });
    setPrefs({ length: 'in' });
    const inch = buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false });
    const w = (svg: string, unit: string) => Number(svg.match(new RegExp(`width="([\\d.]+)${unit}"`))![1]);
    expect(w(inch, 'in')).toBeCloseTo(w(mm, 'mm') / 25.4, 2);
    // lo stesso viewBox: la forma non cambia, solo l'unità dichiarata
    expect(inch.match(/viewBox="[^"]*"/)![0]).toBe(mm.match(/viewBox="[^"]*"/)![0]);
    expect(inch).toContain('2 in');
    expect(inch).not.toContain('50 mm');
  });

  it('CSV: intestazione e valori nell\'unità scelta', () => {
    const rep = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 10);
    const mm = buildCutListCsv(strips, rep).trim().split('\n');
    setPrefs({ length: 'in' });
    const inch = buildCutListCsv(strips, rep).trim().split('\n');
    expect(mm[0]).toContain('area_mm2;neck_mm'.replace('neck_mm', 'collo_mm'));
    expect(inch[0]).toContain('area_in2;collo_in');
    const col = (line: string, i: number) => Number(line.split(';')[i]);
    // collo_mm è la colonna 4: il valore in pollici è quello in mm diviso 25,4
    expect(col(inch[1]!, 4)).toBeCloseTo(col(mm[1]!, 4) / 25.4, 2);
  });

  it('riepilogo: spessore, area e peso nelle unità scelte', () => {
    const rep = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 10);
    setPrefs({ length: 'in', weight: 'imperial' });
    const text = buildCutSummary(rep, 'Prova');
    expect(text).toMatch(/Spessore: [\d,]+ in x/);
    expect(text).toMatch(/area [\d,]+ in²/);
    expect(text).toMatch(/[\d,]+ oz/);
    expect(text).not.toMatch(/\bmm\b|cm2| g\b/);
  });
});
