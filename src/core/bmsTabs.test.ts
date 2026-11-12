import { describe, expect, it } from 'vitest';
import { setBms } from './ops';
import { intersectRegions, pointInRegions, regionArea } from './clip';
import { buildDxf } from './dxf';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from './holder';
import { buildHarness } from './harness';
import { tabNotches } from './tabNotches';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS, stripOptionsOf } from './lamelle';
import { holeForWireMm, powerAmpacityA, powerAwgFor } from './wire';
import { buildSvg } from './lamelleExport';
import { buildStrips } from './strips';
import type { Project } from './types';
import { pack } from './bmsFixtures';

describe('linguette di presa', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 1 } as const;
  const withBms = (p: Project) => setBms(p, 'bms-13s-40a-li-ion');

  it('senza BMS non ci sono linguette', () => {
    expect(buildStrips(pack(4, 2), { tabs }).filter((s) => s.tab)).toHaveLength(0);
  });

  it('con un BMS: una linguetta per giunzione (S+1) con foro', () => {
    const strips = buildStrips(withBms(pack(4, 2)), { tabs });
    const withTab = strips.filter((s) => s.tab);
    expect(new Set(withTab.map((s) => s.joint)).size).toBe(5);
    expect(withTab).toHaveLength(5);
    for (const s of withTab) {
      expect(s.tab!.holeDiameterMm).toBe(2);
      expect(s.holes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('la linguetta sporge dal lato scelto e non intralcia nel pacco a colonne', () => {
    const p = withBms(pack(4, 2));
    const plain = buildStrips(p);
    const strips = buildStrips(p, { tabs });
    for (const s of strips.filter((x) => x.tab)) {
      const before = plain.find((x) => x.id === s.id)!;
      expect(Math.min(...s.outline.map((q) => q.y))).toBeLessThan(Math.min(...before.outline.map((q) => q.y)) - 8);
      expect(s.areaMm2).toBeGreaterThan(before.areaMm2);
      expect(s.tab!.blockedBy).toBeNull();
    }
  });

  it('una linguetta che finisce su una cella di un’altra giunzione è segnalata', () => {
    const p = withBms(pack(4, 2));
    const strips = buildStrips(p, { tabs: { ...tabs, side: 'left', lengthMm: 40 } });
    expect(strips.some((s) => s.tab?.blockedBy)).toBe(true);
  });
});

describe('linea di piega della linguetta', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 1 } as const;
  const strips = buildStrips(setBms(pack(4, 2), 'bms-4s-30a-li-ion'), { tabs });

  it('sta sulla linguetta, tra la cella e il foro', () => {
    for (const s of strips.filter((x) => x.tab)) {
      const [a, b] = s.tab!.bend;
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.y).toBeGreaterThan(s.tab!.holeY); // y verso il basso: la piega è più vicina alla cella del foro
      expect(Math.abs(a.x - b.x)).toBeCloseTo(s.tab!.widthMm, 6);
      expect(s.tab!.widthMm).toBeCloseTo(6, 6);
    }
  });

  it('finisce in SVG e DXF', () => {
    expect(buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false })).toContain('stroke-dasharray="1.5 0.8"');
    const dxf = buildDxf(strips, { face: 'all', kerfMm: 0, includeContacts: false, includeLabels: false });
    expect(dxf).toMatch(/\n0\r?\nLINE\r?\n/);
  });
});

describe('piega oltre il holder', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 1 } as const;
  const p = setBms(pack(4, 2), 'bms-4s-30a-li-ion');

  it('la piega sta oltre la sagoma del holder, qualunque sia la parete', () => {
    for (const wallMm of [1.6, 4]) {
      const model = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, wallMm }, true)!;
      const outline = model.wall.map((r) => ({ outline: r.outline, holes: [] }));
      const strips = buildStrips(p, { tabs, holderOutline: outline });
      for (const s of strips.filter((x) => x.tab)) {
        const [a, b] = s.tab!.bend;
        for (const q of [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]) expect(pointInRegions(q, outline)).toBe(false);
      }
    }
  });

  it('una parete più spessa porta la piega più lontano', () => {
    const bendY = (wallMm: number) => {
      const outline = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, wallMm }, true)!.wall.map((r) => ({ outline: r.outline, holes: [] }));
      return Math.min(...buildStrips(p, { tabs, holderOutline: outline }).flatMap((s) => (s.tab ? [s.tab.bend[0].y] : [])));
    };
    expect(bendY(4)).toBeLessThan(bendY(1.6) - 2);
  });
});

