import { afterEach, describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS } from './busbar';
import { buildCutListCsv, buildCutSummary, buildSvg } from './busbarExport';
import { resetPrefsForTests, setPrefs } from '../prefs';
import { replaceCells } from './ops';
import { createProject } from './project';
import { buildStrips } from './strips';

function pack() {
  const cells = generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 3, parallel: 2, kind: 'hex', gapMm: 1 });
  return replaceCells(createProject(), cells);
}

describe('strip export', () => {
  const p = pack();
  const strips = buildStrips(p);
  it('SVG: dimensions in mm, one path per strip of the face, scale bar', () => {
    const svg = buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false });
    const n = strips.filter((s) => s.face === 'top').length;
    expect(svg.match(/stroke="#d00"/g)?.length).toBe(n);
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).toContain('50 mm');
  });
  it('SVG: the labels are outside the pieces, below each, and inside the sheet', () => {
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
    // the sheet reaches the labels
    const vb = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!;
    expect(Number(vb[2]) + Number(vb[4])).toBeGreaterThan(Math.max(...texts.map((t) => t.y)));
  });
  it('CSV: header + one row per strip', () => {
    const rep = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 10);
    const csv = buildCutListCsv(strips, rep).trim().split('\n');
    expect(csv.length).toBe(strips.length + 1);
    expect(buildCutSummary(rep, 'Prova')).toContain('Prova');
  });
});

describe('exports in inches', () => {
  const p = pack();
  const strips = buildStrips(p);
  afterEach(() => resetPrefsForTests());

  it('SVG: size declared in inches, same drawing, 2 in scale bar', () => {
    const mm = buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false });
    setPrefs({ length: 'in' });
    const inch = buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false });
    const w = (svg: string, unit: string) => Number(svg.match(new RegExp(`width="([\\d.]+)${unit}"`))![1]);
    expect(w(inch, 'in')).toBeCloseTo(w(mm, 'mm') / 25.4, 2);
    // same viewBox: the shape does not change, only the declared unit
    expect(inch.match(/viewBox="[^"]*"/)![0]).toBe(mm.match(/viewBox="[^"]*"/)![0]);
    expect(inch).toContain('2 in');
    expect(inch).not.toContain('50 mm');
  });

  it('CSV: header and values in the chosen unit', () => {
    const rep = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 10);
    const mm = buildCutListCsv(strips, rep).trim().split('\n');
    setPrefs({ length: 'in' });
    const inch = buildCutListCsv(strips, rep).trim().split('\n');
    expect(mm[0]).toContain('area_mm2;neck_mm'.replace('neck_mm', 'collo_mm'));
    expect(inch[0]).toContain('area_in2;collo_in');
    const col = (line: string, i: number) => Number(line.split(';')[i]);
    // collo_mm is column 4: the value in inches is the one in mm divided by 25.4
    expect(col(inch[1]!, 4)).toBeCloseTo(col(mm[1]!, 4) / 25.4, 2);
  });

  it('summary: thickness, area and weight in the chosen units', () => {
    const rep = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 10);
    setPrefs({ length: 'in', weight: 'imperial' });
    const text = buildCutSummary(rep, 'Prova');
    expect(text).toMatch(/Spessore: [\d,]+ in x/);
    expect(text).toMatch(/area [\d,]+ in²/);
    expect(text).toMatch(/[\d,]+ oz/);
    expect(text).not.toMatch(/\bmm\b|cm2| g\b/);
  });
});
