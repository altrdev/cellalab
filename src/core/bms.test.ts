import { describe, expect, it } from 'vitest';
import { allBmsTypes, bmsFromDraft, bmsOf, BUILTIN_BMS_TYPES, validateBms } from './bms';
import { runDrc } from './drc';
import { generateGrid } from './layout';
import { addCustomBms, removeCustomBms, replaceCells, setBms, setBmsMount, setCurrentLimit } from './ops';
import { createProject, parseProject, serializeProject } from './project';
import { computeStats } from './stats';
import { pointInRegions, regionArea, unionPolygons } from './clip';
import { buildDxf } from './dxf';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from './holder';
import { buildHarness } from './harness';
import { ntcSite, ntcSites } from './ntc';
import { ntcRoute } from './ntcRoute';
import { tabNotches } from './tabNotches';
import { DEFAULT_LAMELLA_SETTINGS, stripOptionsOf } from './lamelle';
import { holeForWireMm } from './wire';
import { buildSvg } from './lamelleExport';
import { buildStrips, tabsOf } from './strips';
import type { Project } from './types';

const T = '21700-5000-10a';
const pack = (s: number, p: number): Project =>
  replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: s, parallel: p, kind: 'hex', gapMm: 1 }));
const codes = (p: Project) => runDrc(p).map((i) => i.code);

describe('catalogo BMS', () => {
  it('gli id sono unici e le serie coerenti', () => {
    const ids = BUILTIN_BMS_TYPES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BUILTIN_BMS_TYPES) expect(b.minSeries).toBeLessThanOrEqual(b.maxSeries);
  });
});

describe('scelta del BMS', () => {
  it('setBms imposta e toglie', () => {
    const id = BUILTIN_BMS_TYPES[3]!.id;
    const p = setBms(createProject(), id);
    expect(bmsOf(p)?.id).toBe(id);
    expect(bmsOf(setBms(p, undefined))).toBeUndefined();
  });

  it('un BMS personalizzato si aggiunge e togliendolo il pacco resta senza', () => {
    const type = bmsFromDraft(createProject(), { name: 'Mio 6S', minSeries: 6, maxSeries: 6, maxCurrentA: 25, chemistry: 'li-ion', ntc: false, lengthMm: 0, widthMm: 0, thicknessMm: 0 });
    let p = setBms(addCustomBms(createProject(), type), type.id);
    expect(allBmsTypes(p)[0]!.id).toBe(type.id);
    expect(() => addCustomBms(p, type)).toThrow();
    p = removeCustomBms(p, type.id);
    expect(p.bmsId).toBeUndefined();
    expect(p.customBmsTypes).toBeUndefined();
  });

  it('validateBms', () => {
    expect(validateBms({ name: '', minSeries: 5, maxSeries: 3, maxCurrentA: 0, chemistry: 'li-ion', ntc: true, lengthMm: 0, widthMm: 0, thicknessMm: 0 })).toHaveLength(3);
  });
});

describe('verifiche BMS', () => {
  const bms13 = BUILTIN_BMS_TYPES.find((b) => b.id === 'bms-13s-40a-li-ion')!.id;

  it('senza BMS non c’è nessuna verifica BMS', () => {
    expect(codes(pack(13, 3)).filter((c) => c.startsWith('bms'))).toEqual([]);
  });

  it('S giusta: solo l’informazione sui fili n+1', () => {
    const issues = runDrc(setBms(pack(13, 3), bms13));
    expect(issues.map((i) => i.code)).toEqual(['bms-wires']);
    expect(issues[0]!.message).toContain('14');
  });

  it('S diversa = errore', () => {
    expect(codes(setBms(pack(10, 3), bms13))).toContain('bms-series');
  });

  it('chimica diversa = errore con le celle', () => {
    const p = setBms(pack(8, 2), 'bms-8s-100a-lifepo4');
    const issue = runDrc(p).find((i) => i.code === 'bms-chemistry');
    expect(issue?.severity).toBe('error');
    expect(issue?.cellIds).toHaveLength(16);
  });

  it('corrente di progetto sopra il BMS = avviso', () => {
    const p = setCurrentLimit(setBms(pack(13, 8), bms13), 60);
    expect(codes(p)).toContain('bms-current');
  });

  it('il limite del BMS fa da tetto alla corrente del pacco', () => {
    const p = pack(13, 8); // celle: 80 A
    expect(computeStats(p).maxCurrentA).toBe(80);
    const s = computeStats(setBms(p, bms13));
    expect(s.maxCurrentA).toBe(40);
    expect(s.limitedByBms).toBe(true);
  });
});