describe('tacche del portacelle per le linguette', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 0.3 } as const;
  const wires = { balanceAwg: 26, powerAwg: 10 };
  const p = setBms(pack(4, 2), 'bms-4s-30a-li-ion');
  const settings = { ...DEFAULT_HOLDER_SETTINGS, wallMm: 2.4 };

  it('una per linguetta, tutte uguali (anche P+ e P−)', () => {
    const notches = tabNotches(buildStrips(p, { tabs }), settings, wires);
    expect(notches).toHaveLength(5);
    expect(new Set(notches.map((n) => n.depthMm.toFixed(6))).size).toBe(1);
  });

  it('la parete resta stampabile: profondità al massimo parete − 0,8', () => {
    for (const wallMm of [1.2, 1.6, 2.4]) {
      for (const n of tabNotches(buildStrips(p, { tabs }), { ...DEFAULT_HOLDER_SETTINGS, wallMm }, wires)) {
        expect(n.depthMm).toBeLessThanOrEqual(wallMm - 0.8 + 1e-9);
      }
    }
    expect(tabNotches(buildStrips(p, { tabs }), { ...DEFAULT_HOLDER_SETTINGS, wallMm: 1 }, wires)).toEqual([]);
  });

  it('il holder con le tacche ha meno materiale e le tasche delle celle restano intatte', () => {
    const notches = tabNotches(buildStrips(p, { tabs }), settings, wires).map((n) => n.polygon);
    const plain = buildHolder(p, settings, true)!;
    const cut = buildHolder(p, settings, true, { notches })!;
    const area = (m: typeof plain) => m.wall.reduce((a, r) => a + regionArea(r), 0);
    expect(area(cut)).toBeLessThan(area(plain));
    expect(cut.wall.flatMap((r) => r.holes)).toHaveLength(plain.wall.flatMap((r) => r.holes).length);
  });

  it('la piega cade dentro la scanalatura, non fuori dal bordo teorico', () => {
    const strips0 = buildStrips(p, { tabs });
    const notches = tabNotches(strips0, settings, wires).map((n) => n.polygon);
    const outline = buildHolder(p, settings, true, { notches })!.wall.map((r) => ({ outline: r.outline, holes: [] }));
    const plainOutline = buildHolder(p, settings, true)!.wall.map((r) => ({ outline: r.outline, holes: [] }));
    const a = buildStrips(p, { tabs, holderOutline: outline }).find((s) => s.tab && s.kind === 'series')!;
    const b = buildStrips(p, { tabs, holderOutline: plainOutline }).find((s) => s.id === a.id)!;
    expect(a.tab!.bend[0].y).toBeGreaterThan(b.tab!.bend[0].y);
  });
});

describe('tacche con linguette intralciate', () => {
  const tabs = { side: 'left', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 0.3 } as const;
  const p = setBms(pack(4, 2), 'bms-4s-30a-li-ion');

  it('nessuna scanalatura per le linguette che passano sopra altre celle', () => {
    const strips = buildStrips(p, { tabs });
    const blocked = strips.filter((s) => s.tab?.blockedBy);
    expect(blocked.length).toBeGreaterThan(0);
    const ids = tabNotches(strips, DEFAULT_HOLDER_SETTINGS, { balanceAwg: 26, powerAwg: 10 }).map((n) => n.stripId);
    for (const s of blocked) expect(ids).not.toContain(s.id);
  });
});

