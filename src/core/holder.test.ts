import { describe, expect, it } from 'vitest';
import { closeRegions, differenceRegions, circlePolygon, regionArea, unionAll } from './clip';
import { analyzeHolder, buildHolder, buildToleranceTest, clearanceLabel, DEFAULT_HOLDER_SETTINGS } from './holder';
import { generateGrid } from './layout';
import { replaceCells } from './ops';
import { createProject } from './project';
import { stlBinary } from './stl';

const T = '21700-5000-10a';
const pack = (series: number, parallel: number, gapMm = 1, kind: 'hex' | 'square' = 'hex') =>
  replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series, parallel, kind, gapMm }));

describe('differenceRegions', () => {
  it('un cerchio meno un cerchio più piccolo: corona con un buco', () => {
    const outer = { outline: circlePolygon(0, 0, 10), holes: [] };
    const r = differenceRegions(outer, [circlePolygon(0, 0, 6)]);
    expect(r).toHaveLength(1);
    expect(r[0]!.holes).toHaveLength(1);
    expect(regionArea(r[0]!)).toBeCloseTo(Math.PI * (100 - 36), -1);
  });

  it('se il buco isola una parte, questa resta come forma a sé', () => {
    // anello di tasche attorno a un'isola centrale
    const outer = { outline: circlePolygon(0, 0, 20), holes: [] };
    const ring = differenceRegions({ outline: circlePolygon(0, 0, 10), holes: [] }, [circlePolygon(0, 0, 5)]);
    expect(ring).toHaveLength(1);
    const cut = differenceRegions(outer, [ring[0]!.outline]);
    expect(cut.length).toBe(1);
    const island = differenceRegions(outer, [circlePolygon(0, 0, 10)]);
    const fine = differenceRegions(island[0]!, [circlePolygon(0, 0, 14)]);
    expect(fine.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildHolder', () => {
  it('senza celle non c\'è nulla da costruire', () => {
    expect(buildHolder(createProject())).toBeNull();
  });

  it('3S2P: una piastra con 6 fori e 6 tasche, più larga delle sole celle', () => {
    const p = pack(3, 2);
    const h = buildHolder(p)!;
    expect(h.slab).toHaveLength(1);
    expect(h.slab[0]!.holes).toHaveLength(6);
    expect(h.wall).toHaveLength(1);
    expect(h.wall[0]!.holes).toHaveLength(6);
    const s = DEFAULT_HOLDER_SETTINGS;
    const r = analyzeHolder(p, h);
    // ingombro celle 77,4 × 40,8 + parete e gioco da ogni lato
    expect(r.widthMm).toBeCloseTo(77.4 + 2 * (s.wallMm + s.clearanceMm), 0);
    expect(r.depthMm).toBeCloseTo(40.8 + 2 * (s.wallMm + s.clearanceMm), 0);
    expect(r.totalHeightMm).toBeCloseTo(70.4 + 2 * s.floorMm, 6); // 21700: 70,4 mm
  });

  it('le fessure minuscole tra tre celle si riempiono, i vuoti grandi tra quattro restano', () => {
    const hex = buildHolder(pack(3, 3))!;
    expect(hex.slab[0]!.holes).toHaveLength(9); // solo i fori dei terminali
    const sq = buildHolder(pack(3, 3, 1, 'square'))!;
    expect(sq.slab[0]!.holes.length).toBeGreaterThan(9); // + i vuoti al centro dei quadrati
  });

  it('i fori del fondo hanno raggio R − bordo, le tasche R + gioco', () => {
    const p = pack(1, 1);
    const h = buildHolder(p)!;
    const s = DEFAULT_HOLDER_SETTINGS;
    const hole = (pts: { x: number; y: number }[]) => Math.hypot(pts[0]!.x - 0, pts[0]!.y - 0);
    const R = 21.4 / 2;
    expect(hole(h.slab[0]!.holes[0]!)).toBeCloseTo(R - s.ledgeMm, 1);
    expect(hole(h.wall[0]!.holes[0]!)).toBeCloseTo(R + s.clearanceMm, 1);
  });

  it('le pareti non superano metà cella', () => {
    const h = buildHolder(pack(2, 1), { ...DEFAULT_HOLDER_SETTINGS, lipMm: 500 })!;
    expect(h.lipMm).toBeLessThanOrEqual(h.cellHeightMm / 2 - 1 + 1e-9);
  });
});

describe('analyzeHolder', () => {
  it('spazio di 1 mm e gioco 0,15: parete di 0,7 mm, avviso di fragilità', () => {
    const p = pack(2, 2, 1);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.minWallBetweenMm).toBeCloseTo(0.7, 2);
    expect(r.issues.some((i) => i.level === 'warning' && i.text.includes('parete'))).toBe(true);
  });

  it('spazio di 2 mm: nessun avviso sulle pareti', () => {
    const p = pack(2, 2, 2);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.minWallBetweenMm).toBeCloseTo(1.7, 2);
    expect(r.issues.some((i) => i.text.includes('parete'))).toBe(false);
  });

  it('tasche che si sovrappongono: errore', () => {
    const p = pack(2, 1, 0.1);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('un pacco grande non sta nel piano di stampa', () => {
    const p = pack(13, 4);
    const r = analyzeHolder(p, buildHolder(p)!);
    expect(r.issues.some((i) => i.text.includes('piano di stampa'))).toBe(true);
    const small = pack(2, 2, 2);
    expect(analyzeHolder(small, buildHolder(small)!).issues.some((i) => i.text.includes('piano di stampa'))).toBe(false);
  });

  it('consiglia sempre materiali che reggono il calore', () => {
    const p = pack(1, 1);
    expect(analyzeHolder(p, buildHolder(p)!).issues.some((i) => i.text.includes('PETG'))).toBe(true);
  });

  it('il volume è positivo e cresce con lo spessore del fondo', () => {
    const p = pack(2, 2, 2);
    const a = analyzeHolder(p, buildHolder(p)!).volumeMm3;
    const b = analyzeHolder(p, buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, floorMm: 2 })!).volumeMm3;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
});

describe('stlBinary', () => {
  it('un triangolo: 84 + 50 byte, normale +z', () => {
    const out = stlBinary([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(out.byteLength).toBe(134);
    const v = new DataView(out.buffer);
    expect(v.getUint32(80, true)).toBe(1);
    expect(v.getFloat32(84 + 8, true)).toBeCloseTo(1, 6); // nz
    expect(v.getFloat32(84 + 12 + 12, true)).toBeCloseTo(1, 6); // x del secondo vertice
  });
});

describe('raccordo e gruppi lontani', () => {
  it('unionAll tiene separate le forme che non si toccano', () => {
    const two = unionAll([circlePolygon(0, 0, 10), circlePolygon(21, 0, 10)]);
    expect(two).toHaveLength(2); // distanza 21 > 20: forme separate
  });

  it('un cerchio solo non cambia', () => {
    const one = unionAll([circlePolygon(0, 0, 10)]);
    const closed = closeRegions(one, 3);
    expect(regionArea(closed[0]!)).toBeCloseTo(regionArea(one[0]!), -1);
  });

  it('due cerchi sovrapposti: il raccordo riempie l\'incavo (area maggiore)', () => {
    const u = unionAll([circlePolygon(0, 0, 10), circlePolygon(16, 0, 10)]);
    const closed = closeRegions(u, 3);
    expect(closed).toHaveLength(1);
    expect(regionArea(closed[0]!)).toBeGreaterThan(regionArea(u[0]!) + 1);
  });

  it('celle in due gruppi lontani: il portacelle ha le pareti di entrambi', () => {
    const base = pack(2, 1, 2);
    const far = { ...base, cells: base.cells.map((c, i) => ({ ...c, x: c.x + i * 300 })) };
    const h = buildHolder(far)!;
    expect(h.wall).toHaveLength(2);
    expect(h.slab).toHaveLength(2);
  });
});

describe('fette e smusso', () => {
  const s = DEFAULT_HOLDER_SETTINGS;

  it('le fette coprono tutto lo spessore, senza buchi', () => {
    const h = buildHolder(pack(2, 2, 2))!;
    expect(h.layers[0]!.z0).toBe(0);
    expect(h.layers[h.layers.length - 1]!.z1).toBeCloseTo(h.totalMm, 6);
    for (let i = 1; i < h.layers.length; i++) expect(h.layers[i]!.z0).toBeCloseTo(h.layers[i - 1]!.z1, 6);
    expect(h.totalMm).toBeCloseTo(s.floorMm + s.lipMm, 6);
  });

  it('sulla faccia esterna del fondo la sagoma è ritirata di circa lo smusso', () => {
    const h = buildHolder(pack(1, 1))!;
    const width = (rs: { outline: { x: number }[] }[]) => Math.max(...rs.flatMap((r) => r.outline.map((p) => p.x))) - Math.min(...rs.flatMap((r) => r.outline.map((p) => p.x)));
    const full = width(h.wall);
    const first = width(h.layers[0]!.regions);
    expect(first).toBeCloseTo(full - 2 * 0.5, 1); // primo gradino a metà di 0,2 mm → ritiro 0,5
  });

  it('smusso a rampa: poche fette, contorni accoppiati e volume vicino a quello a gradini', () => {
    const p = pack(2, 2, 2);
    const stairs = buildHolder(p)!;
    const smooth = buildHolder(p, s, true)!;
    expect(smooth.ramp).not.toBeNull();
    expect(smooth.ramp!.contours.length).toBeGreaterThanOrEqual(1);
    expect(smooth.layers.length).toBeLessThanOrEqual(5);
    expect(smooth.layers[0]!.z0).toBe(0);
    expect(smooth.layers[smooth.layers.length - 1]!.z1).toBeCloseTo(smooth.totalMm, 6);
    for (let i = 1; i < smooth.layers.length; i++) expect(smooth.layers[i]!.z0).toBeCloseTo(smooth.layers[i - 1]!.z1, 6);
    const vs = analyzeHolder(p, stairs).volumeMm3;
    const vr = analyzeHolder(p, smooth).volumeMm3;
    expect(Math.abs(vr - vs) / vs).toBeLessThan(0.02);
  });

  it('senza smusso la rampa non c\'è', () => {
    expect(buildHolder(pack(2, 1, 2), { ...s, chamferMm: 0 }, true)!.ramp).toBeNull();
  });

  it('senza smusso restano due fette: fondo e pareti', () => {
    const h = buildHolder(pack(2, 1, 2), { ...s, chamferMm: 0 })!;
    expect(h.layers).toHaveLength(2);
  });

  it('lo smusso toglie plastica', () => {
    const p = pack(2, 2, 2);
    const withC = analyzeHolder(p, buildHolder(p)!).volumeMm3;
    const without = analyzeHolder(p, buildHolder(p, { ...s, chamferMm: 0 })!).volumeMm3;
    expect(withC).toBeLessThan(without);
  });

  it('lo smusso non supera i tre quarti della parete', () => {
    const h = buildHolder(pack(1, 1), { ...s, chamferMm: 2 })!;
    expect(h.chamferMm).toBeLessThanOrEqual(s.wallMm * 0.75 + 1e-9);
  });
});

describe('senza blocco celle', () => {
  it('niente fondo: spessore = pareti, pacco alto come le celle, nessun foro', () => {
    const p = pack(2, 2, 2);
    const h = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, lockCells: false })!;
    expect(h.floorMm).toBe(0);
    expect(h.slab).toHaveLength(0);
    expect(h.openingDiameterMm).toBeNull();
    expect(analyzeHolder(p, h).totalHeightMm).toBeCloseTo(70.4, 6);
    expect(analyzeHolder(p, h).issues.some((i) => i.text.includes('non le bloccano'))).toBe(true);
  });

  it('con il blocco il foro è 2·(R − bordo)', () => {
    const h = buildHolder(pack(1, 1))!;
    expect(h.openingDiameterMm).toBeCloseTo(2 * (10.7 - DEFAULT_HOLDER_SETTINGS.ledgeMm), 6);
  });
});

describe('geometria arrotondata', () => {
  const rounded = { ...DEFAULT_HOLDER_SETTINGS, shape: 'rounded' as const };

  it('il contorno è convesso: l\'area è quella del suo inviluppo, maggiore del profilo cella', () => {
    const p = pack(3, 3, 1.5, 'square');
    const prof = buildHolder(p)!;
    const rnd = buildHolder(p, rounded)!;
    const area = (h: typeof prof) => h.wall.reduce((a, r) => a + regionArea(r), 0);
    expect(rnd.wall).toHaveLength(1);
    expect(rnd.wall[0]!.holes).toHaveLength(9); // solo le tasche: niente vuoti tra le celle
    expect(area(rnd)).toBeGreaterThanOrEqual(area(prof) - 1e-6);
  });

  it('gruppi di celle lontani restano separati', () => {
    const base = pack(2, 1, 2);
    const far = { ...base, cells: base.cells.map((c, i) => ({ ...c, x: c.x + i * 300 })) };
    expect(buildHolder(far, rounded)!.wall).toHaveLength(2);
  });

  it('con una cella sola è un cerchio, come nel profilo', () => {
    const p = pack(1, 1);
    const a = regionArea(buildHolder(p, rounded)!.slab[0]!);
    const b = regionArea(buildHolder(p)!.slab[0]!);
    expect(a).toBeCloseTo(b, -1);
  });
});

describe('buildToleranceTest', () => {
  const none = { customCellTypes: [] };

  it('tipo di cella sconosciuto o nessun gioco: niente', () => {
    expect(buildToleranceTest(none, 'non-esiste')).toBeNull();
    expect(buildToleranceTest(none, T, [])).toBeNull();
  });

  it('una tasca per gioco, ognuna larga quanto cella + 2 giochi', () => {
    const h = buildToleranceTest(none, T, [0.3, 0.1, 0.2])!;
    expect(h.wall).toHaveLength(1);
    const widths = h.wall[0]!.holes
      .map((ring) => {
        const xs = ring.map((p) => p.x);
        return Math.max(...xs) - Math.min(...xs);
      })
      .sort((a, b) => a - b);
    expect(widths).toHaveLength(3);
    [0.1, 0.2, 0.3].forEach((cl, i) => expect(widths[i]).toBeCloseTo(21.4 + 2 * cl, 1));
  });

  it('pareti basse: fondo + 4 mm al massimo', () => {
    const h = buildToleranceTest(none, T)!;
    expect(h.lipMm).toBeLessThanOrEqual(4);
    expect(h.totalMm).toBeCloseTo(DEFAULT_HOLDER_SETTINGS.floorMm + h.lipMm, 6);
  });

  it('i giochi sono incisi sul bordo delle pareti, solo negli strati alti', () => {
    const h = buildToleranceTest(none, T)!;
    const holes = (l: { regions: { holes: unknown[] }[] }) => l.regions.reduce((n, r) => n + r.holes.length, 0);
    const top = h.layers[h.layers.length - 1]!;
    const wallLow = h.layers.find((l) => l.z0 <= 2 && l.z1 >= 2)!;
    expect(top.z1).toBeCloseTo(h.totalMm, 6);
    expect(holes(top)).toBeGreaterThan(holes(wallLow));
    expect(clearanceLabel(0.15)).toBe('15');
  });

  it('i giochi si ordinano: il più stretto a sinistra', () => {
    const h = buildToleranceTest(none, T, [0.3, 0.1])!;
    const holes = h.wall[0]!.holes.map((ring) => ({
      cx: (Math.max(...ring.map((p) => p.x)) + Math.min(...ring.map((p) => p.x))) / 2,
      w: Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x)),
    }));
    holes.sort((a, b) => a.cx - b.cx);
    expect(holes[0]!.w).toBeLessThan(holes[1]!.w);
  });
});