describe('salvataggio', () => {
  it('BMS scelto e personalizzato sopravvivono al giro JSON', () => {
    const type = bmsFromDraft(createProject(), { name: 'Mio', minSeries: 4, maxSeries: 8, maxCurrentA: 20, chemistry: 'lifepo4', ntc: true, lengthMm: 0, widthMm: 0, thicknessMm: 0 });
    const p = setBms(addCustomBms(createProject(), type), type.id);
    const back = parseProject(serializeProject(p));
    expect(back.bmsId).toBe(type.id);
    expect(back.customBmsTypes).toEqual([type]);
  });

  it('un bmsId sconosciuto o un BMS malformato si ignorano', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.bmsId = 'non-esiste';
    raw.customBmsTypes = [{ id: 'x' }];
    const back = parseProject(JSON.stringify(raw));
    expect(back.bmsId).toBeUndefined();
    expect(back.customBmsTypes).toBeUndefined();
  });
});

describe('linguette di presa', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 1, powerHoleMm: 2.9 } as const;
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
      expect(s.tab!.holeDiameterMm).toBe(s.kind === 'series' ? 2 : 2.9);
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
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 1, powerHoleMm: 2.9 } as const;
  const strips = buildStrips(setBms(pack(4, 2), 'bms-4s-30a-li-ion'), { tabs });

  it('sta sulla linguetta, tra la cella e il foro', () => {
    for (const s of strips.filter((x) => x.tab)) {
      for (const tab of tabsOf(s)) {
        const [a, b] = tab.bend;
        const horizontal = tab.side === 'top' || tab.side === 'bottom'; // la piega è una retta orizzontale o verticale
        if (horizontal) expect(a.y).toBeCloseTo(b.y, 6);
        else expect(a.x).toBeCloseTo(b.x, 6);
        const out = tab.side === 'top' || tab.side === 'left' ? -1 : 1; // verso dove sporge (y e x verso il basso e destra)
        const beyond = horizontal ? (tab.holeY - a.y) * out : (tab.holeX - a.x) * out;
        expect(beyond).toBeGreaterThan(0); // il foro sta oltre la piega, in fuori
        expect(horizontal ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y)).toBeCloseTo(tab.widthMm, 6);
        if (!tab.power) expect(tab.widthMm).toBeGreaterThanOrEqual(3 - 1e-6);
        else expect(tab.widthMm).toBeGreaterThanOrEqual(2.85 + 2.4 - 1e-6);
      }
    }
  });

  it('finisce in SVG e DXF', () => {
    expect(buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false })).toContain('stroke-dasharray="1.5 0.8"');
    const dxf = buildDxf(strips, { face: 'all', kerfMm: 0, includeContacts: false, includeLabels: false });
    expect(dxf).toMatch(/\n0\r?\nLINE\r?\n/);
  });
});