describe('fori dalle sezioni dei fili', () => {
  it('il foro delle linguette in serie segue l’AWG del filo di bilanciamento', () => {
    expect(holeForWireMm(26)).toBe(1.21);
    expect(holeForWireMm(12)).toBe(2.85);
    expect(stripOptionsOf({ ...DEFAULT_LAMELLA_SETTINGS, balanceAwg: 22 }).tabs?.holeMm).toBe(1.44);
  });
});

describe('cavi di potenza', () => {
  it('la portata cresce con la sezione e la scelta minima segue la corrente', () => {
    expect(powerAmpacityA(16)).toBeLessThan(powerAmpacityA(12));
    expect(powerAmpacityA(12)).toBeLessThan(powerAmpacityA(8));
    expect(powerAmpacityA(26)).toBe(0); // non è un cavo di potenza
    expect(powerAwgFor(8)).toBe(16);
    expect(powerAwgFor(30)).toBe(10);
    expect(powerAwgFor(31)).toBe(8);
    expect(powerAwgFor(500)).toBeNull();
  });

  it('il rapporto avvisa se il cavo non regge la corrente di progetto', () => {
    const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
    const strips = buildStrips(p, {});
    const warn = (awg: number) => analyzeLamelle(p, strips, { ...DEFAULT_LAMELLA_SETTINGS, powerAwg: awg }, 30).issues.some((i) => i.message.includes(`AWG ${awg}`) && i.message.includes('30'));
    expect(warn(16)).toBe(true);
    expect(warn(12)).toBe(true);
    expect(warn(10)).toBe(false); // regge 30 A
  });
});

describe('linguette di potenza opzionali', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const withTabs = (over: Partial<typeof DEFAULT_LAMELLA_SETTINGS>, wireHoles = false) => {
    const o = stripOptionsOf({ ...DEFAULT_LAMELLA_SETTINGS, ...over }, wireHoles);
    return { o, strips: buildStrips(p, o) };
  };

  it('di default ci sono le linguette di potenza su P+ e P−', () => {
    const { strips } = withTabs({});
    expect(strips.filter((x) => x.powerTab)).toHaveLength(2);
    expect(strips.filter((x) => x.tab)).toHaveLength(5);
  });

  it('senza linguette di potenza restano solo quelle di bilanciamento', () => {
    const { o, strips } = withTabs({ powerTabs: false });
    expect(o.tabs?.power).toBeNull();
    expect(strips.some((x) => x.powerTab)).toBe(false);
    expect(strips.filter((x) => x.tab)).toHaveLength(5);
  });

  it('solo potenza, solo bilanciamento o niente: ognuna è una scelta a sé', () => {
    expect(withTabs({ tabs: false }).strips.filter((x) => x.tab)).toHaveLength(0);
    expect(withTabs({ tabs: false }).strips.filter((x) => x.powerTab)).toHaveLength(2);
    const none = withTabs({ tabs: false, powerTabs: false });
    expect(none.o.tabs?.style).toBe('none'); // il lato di uscita serve comunque ai fili
    expect(none.o.tabs?.power).toBeNull();
    expect(none.strips.some((x) => x.tab || x.powerTab)).toBe(false);
    // con i fori nel portacelle serve comunque il lato di uscita, senza nessuna linguetta
    const holes = withTabs({ tabs: false, powerTabs: false }, true);
    expect(holes.o.tabs?.style).toBe('none');
    expect(holes.o.tabs?.power).toBeNull();
    expect(holes.strips.some((x) => x.tab || x.powerTab)).toBe(false);
  });
});

