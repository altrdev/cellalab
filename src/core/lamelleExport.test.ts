import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS } from './lamelle';
import { buildCutListCsv, buildCutSummary, buildSvg } from './lamelleExport';
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