describe('piega oltre il holder', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 1, powerHoleMm: 2.9 } as const;
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
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 0.3, powerHoleMm: 2.9 } as const;
  const wires = { balanceAwg: 26, powerAwg: 12 };
  const p = setBms(pack(4, 2), 'bms-4s-30a-li-ion');
  const settings = { ...DEFAULT_HOLDER_SETTINGS, wallMm: 2.4 };

  it('una per linguetta (i terminali ne hanno due), più profonda per il cavo di potenza', () => {
    const notches = tabNotches(buildStrips(p, { tabs }), settings, wires);
    expect(notches).toHaveLength(7);
    const terminal = (id: string) => id.endsWith('-0') || id.endsWith('-4');
    const seriesDepth = notches.filter((n) => !terminal(n.stripId)).map((n) => n.depthMm);
    for (const id of ['top-0', 'top-4']) {
      const depths = notches.filter((n) => n.stripId === id).map((n) => n.depthMm);
      expect(depths).toHaveLength(2);
      expect(Math.max(...depths)).toBeGreaterThanOrEqual(Math.max(...seriesDepth) - 1e-9);
    }
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
  const tabs = { side: 'left', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 0.3, powerHoleMm: 2.9 } as const;
  const p = setBms(pack(4, 2), 'bms-4s-30a-li-ion');

  it('nessuna scanalatura per le linguette che passano sopra altre celle', () => {
    const strips = buildStrips(p, { tabs });
    const blocked = strips.filter((s) => tabsOf(s).length > 0 && tabsOf(s).every((x) => x.blockedBy));
    expect(blocked.length).toBeGreaterThan(0);
    const ids = tabNotches(strips, DEFAULT_HOLDER_SETTINGS, { balanceAwg: 26, powerAwg: 12 }).map((n) => n.stripId);
    for (const s of blocked) expect(ids).not.toContain(s.id);
  });
});

describe('fori dalle sezioni dei fili', () => {
  it('il foro delle linguette in serie segue l’AWG del filo di bilanciamento', () => {
    expect(holeForWireMm(26)).toBe(1.21);
    expect(holeForWireMm(12)).toBe(2.85);
    expect(stripOptionsOf({ ...DEFAULT_LAMELLA_SETTINGS, balanceAwg: 22 }).tabs?.holeMm).toBe(1.44);
    expect(stripOptionsOf({ ...DEFAULT_LAMELLA_SETTINGS, powerAwg: 10 }).tabs?.powerHoleMm).toBe(3.39);
  });
});

describe('posto dell’NTC', () => {
  const p = pack(4, 3);

  it('sta nel vuoto tra tre celle, fuori dalle loro tasche', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    expect(site).not.toBeNull();
    expect(site.cellIds).toHaveLength(3);
    for (const id of site.cellIds) {
      const c = p.cells.find((x) => x.id === id)!;
      const dist = Math.hypot(c.x - site.x, c.y - site.y);
      expect(dist).toBeGreaterThan(10.7 + 0.15 - 1e-6); // fuori dalla tasca
      expect(dist - (10.7 + 0.15)).toBeLessThan(site.radiusMm); // ma il foro la tocca: si apre sulla cella
    }
  });

  it('il lato di uscita sposta la scelta verso quel lato', () => {
    const top = ntcSite(p, 'top', 5, 0.15)!;
    const bottom = ntcSite(p, 'bottom', 5, 0.15)!;
    expect(top.y).toBeLessThan(bottom.y);
  });

  it('con meno di tre celle o tutte in fila non c’è', () => {
    expect(ntcSite(pack(2, 1), 'top', 5, 0.15)).toBeNull();
    expect(ntcSite(replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: 4, parallel: 1, kind: 'square', gapMm: 1 })), 'top', 5, 0.15)).toBeNull();
  });

  it('la tasca apre le pareti ma non il fondo', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true)!;
    const cut = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true, { extraPockets: [site.polygon] })!;
    const vol = (m: typeof plain, inFloor: boolean) =>
      m.layers.filter((l) => (inFloor ? l.z1 <= m.floorMm + 1e-9 : l.z0 >= m.floorMm - 1e-9)).reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(vol(cut, false)).toBeLessThan(vol(plain, false));
    expect(vol(cut, true)).toBeCloseTo(vol(plain, true), 6);
  });
});