describe('linguetta di potenza di P+ e P−', () => {
  const tabs = { side: 'bottom', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, power: { widthMm: 8, holeMm: 3.39 } } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });
  const terminals = strips.filter((x) => x.tab && x.kind !== 'series');

  it('solo P+ e P− hanno la linguetta di potenza, a 90° da quelle di bilanciamento', () => {
    expect(terminals).toHaveLength(2);
    for (const s of strips.filter((x) => x.tab)) {
      expect(s.tab!.side).toBe('bottom');
      if (s.kind === 'series') {
        expect(s.powerTab).toBeUndefined();
        continue;
      }
      expect(s.powerTab?.kind).toBe('power');
      expect(s.tab!.kind).toBe('balance');
      expect(s.powerTab!.holeDiameterMm).toBeCloseTo(3.39, 6);
      expect(s.tab!.holeDiameterMm).toBeCloseTo(1.21, 6);
      expect(['left', 'right']).toContain(s.powerTab!.side);
    }
  });

  it('P+ e P− escono da lati opposti (qui sinistra e destra), e le linguette non si toccano', () => {
    const sides = terminals.map((s) => s.powerTab!.side).sort();
    expect(sides).toEqual(['left', 'right']);
    for (const s of terminals) {
      const a = s.tab!;
      const b = s.powerTab!;
      const overlap = intersectRegions([{ outline: a.rect, holes: [] }], [b.rect]).reduce((acc, r) => acc + regionArea(r), 0);
      expect(overlap).toBeLessThan(1e-6);
      // bilanciamento verso il basso: piega orizzontale (stessa y); potenza di lato: piega verticale (stessa x)
      expect(a.bend[0].y).toBeCloseTo(a.bend[1].y, 6);
      expect(b.bend[0].x).toBeCloseTo(b.bend[1].x, 6);
      expect(b.blockedBy).toBeNull();
    }
  });

  it('il portacelle ha una scanalatura per linguetta, più profonda per il cavo di potenza', () => {
    const notches = tabNotches(strips, { ...DEFAULT_HOLDER_SETTINGS, wallMm: 3 }, { balanceAwg: 26, powerAwg: 10 });
    const ids = (suffix: string) => notches.filter((n) => n.stripId.endsWith(suffix));
    expect(notches.length).toBeGreaterThanOrEqual(5);
    const depths = notches.map((n) => n.depthMm);
    expect(Math.max(...depths)).toBeGreaterThan(Math.min(...depths));
    expect(ids('-0').length + ids('-4').length).toBeGreaterThanOrEqual(2);
  });

  it('nel DXF i fori tondi sono archi veri e non spezzate', () => {
    const dxf = buildDxf(strips, { face: 'all', kerfMm: 0.1, includeContacts: false, includeLabels: false });
    const rings = dxf.split('POLYLINE').slice(1).map((blk) => blk.split('VERTEX').slice(1));
    expect(rings.length).toBeGreaterThan(0);
    for (const verts of rings) {
      const withBulge = verts.filter((v) => /\n42\n/.test(v)).length;
      // un anello con molti vertici e nessun arco sarebbe un cerchio a spezzata
      if (verts.length >= 12) expect(withBulge).toBeGreaterThan(0);
    }
  });
});

describe('linguette dei terminali', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3 } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });

  it('P+ e P− hanno la stessa linguetta delle serie: un solo foro piccolo per il filo di bilanciamento', () => {
    const plain = buildStrips(p, {});
    const withTab = strips.filter((x) => x.tab);
    expect(withTab).toHaveLength(5);
    for (const s of withTab) {
      expect(s.holes.length).toBe(plain.find((x) => x.id === s.id)!.holes.length + 1);
      expect(s.tab!.holeDiameterMm).toBeCloseTo(1.21, 6);
      expect(s.tab!.widthMm).toBeCloseTo(withTab[0]!.tab!.widthMm, 6);
    }
  });

  it('il filo di bilanciamento parte dall’altezza del foro della linguetta', () => {
    const h = buildHarness(p, strips, 0.1)!;
    for (const w of [h.wires[0]!, h.wires[h.wires.length - 1]!]) {
      const s = strips.find((x) => x.id === w.stripId)!;
      const bend = s.tab!.bend;
      const midY = (bend[0].y + bend[1].y) / 2;
      const u = midY - s.tab!.holeY; // lato alto del disegno: la linguetta esce verso y minore
      const expected = w.face === 'top' ? 70.4 + 1.1 + 0.1 - u : -1.1 - 0.1 + u;
      expect(w.points[0]!.y).toBeCloseTo(expected, 6);
    }
  });
});
