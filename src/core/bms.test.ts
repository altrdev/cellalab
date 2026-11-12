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
import { tabNotches } from './tabNotches';
import { DEFAULT_LAMELLA_SETTINGS, stripOptionsOf } from './lamelle';
import { holeForWireMm } from './wire';
import { buildSvg } from './lamelleExport';
import { buildStrips } from './strips';
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
      const [a, b] = s.tab!.bend;
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.y).toBeGreaterThan(s.tab!.holeY); // y verso il basso: la piega è più vicina alla cella del foro
      expect(Math.abs(a.x - b.x)).toBeCloseTo(s.tab!.widthMm, 6);
      expect(s.tab!.widthMm).toBeCloseTo(s.kind === 'series' ? 6 : 6.9, 6);
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

  it('una per linguetta, più profonda per il cavo di potenza', () => {
    const notches = tabNotches(buildStrips(p, { tabs }), settings, wires);
    expect(notches).toHaveLength(5);
    const power = notches.filter((n) => n.stripId.endsWith('-0') || n.stripId.endsWith('-4'));
    const series = notches.filter((n) => !power.includes(n));
    expect(Math.max(...series.map((n) => n.depthMm))).toBeLessThan(Math.min(...power.map((n) => n.depthMm)) + 1e-9);
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
    const blocked = strips.filter((s) => s.tab?.blockedBy);
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

  it('nessun filo attraversa da una piastra all’altra: ogni filo arriva a metà altezza', () => {
    for (const w of h.wires) {
      expect(w.points[1]!.y).toBeCloseTo(35.2, 6); // metà dell'altezza delle celle (70,4)
      expect(w.points[w.points.length - 1]!.y).toBeCloseTo(w.points[1]!.y, 6);
      const above = w.points[0]!.y > w.points[1]!.y;
      expect(above).toBe(w.face === 'top');
    }
  });

  it('i fili partono da giunzioni sulle due facce e le lunghezze sono ragionevoli', () => {
    expect(new Set(h.wires.map((w) => w.face)).size).toBe(2);
    for (const w of h.wires) {
      expect(w.lengthMm).toBeGreaterThan(20);
      expect(w.lengthMm).toBeLessThan(120);
      expect(w.cutMm).toBeGreaterThanOrEqual(w.lengthMm + h.mount.slackMm - 1e-6);
      expect(w.cutMm % 5).toBe(0);
    }
  });

  it('i contatti del connettore sono ordinati e a passo fisso', () => {
    const xs = h.wires.map((w) => w.points[w.points.length - 1]!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(2.5, 6);
  });

  it('di default i fili girano attorno alla testata e arrivano sulla faccia superiore della scatola', () => {
    const box = h.box!;
    const alongX = box.size.x > box.size.z;
    const c = (v: { x: number; z: number }) => (alongX ? v.x : v.z);
    const o = (v: { x: number; z: number }) => (alongX ? v.z : v.x);
    const outerFace = o(box.center) + (alongX ? box.size.z : box.size.x) / 2 * Math.sign(o(box.center) - o(h.wires[0]!.points[0]!));
    for (const w of h.wires) {
      expect(w.points.length).toBe(5);
      const pin = w.points[4]!;
      expect(Math.abs(c(pin) - c(box.center))).toBeLessThan((alongX ? box.size.x : box.size.z) / 2); // sopra la scheda
      expect(o(pin)).toBeCloseTo(outerFace, 6);
      const around = w.points[2]!;
      expect(Math.abs(c(around) - c(box.center))).toBeGreaterThan((alongX ? box.size.x : box.size.z) / 2); // oltre la testata
    }
  });

  it('il connettore su una testata sta oltre la scatola, dal lato scelto, e i fili non la attraversano', () => {
    const box = h.box!;
    const alongX = box.size.x > box.size.z;
    const half = (alongX ? box.size.x : box.size.z) / 2;
    const c = (v: { x: number; z: number }) => (alongX ? v.x : v.z);
    const o = (v: { x: number; z: number }) => (alongX ? v.z : v.x);
    for (const end of ['start', 'end'] as const) {
      const e = buildHarness(setBmsMount(p, { connector: 'end', connectorEnd: end }), strips, 0.1)!;
      const off = c(e.connector) - c(box.center);
      expect(Math.abs(off)).toBeGreaterThan(half);
      expect(off < 0).toBe(end === 'start');
      for (const w of e.wires) {
        expect(w.points.length).toBe(3);
        expect(o(w.points[2]!)).toBeCloseTo(o(e.connector), 6); // stessa quota del retro della scatola
      }
    }
  });

  it('la posizione lungo il lato sposta il connettore; esterno aggiunge la coda e toglie la scatola', () => {
    const left = buildHarness(setBmsMount(p, { along: 0 }), strips, 0.1)!;
    const right = buildHarness(setBmsMount(p, { along: 1 }), strips, 0.1)!;
    expect(right.connector.x).toBeGreaterThan(left.connector.x + 50);
    expect(h.box).not.toBeNull();
    const ext = buildHarness(setBmsMount(p, { mode: 'external', tailMm: 100 }), strips, 0.1)!;
    expect(ext.box).toBeNull();
    expect(ext.wires[0]!.cutMm).toBeGreaterThanOrEqual(ext.wires[0]!.lengthMm + ext.mount.slackMm + 100 - 1e-6); // la coda esterna
  });

  it('senza BMS o senza linguette non c’è cablaggio', () => {
    expect(buildHarness(pack(4, 3), buildStrips(pack(4, 3), { tabs }), 0.1)).toBeNull();
    expect(buildHarness(p, buildStrips(p, {}), 0.1)).toBeNull();
  });

  it('setBmsMount tiene i valori nei limiti', () => {
    expect(setBmsMount(p, { along: 3, slackMm: -5 }).bmsMount).toMatchObject({ along: 1, slackMm: 0 });
  });
});

describe('fori sulle linguette dei terminali', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, powerHoleMm: 2.85 } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });

  it('i terminali hanno due fori: bilanciamento vicino alla piega, potenza più in fuori', () => {
    const plain = buildStrips(p, {});
    for (const s of strips.filter((x) => x.tab)) {
      const base = plain.find((x) => x.id === s.id)!.holes.length;
      const bh = s.tab!.balanceHole;
      if (s.kind === 'series') {
        expect(s.holes.length).toBe(base + 1);
        expect(bh.x).toBeCloseTo(s.tab!.holeX, 6);
        expect(bh.diameterMm).toBeCloseTo(1.21, 6);
      } else {
        expect(s.holes.length).toBe(base + 2);
        expect(s.tab!.holeDiameterMm).toBeCloseTo(2.85, 6);
        expect(bh.diameterMm).toBeCloseTo(1.21, 6);
        // il foro piccolo sta più vicino alla piega (verso l'alto del disegno, y minore, il foro grande più in fuori)
        expect(Math.hypot(bh.x - s.tab!.holeX, bh.y - s.tab!.holeY)).toBeGreaterThan((1.21 + 2.85) / 2);
        const bend = s.tab!.bend;
        const dist = (x: number, y: number) => Math.hypot(x - (bend[0].x + bend[1].x) / 2, y - (bend[0].y + bend[1].y) / 2);
        expect(dist(bh.x, bh.y)).toBeLessThan(dist(s.tab!.holeX, s.tab!.holeY));
      }
    }
  });

  it('la linguetta del terminale è lunga abbastanza per i due fori', () => {
    for (const s of strips.filter((x) => x.tab && x.kind !== 'series')) {
      const bend = s.tab!.bend;
      const mid = { x: (bend[0].x + bend[1].x) / 2, y: (bend[0].y + bend[1].y) / 2 };
      const far = Math.hypot(s.tab!.holeX - mid.x, s.tab!.holeY - mid.y) + s.tab!.holeDiameterMm / 2;
      expect(far).toBeLessThanOrEqual(Math.max(...s.tab!.rect.map((q) => Math.hypot(q.x - mid.x, q.y - mid.y))) + 1e-6);
    }
  });

  it('il filo di bilanciamento di B0 e BS parte dall’altezza del foro piccolo, non da quella del cavo', () => {
    const h = buildHarness(p, strips, 0.1)!;
    for (const w of [h.wires[0]!, h.wires[h.wires.length - 1]!]) {
      const s = strips.find((x) => x.id === w.stripId)!;
      const bend = s.tab!.bend;
      const midY = (bend[0].y + bend[1].y) / 2;
      const uBal = midY - s.tab!.balanceHole.y; // lato alto del disegno: la linguetta esce verso y minore
      const uPow = midY - s.tab!.holeY;
      expect(uPow).toBeGreaterThan(uBal);
      const expected = w.face === 'top' ? 70.4 + 1.1 + 0.1 - uBal : -1.1 - 0.1 + uBal;
      expect(w.points[0]!.y).toBeCloseTo(expected, 6);
    }
  });
});