describe('filo dell’NTC', () => {
  const p = pack(4, 3);

  it('il foro del filo passa anche nel fondo', () => {
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true)!;
    const cut = buildHolder(p, DEFAULT_HOLDER_SETTINGS, true, { extraPockets: [site.polygon], throughHoles: [site.wirePolygon] })!;
    const floorVol = (m: typeof plain) => m.layers.filter((l) => l.z1 <= m.floorMm + 1e-9).reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(floorVol(cut)).toBeLessThan(floorVol(plain));
  });

  it('preferisce i vuoti non coperti da una lamella', () => {
    const free = ntcSite(p, 'top', 5, 0.15)!;
    expect(free.covered).toBe(false);
    // una lamella finta che copre il vuoto scelto: il sito si sposta
    const cover = [{ outline: [{ x: free.x - 6, y: free.y - 6 }, { x: free.x + 6, y: free.y - 6 }, { x: free.x + 6, y: free.y + 6 }, { x: free.x - 6, y: free.y + 6 }], holes: [] }];
    const moved = ntcSite(p, 'top', 5, 0.15, cover)!;
    expect(Math.hypot(moved.x - free.x, moved.y - free.y)).toBeGreaterThan(6);
    expect(moved.covered).toBe(false);
  });

  it('se tutti i vuoti sono coperti lo dice', () => {
    const all = [{ outline: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }], holes: [] }];
    expect(ntcSite(p, 'top', 5, 0.15, all)!.covered).toBe(true);
  });
});

describe('solco del filo dell’NTC', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const settings = DEFAULT_HOLDER_SETTINGS;
  const site = ntcSite(p, 'top', 5, settings.clearanceMm)!;
  const slab = buildHolder(p, settings, false)!.slab;
  const start = { x: site.x, y: site.y };
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ outline: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [] });

  it('trova un percorso dal foro al bordo di uscita', () => {
    const t0 = Date.now();
    const route = ntcRoute(slab, [], start, 'top');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(route.found).toBe(true);
    expect(route.path[0]).toEqual(start);
    const end = route.path[route.path.length - 1]!;
    expect(end.y).toBeLessThan(site.y); // verso l'alto del disegno
    expect(route.lengthMm).toBeGreaterThan(0);
  });

  it('con una lamella sulla strada non la attraversa mai: la aggira o dice che non c’è', () => {
    const wall = box(site.x - 1, site.y - 12, site.x + 1, site.y - 3); // sopra il foro
    const route = ntcRoute(slab, [wall], start, 'top');
    for (const poly of route.polygons) for (const q of poly) expect(pointInRegions(q, [wall])).toBe(false);
    if (route.found) expect(route.lengthMm).toBeGreaterThan(ntcRoute(slab, [], start, 'top').lengthMm);
  });

  it('senza strada libera dice che non c’è', () => {
    const everything = box(-500, -500, 500, 500);
    expect(ntcRoute(slab, [everything], start, 'top').found).toBe(false);
  });

  it('nel 4S3P con le lamelle nessun vuoto ha una strada libera: lo dice', () => {
    const strips = buildStrips(p, { tabs: { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3, powerHoleMm: 2.85 } });
    const avoid = strips.map((s) => ({ outline: s.outline, holes: s.holes }));
    const found = ntcSites(p, 'top', 5, settings.clearanceMm, avoid).some((s) => ntcRoute(slab, avoid, { x: s.x, y: s.y }, 'top').found);
    expect(found).toBe(false);
  });

  it('il solco scava solo la faccia esterna del fondo', () => {
    const route = ntcRoute(slab, [], start, 'top');
    const plain = buildHolder(p, settings, true)!;
    const cut = buildHolder(p, settings, true, { grooves: route.polygons })!;
    const volume = (m: typeof plain) => m.layers.reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(volume(cut)).toBeLessThan(volume(plain));
    expect(plain.totalMm).toBeCloseTo(cut.totalMm, 6);
    const flat = regionArea(unionPolygons(route.polygons));
    expect(volume(plain) - volume(cut)).toBeLessThanOrEqual(flat * settings.floorMm / 2 + 1e-6);
  });
});

