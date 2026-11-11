import { describe, expect, it } from 'vitest';
import { expandArcs, type ArcVertex } from './arcs';
import { asciiLabel, buildDxf, labelPlacements, type DxfOptions } from './dxf';
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
/** Le polilinee del DXF come vertici con bulge. */
function rings(dxf: string): ArcVertex[][] {
  const out: ArcVertex[][] = [];
  let cur: ArcVertex[] | null = null;
  const p = pairs(dxf);
  for (let i = 0; i < p.length; i++) {
    const [c, v] = p[i]!;
    if (c === '0' && v === 'POLYLINE') out.push((cur = []));
    else if (c === '0' && v === 'SEQEND') cur = null;
    else if (cur && c === '10') {
      const vertex: ArcVertex = { x: Number(v), y: Number(p[i + 1]![1]), bulge: 0 };
      if (p[i + 2]?.[0] === '42') vertex.bulge = Number(p[i + 2]![1]);
      cur.push(vertex);
    }
  }
  return out;
}
/** Tutti i punti dei contorni, con gli archi riportati a punti. */
const outlinePoints = (dxf: string) => rings(dxf).flatMap((r) => expandArcs(r, 0.02));
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
    // i tratti rotondi sono archi: molti meno vertici dei segmenti del poligono
    expect(count(dxf, 'VERTEX')).toBeLessThan(strips.reduce((a, s) => a + s.outline.length + s.holes.reduce((b, h) => b + h.length, 0), 0) / 2);
    expect(pairs(dxf).some(([c]) => c === '42')).toBe(true);
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
    const v = outlinePoints(dxf);
    const maxY = Math.max(...s.outline.map((p) => p.y));
    expect(Math.min(...v.map((p) => p.y))).toBeCloseTo(-maxY, 1);
    expect(Math.max(...v.map((p) => p.x))).toBeCloseTo(Math.max(...s.outline.map((p) => p.x)), 1);
  });

  it('kerf: il contorno cresce di metà kerf per lato', () => {
    const s = strips[0]!;
    const plain = outlinePoints(buildDxf([s], base));
    const kerf = outlinePoints(buildDxf([s], { ...base, kerfMm: 0.4 }));
    const width = (v: { x: number }[]) => Math.max(...v.map((p) => p.x)) - Math.min(...v.map((p) => p.x));
    expect(width(kerf) - width(plain)).toBeCloseTo(0.4, 1);
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

describe('archi nel contorno', () => {
  it('i vertici con bulge cadono tutti sul poligono originale (scostamento sotto 0,02 mm)', () => {
    const s = strips[0]!;
    const poly = [s.outline, ...s.holes];
    const dxf = buildDxf([s], base);
    const pts = outlinePoints(dxf);
    // ogni punto dell'arco sta vicino a un lato del poligono originale (in y del DXF = -y)
    const distToPoly = (p: { x: number; y: number }) =>
      Math.min(
        ...poly.flatMap((ring) =>
          ring.map((a, i) => {
            const b = ring[(i + 1) % ring.length]!;
            const ax = a.x;
            const ay = -a.y;
            const bx = b.x;
            const by = -b.y;
            const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
            return Math.hypot(p.x - (ax + t * (bx - ax)), p.y - (ay + t * (by - ay)));
          }),
        ),
      );
    expect(Math.max(...pts.map(distToPoly))).toBeLessThan(0.02);
  });

  it('con il taglio compensato gli archi restano archi', () => {
    const dxf = buildDxf([strips[0]!], { ...base, kerfMm: 0.4 });
    expect(pairs(dxf).filter(([c]) => c === '42').length).toBeGreaterThan(5);
  });
});

describe('posizione delle etichette', () => {
  const top = strips.filter((s) => s.face === 'top');
  const bbox = (s: (typeof strips)[number]) => ({
    minX: Math.min(...s.outline.map((p) => p.x)),
    maxX: Math.max(...s.outline.map((p) => p.x)),
    minY: Math.min(...s.outline.map((p) => p.y)),
    maxY: Math.max(...s.outline.map((p) => p.y)),
  });
  const box = (l: { x: number; y: number; text: string }) => ({ minX: l.x, maxX: l.x + l.text.length * 1.5, minY: l.y - 2.5, maxY: l.y });
  const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

  it('ogni etichetta sta fuori da tutte le lamelle e sotto la propria', () => {
    const labels = labelPlacements(top, 0);
    expect(labels).toHaveLength(top.length);
    labels.forEach((l, i) => {
      expect(box(l).minY).toBeGreaterThanOrEqual(bbox(top[i]!).maxY); // sotto la propria
      for (const s of top) expect(overlap(box(l), bbox(s))).toBe(false); // fuori da tutte
    });
  });

  it('le etichette non si sovrappongono tra loro', () => {
    const labels = labelPlacements(top, 0).map(box);
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(overlap(labels[i]!, labels[j]!)).toBe(false);
  });

  it('nel DXF il testo è sotto il contorno (y del DXF verso l\'alto)', () => {
    const s = top[0]!;
    const dxf = buildDxf([s], { ...base, includeLabels: true });
    const p = pairs(dxf);
    const k = p.findIndex(([c, v], i) => c === '0' && v === 'TEXT' && i > 0);
    const textY = Number(p.slice(k).find(([c]) => c === '20')![1]);
    expect(textY).toBeLessThan(-bbox(s).maxY);
  });

  it('senza etichette non c\'è nessun TEXT', () => {
    expect(count(buildDxf(strips, base), 'TEXT')).toBe(0);
  });
});

describe('etichette', () => {
  it('il DXF è solo ASCII: frecce e meno tipografici diventano caratteri semplici', () => {
    expect(asciiLabel('S2→S3 sopra')).toBe('S2->S3 sopra');
    expect(asciiLabel('P− sotto')).toBe('P- sotto');
    expect(asciiLabel('città')).toBe('citta');
    const dxf = buildDxf(strips, { ...base, includeLabels: true });
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(dxf)).toBe(true);
    expect(dxf).toContain('S2->S3');
    expect(dxf).toContain('P-');
  });
});

describe('unità del DXF', () => {
  const header = (dxf: string, name: string) => {
    const p = pairs(dxf);
    const i = p.findIndex(([c, v]) => c === '9' && v === name);
    return Number(p[i + 1]![1]);
  };

  it('in mm: unità 4 e sistema metrico', () => {
    const dxf = buildDxf(strips, base);
    expect(header(dxf, '$INSUNITS')).toBe(4);
    expect(header(dxf, '$MEASUREMENT')).toBe(1);
  });

  it('in pollici: coordinate divise per 25,4, unità 1 e sistema imperiale', () => {
    const s = strips[0]!;
    const mm = outlinePoints(buildDxf([s], base));
    const inch = outlinePoints(buildDxf([s], { ...base, unit: 'in' }));
    const width = (v: { x: number }[]) => Math.max(...v.map((p) => p.x)) - Math.min(...v.map((p) => p.x));
    expect(width(inch)).toBeCloseTo(width(mm) / 25.4, 3);
    const dxf = buildDxf([s], { ...base, unit: 'in' });
    expect(header(dxf, '$INSUNITS')).toBe(1);
    expect(header(dxf, '$MEASUREMENT')).toBe(0);
  });

  it('cerchi e testi si scalano insieme al disegno', () => {
    const mm = buildDxf(strips, { ...base, includeContacts: true, includeLabels: true });
    const inch = buildDxf(strips, { ...base, includeContacts: true, includeLabels: true, unit: 'in' });
    const radii = (dxf: string) => {
      const p = pairs(dxf);
      return p.flatMap(([c], i) => (c === '0' && p[i]![1] === 'CIRCLE' ? [Number(p.slice(i).find(([cc]) => cc === '40')![1])] : []));
    };
    const a = radii(mm);
    const b = radii(inch);
    expect(a.length).toBeGreaterThan(0);
    a.forEach((r, i) => expect(b[i]).toBeCloseTo(r / 25.4, 3));
    const heights = (dxf: string) => {
      const p = pairs(dxf);
      return p.flatMap(([c, v], i) => (c === '0' && v === 'TEXT' ? [Number(p.slice(i).find(([cc]) => cc === '40')![1])] : []));
    };
    expect(heights(inch)[0]).toBeCloseTo(heights(mm)[0]! / 25.4, 3);
  });
});
