import { describe, expect, it } from 'vitest';
import { buildDxf, type DxfOptions } from './dxf';
import { generateGrid } from './layout';
import { replaceCells } from './ops';
import { createProject } from './project';
import { buildStrips } from './strips';

const project = replaceCells(
  createProject(),
  generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series: 4, parallel: 3, kind: 'hex', gapMm: 1 }),
);
const strips = buildStrips(project);
const base: DxfOptions = { face: 'all', kerfMm: 0, includeContacts: false, includeLabels: false };

/** Legge il DXF come coppie codice/valore. */
function pairs(dxf: string): [string, string][] {
  const l = dxf.trim().split('\n');
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < l.length; i += 2) out.push([l[i]!, l[i + 1]!]);
  return out;
}
const count = (dxf: string, entity: string) => pairs(dxf).filter(([c, v]) => c === '0' && v === entity).length;
const vertices = (dxf: string) =>
  pairs(dxf).reduce<{ x: number; y: number }[]>((acc, [c, v], i, arr) => {
    if (c === '10' && arr[i - 1]?.[1] !== 'CIRCLE' && arr[i + 1]?.[0] === '20') {
      acc.push({ x: Number(v), y: Number(arr[i + 1]![1]) });
    }
    return acc;
  }, []);

describe('buildDxf', () => {
  it('struttura valida: sezioni nell\'ordine giusto e fine file', () => {
    const dxf = buildDxf(strips, base);
    const names = pairs(dxf).filter(([c]) => c === '2').map(([, v]) => v);
    expect(names.slice(0, 3)).toEqual(['HEADER', 'TABLES', 'LAYER']);
    expect(names).toContain('ENTITIES');
    expect(dxf.trim().endsWith('0\nEOF')).toBe(true);
    expect(count(dxf, 'SECTION')).toBe(count(dxf, 'ENDSEC'));
  });

  it('una polilinea chiusa per ogni lamella, con le coordinate dei suoi vertici', () => {
    const dxf = buildDxf(strips, base);
    // una polilinea per il contorno e una per ogni finestra
    const rings = strips.reduce((a, s) => a + 1 + s.holes.length, 0);
    expect(count(dxf, 'POLYLINE')).toBe(rings);
    expect(count(dxf, 'SEQEND')).toBe(rings);
    expect(count(dxf, 'VERTEX')).toBe(strips.reduce((a, s) => a + s.outline.length + s.holes.reduce((b, h) => b + h.length, 0), 0));
  });

  it('filtra per faccia', () => {
    const rings = (list: typeof strips) => list.reduce((a, s) => a + 1 + s.holes.length, 0);
    const top = strips.filter((s) => s.face === 'top');
    expect(count(buildDxf(strips, { ...base, face: 'top' }), 'POLYLINE')).toBe(rings(top));
    expect(count(buildDxf(strips, { ...base, face: 'bottom' }), 'POLYLINE')).toBe(rings(strips.filter((s) => s.face === 'bottom')));
  });

  it('inverte la y (il DXF va verso l\'alto)', () => {
    const s = strips[0]!;
    const dxf = buildDxf([s], base);
    const v = vertices(dxf);
    const maxY = Math.max(...s.outline.map((p) => p.y));
    expect(Math.min(...v.map((p) => p.y))).toBeCloseTo(-maxY, 3);
    expect(Math.max(...v.map((p) => p.x))).toBeCloseTo(Math.max(...s.outline.map((p) => p.x)), 3);
  });

  it('kerf: il contorno cresce di metà kerf per lato', () => {
    const s = strips[0]!;
    const plain = vertices(buildDxf([s], base));
    const kerf = vertices(buildDxf([s], { ...base, kerfMm: 0.4 }));
    const width = (v: { x: number }[]) => Math.max(...v.map((p) => p.x)) - Math.min(...v.map((p) => p.x));
    expect(width(kerf) - width(plain)).toBeCloseTo(0.4, 2);
  });

  it('contatti, etichette e punti sono opzionali', () => {
    const none = buildDxf(strips, base);
    expect(count(none, 'CIRCLE')).toBe(0);
    expect(count(none, 'TEXT')).toBe(0);

    const contacts = buildDxf(strips, { ...base, includeContacts: true });
    expect(count(contacts, 'CIRCLE')).toBe(strips.reduce((a, s) => a + s.nodes.length, 0));

    const labels = buildDxf(strips, { ...base, includeLabels: true });
    expect(count(labels, 'TEXT')).toBe(strips.length);
    expect(labels).toContain('P+ sopra');

    const spots = buildDxf(strips, {
      ...base,
      spotsPerTerminal: new Map(strips.map((s) => [s.id, 2])),
      spotDiameterMm: 2,
      spotSpacingMm: 3,
    });
    // 2 punti per ogni nodo (tutti i contatti sono abbastanza grandi)
    expect(count(spots, 'CIRCLE')).toBe(strips.reduce((a, s) => a + s.nodes.length * 2, 0));
  });

  it('i layer dichiarati coprono quelli usati', () => {
    const dxf = buildDxf(strips, {
      ...base,
      includeContacts: true,
      includeLabels: true,
      spotsPerTerminal: new Map(strips.map((s) => [s.id, 2])),
      spotDiameterMm: 2,
      spotSpacingMm: 3,
    });
    const p = pairs(dxf);
    const declared = p.filter(([c], i) => c === '2' && p[i - 1]?.[1] === 'LAYER').map(([, v]) => v);
    const used = new Set(p.filter(([c]) => c === '8').map(([, v]) => v));
    for (const u of used) expect(declared).toContain(u);
  });

  it('nessuna lamella: file valido ma senza entità', () => {
    const dxf = buildDxf([], base);
    expect(count(dxf, 'POLYLINE')).toBe(0);
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});