describe('cablaggio del BMS', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3, powerHoleMm: 2.85 } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });
  const h = buildHarness(p, strips, 0.1)!;

  it('un filo per nodo, da B0 a BS', () => {
    expect(h.wires.map((w) => w.label)).toEqual(['B0', 'B1', 'B2', 'B3', 'B4']);
    // B0 è il meno del pacco: la lamella P−
    expect(strips.find((s) => s.id === h.wires[0]!.stripId)!.kind).toBe('terminal-minus');
    expect(strips.find((s) => s.id === h.wires[4]!.stripId)!.kind).toBe('terminal-plus');
  });

  it('nessun filo attraversa da una piastra all’altra: corre in una corsia fuori dalla scatola', () => {
    const top = h.box!.center.y + h.box!.size.y / 2;
    const bottom = h.box!.center.y - h.box!.size.y / 2;
    for (const w of h.wires) {
      const lane = w.points[1]!;
      if (w.face === 'top') expect(lane.y).toBeGreaterThan(top);
      else expect(lane.y).toBeLessThan(bottom);
      expect(w.points[0]!.y > lane.y).toBe(w.face === 'top');
    }
  });

  it('niente passa sotto il BMS: né i fili né i cavi entrano nel volume della scatola', () => {
    const b = h.box!;
    const inside = (q: { x: number; y: number; z: number }, m: number) =>
      Math.abs(q.x - b.center.x) < b.size.x / 2 + m - 1e-6 && Math.abs(q.y - b.center.y) < b.size.y / 2 + m - 1e-6 && Math.abs(q.z - b.center.z) < b.size.z / 2 + m - 1e-6;
    const paths = [...h.wires.map((w) => w.points), ...h.cables.map((c) => c.points)];
    for (const pts of paths) {
      for (let i = 0; i + 1 < pts.length; i++) {
        for (let k = 0; k <= 40; k++) {
          const t = k / 40;
          const q = { x: pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t, y: pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t, z: pts[i]!.z + (pts[i + 1]!.z - pts[i]!.z) * t };
          expect(inside(q, -0.01)).toBe(false);
        }
      }
    }
  });

  it('i fili partono da giunzioni sulle due facce e le lunghezze sono ragionevoli', () => {
    expect(new Set(h.wires.map((w) => w.face)).size).toBe(2);
    for (const w of h.wires) {
      expect(w.lengthMm).toBeGreaterThan(20);
      expect(w.lengthMm).toBeLessThan(150);
      expect(w.cutMm).toBeGreaterThanOrEqual(w.lengthMm + h.mount.slackMm - 1e-6);
      expect(w.cutMm % 5).toBe(0);
    }
  });

  it('i contatti del connettore sono su una testata, in colonna e a passo fisso', () => {
    const ys = h.wires.map((w) => w.points[w.points.length - 1]!.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeCloseTo(2.5, 6);
    const pin = h.wires[0]!.points[h.wires[0]!.points.length - 1]!;
    // la testata è quella opposta ai cavi di potenza (alta di default): il connettore sta dal lato basso
    expect(pin.x).toBeLessThan(h.box!.center.x - h.box!.size.x / 2);
    expect(h.header.center.x).toBeLessThan(h.box!.center.x - h.box!.size.x / 2);
  });

  it('la posizione lungo il lato sposta il connettore; esterno aggiunge la coda e toglie la scatola', () => {
    const left = buildHarness(setBmsMount(p, { along: 0 }), strips, 0.1)!;
    const right = buildHarness(setBmsMount(p, { along: 1 }), strips, 0.1)!;
    expect(right.connector.x).toBeGreaterThan(left.connector.x + 50);
    expect(h.box).not.toBeNull();
    const ext = buildHarness(setBmsMount(p, { mode: 'external', tailMm: 100 }), strips, 0.1)!;
    expect(ext.box).toBeNull();
    expect(ext.wires[0]!.cutMm).toBeGreaterThanOrEqual(ext.wires[0]!.lengthMm + h.mount.slackMm + 100);
  });

  it('senza BMS o senza linguette non c’è cablaggio', () => {
    expect(buildHarness(pack(4, 3), buildStrips(pack(4, 3), { tabs }), 0.1)).toBeNull();
    expect(buildHarness(p, buildStrips(p, {}), 0.1)).toBeNull();
  });

  it('setBmsMount tiene i valori nei limiti', () => {
    expect(setBmsMount(p, { along: 3, slackMm: -5 }).bmsMount).toMatchObject({ along: 1, slackMm: 0 });
  });
});

describe('linguette dei terminali: potenza e bilanciamento separate', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, powerHoleMm: 2.85 } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });
  const terminals = strips.filter((x) => x.tab && x.kind !== 'series');
  const series = strips.filter((x) => x.tab && x.kind === 'series');

  it('i terminali hanno due linguette, le lamelle in serie una', () => {
    expect(terminals.length).toBe(2);
    for (const s of terminals) {
      expect(tabsOf(s)).toHaveLength(2);
      expect(s.tab!.power).toBe(true);
      expect(s.balanceTab!.power).toBe(false);
      expect(s.tab!.balanceHole).toBeUndefined();
      expect(s.balanceTab!.balanceHole!.diameterMm).toBeCloseTo(1.21, 6);
      expect(s.tab!.holeDiameterMm).toBeCloseTo(2.85, 6);
    }
    for (const s of series) {
      expect(tabsOf(s)).toHaveLength(1);
      expect(s.tab!.balanceHole!.diameterMm).toBeCloseTo(1.21, 6);
    }
  });

  it('il bilanciamento esce dal lato scelto con gli altri, la potenza di lato', () => {
    for (const s of terminals) expect(s.balanceTab!.side).toBe('top');
    for (const s of series) expect(s.tab!.side).toBe('top');
    const plus = terminals.find((s) => s.kind === 'terminal-plus')!;
    const minus = terminals.find((s) => s.kind === 'terminal-minus')!;
    // P+ è la colonna a sinistra, P− quella a destra: la potenza esce dal bordo laterale più vicino
    expect(plus.tab!.side).toBe('left');
    expect(minus.tab!.side).toBe('right');
    // la potenza non parte dalla cella del bilanciamento
    for (const s of terminals) expect(Math.hypot(s.tab!.anchor.x - s.balanceTab!.anchor.x, s.tab!.anchor.y - s.balanceTab!.anchor.y)).toBeGreaterThan(5);
  });

  it('la linguetta di bilanciamento del terminale ha la stessa larghezza delle altre', () => {
    for (const s of terminals) expect(s.balanceTab!.widthMm).toBeCloseTo(series[0]!.tab!.widthMm, 6);
  });

  it('nessuna linguetta è intralciata', () => {
    expect(strips.every((s) => tabsOf(s).every((x) => x.blockedBy === null))).toBe(true);
  });

  it('ogni foro è un buco della lamella', () => {
    const plain = buildStrips(p, {});
    for (const s of terminals) expect(s.holes.length).toBe(plain.find((x) => x.id === s.id)!.holes.length + 2);
    for (const s of series) expect(s.holes.length).toBe(plain.find((x) => x.id === s.id)!.holes.length + 1);
  });

  it('i fili di bilanciamento partono tutti dal lato scelto: stesso percorso a tre punti', () => {
    const h = buildHarness(p, strips, 0.1)!;
    for (const w of h.wires) expect(w.points).toHaveLength(5);
    const first = h.wires[0]!;
    const s0 = strips.find((x) => x.id === first.stripId)!;
    const bend = s0.balanceTab!.bend;
    expect(first.points[0]!.x).toBeCloseTo((bend[0].x + bend[1].x) / 2, 6);
  });

  it('una scanalatura per linguetta: i terminali ne hanno due', () => {
    const notches = tabNotches(strips, DEFAULT_HOLDER_SETTINGS, { balanceAwg: 26, powerAwg: 12 });
    expect(notches).toHaveLength(7);
    for (const s of terminals) expect(notches.filter((n) => n.stripId === s.id)).toHaveLength(2);
  });
});

describe('cavi di potenza (BMS a porta comune)', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, powerHoleMm: 2.85 } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });
  const h = buildHarness(p, strips, 0.1)!;
  const cable = (l: string) => h.cables.find((c) => c.label === l)!;

  it('tre cavi: P+ dritto, B− nel BMS, P− dal BMS, con il diametro dell’AWG scelto', () => {
    expect(h.cables.map((c) => c.label).sort()).toEqual(['B−', 'P+', 'P−']);
    for (const c of h.cables) expect(c.odMm).toBeCloseTo(3.6, 6);
    expect(buildHarness(p, strips, 0.1, { balanceAwg: 26, powerAwg: 8 })!.cables[0]!.odMm).toBeCloseTo(6, 6);
    // il negativo del pacco parte dalla lamella di P−, il positivo da quella di P+
    expect(strips.find((x) => x.id === cable('P+').stripId)!.kind).toBe('terminal-plus');
    expect(strips.find((x) => x.id === cable('B−').stripId)!.kind).toBe('terminal-minus');
  });

  it('il negativo entra nel BMS: B− finisce all’estremità del BMS e P− riparte da lì', () => {
    const bIn = cable('B−');
    const pOut = cable('P−');
    const end = bIn.points[bIn.points.length - 1]!;
    expect(end.x).toBeCloseTo(h.box!.center.x + h.box!.size.x / 2, 6); // estremità alta del BMS (default)
    expect(bIn.points[bIn.points.length - 2]!.y).toBeCloseTo(end.y, 6); // entra orizzontale nel pad, dopo essere sceso
    expect(pOut.points[0]!.x).toBeCloseTo(end.x, 6);
    expect(pOut.points[0]!.z).toBeCloseTo(end.z, 6);
    expect(pOut.points[0]!.y).toBeLessThan(end.y); // P− sta sotto B−
  });

  it('P+ passa davanti al BMS senza entrarci e prosegue nella coda insieme a P−', () => {
    const plus = cable('P+');
    const pOut = cable('P−');
    const e = plus.points[plus.tailFrom]!;
    expect(e.x).toBeGreaterThan(cable('B−').points[cable('B−').points.length - 1]!.x); // scende più in fuori di B−
    const tailP = plus.points[plus.points.length - 1]!;
    const tailM = pOut.points[pOut.points.length - 1]!;
    expect(tailP.x).toBeCloseTo(tailM.x, 6);
    expect(tailP.x - e.x).toBeCloseTo(150, 6);
    expect(plus.points[plus.tailFrom]!.y).toBeGreaterThan(pOut.points[0]!.y); // P+ sopra P−
  });

  it('i cavi partono dal bordo laterale e arrivano al lato di uscita', () => {
    for (const c of [cable('P+'), cable('B−')]) {
      const first = c.points[0]!;
      const end = c.points[c.tailFrom]!;
      expect(first.z).toBeGreaterThan(end.z + 15); // il lato di uscita è l'alto del disegno
    }
  });

  it('con le estremità a sinistra tutto si sposta dall’altra parte', () => {
    const left = buildHarness(setBmsMount(p, { cablesEnd: 'low' }), strips, 0.1)!;
    const c = left.cables.find((x) => x.label === 'P+')!;
    expect(c.points[c.tailFrom]!.x).toBeLessThan(left.box!.center.x);
    expect(c.points[c.points.length - 1]!.x).toBeLessThan(c.points[c.tailFrom]!.x - 100);
  });

  it('scorta e arrotondamento: la lunghezza da tagliare è percorso più scorta, a multipli di 5 mm', () => {
    for (const c of h.cables) {
      expect(c.cutMm).toBeGreaterThanOrEqual(c.lengthMm + h.mount.slackMm - 1e-6);
      expect(c.cutMm).toBeLessThan(c.lengthMm + h.mount.slackMm + 5 + 1e-6);
      expect(c.cutMm % 5).toBe(0);
    }
  });

  it('il connettore sta in fondo alla coda, lontano dal pacco, e dipende dalla scelta', () => {
    expect(h.connectors).toHaveLength(1);
    expect(h.connectors[0]!.kind).toBe('xt60');
    expect(h.connectors[0]!.cable).toBe('P±');
    const tail = cable('P+').points[cable('P+').points.length - 1]!;
    expect(h.connectors[0]!.center.x).toBeGreaterThan(tail.x);
    expect(buildHarness(setBmsMount(p, { powerConnector: 'none' }), strips, 0.1)!.connectors).toHaveLength(0);
    const bullet = buildHarness(setBmsMount(p, { powerConnector: 'bullet' }), strips, 0.1)!;
    expect(bullet.connectors).toHaveLength(2);
    expect(bullet.connectors.every((k) => k.shape === 'cylinder')).toBe(true);
  });
});
