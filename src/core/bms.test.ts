import { describe, expect, it } from 'vitest';
import { allBmsTypes, bmsFromDraft, bmsOf, BUILTIN_BMS_TYPES, validateBms } from './bms';
import { runDrc } from './drc';
import { generateGrid } from './layout';
import { addCustomBms, removeCustomBms, replaceCells, setBms, setBmsMount, setCurrentLimit } from './ops';
import { createProject, parseProject, serializeProject } from './project';
import { computeStats } from './stats';
import { intersectRegions, pointInRegions, regionArea, unionPolygons } from './clip';
import { circlePoints } from './polygon';
import { buildDxf } from './dxf';
import { buildHolder, DEFAULT_HOLDER_SETTINGS } from './holder';
import { buildHarness } from './harness';
import { findAroundExits, findWireExits, findWireRoutes } from './wireExit';
import { ntcSite, ntcSites } from './ntc';
import { tabNotches } from './tabNotches';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS, stripOptionsOf } from './lamelle';
import { holeForWireMm, powerAmpacityA, powerAwgFor } from './wire';
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

describe('NTC in una griglia quadrata', () => {
  const sq = (s: number, pp: number) =>
    setBms(replaceCells(createProject(), generateGrid({ typeId: T, diameterMm: 21.4, series: s, parallel: pp, kind: 'square', gapMm: 1.5 })), 'bms-4s-30a-li-ion');

  it('usa il vuoto tra quattro celle, già aperto, e non scava nulla', () => {
    const p = sq(4, 3);
    const site = ntcSite(p, 'top', 5, 0.15)!;
    expect(site).not.toBeNull();
    expect(site.open).toBe(true);
    // il centro è equidistante da quattro celle
    const ds = p.cells.map((c) => Math.hypot(c.x - site.x, c.y - site.y)).sort((a, b) => a - b);
    expect(ds[3]! - ds[0]!).toBeLessThan(1e-6);
  });

  it('con la sagoma arrotondata il vuoto è riempito e il foro toglie materiale; con quella a profilo no', () => {
    const p = sq(4, 3);
    const site = ntcSite(p, 'top', 5, 0.15)!;
    const volume = (m: { layers: { z0: number; z1: number; regions: Parameters<typeof regionArea>[0][] }[] }) =>
      m.layers.reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    const removed = (shape: 'profile' | 'rounded') => {
      const st = { ...DEFAULT_HOLDER_SETTINGS, shape };
      return volume(buildHolder(p, st, true)!) - volume(buildHolder(p, st, true, { extraPockets: [site.polygon], throughHoles: [site.wirePolygon] })!);
    };
    expect(removed('rounded')).toBeGreaterThan(10);
    expect(removed('profile')).toBeLessThan(1e-6);
  });

  it('con celle esagonali resta il vuoto tra tre celle', () => {
    expect(ntcSite(pack(4, 3), 'top', 5, 0.15)!.open).toBe(false);
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
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3 } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });
  const h = buildHarness(p, strips, 0.1)!;

  it('un filo per nodo, da B0 a BS', () => {
    expect(h.wires.map((w) => w.label)).toEqual(['B0', 'B1', 'B2', 'B3', 'B4']);
    // B0 è il meno del pacco: la lamella P−
    expect(strips.find((s) => s.id === h.wires[0]!.stripId)!.kind).toBe('terminal-minus');
    expect(strips.find((s) => s.id === h.wires[4]!.stripId)!.kind).toBe('terminal-plus');
  });

  it('nessun filo attraversa da una piastra all’altra: scende (o sale) fino al bordo della scatola e arriva a metà altezza', () => {
    const half = h.box!.size.y / 2;
    for (const w of h.wires) {
      const foot = w.points[1]!;
      expect(w.points[w.points.length - 1]!.y).toBeCloseTo(35.2, 6); // metà dell'altezza delle celle (70,4)
      expect(Math.abs(foot.y - 35.2)).toBeGreaterThan(half); // il piede sta fuori dalla scatola
      expect(foot.y > 35.2).toBe(w.face === 'top');
      expect(w.points[0]!.y > foot.y).toBe(w.face === 'top');
    }
  });

  it('nessun filo ne tocca un altro: ogni percorso ha la sua corsia, e dove si incrociano passano a profondità diverse', () => {
    const DIAMETER = 0.9; // filo 26 AWG con la guaina, un po' abbondante
    const sample = (pts: { x: number; y: number; z: number }[]) => {
      const out: { x: number; y: number; z: number }[] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
        for (let t = 0; t <= steps; t++) out.push({ x: a.x + ((b.x - a.x) * t) / steps, y: a.y + ((b.y - a.y) * t) / steps, z: a.z + ((b.z - a.z) * t) / steps });
      }
      return out;
    };
    for (const connector of ['top', 'end'] as const) {
      for (const connectorEnd of ['start', 'end'] as const) {
        const e = buildHarness(setBmsMount(p, { connector, connectorEnd }), strips, 0.1)!;
        const paths = e.wires.map((w) => sample(w.points));
        let closest = Infinity;
        for (let i = 0; i < paths.length; i++) {
          for (let j = i + 1; j < paths.length; j++) {
            for (const a of paths[i]!) for (const b of paths[j]!) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
          }
        }
        expect(closest).toBeGreaterThanOrEqual(DIAMETER - 1e-6);
      }
    }
  });

  it('in testa la scatola sta oltre un’estremità del fianco e i fili arrivano lungo il fianco senza toccarsi', () => {
    const perp = { x: 1, z: 0 }; // lato 'top': il fianco corre lungo X
    const cells = p.cells;
    const xs = cells.map((c) => c.x);
    const pMin = Math.min(...xs) - 10.7;
    const pMax = Math.max(...xs) + 10.7;
    for (const end of ['start', 'end'] as const) {
      const e = buildHarness(setBmsMount(p, { place: 'head', connectorEnd: end }), strips, 0.1)!;
      const box = e.box!;
      const half = box.size.x / 2;
      if (end === 'end') expect(box.center.x - half).toBeGreaterThan(pMax - 1e-6);
      else expect(box.center.x + half).toBeLessThan(pMin + 1e-6);
      expect(perp.x).toBe(1);
      // i pad stanno sulla faccia esterna e sulla parte della scatola verso il pacco
      for (const w of e.wires) {
        const pin = w.points[w.points.length - 1]!;
        expect(Math.abs(pin.x - box.center.x)).toBeLessThan(half);
        expect(end === 'end' ? pin.x < box.center.x : pin.x > box.center.x).toBe(true);
      }
      // nessun filo dentro la scatola e nessuno a meno di un diametro da un altro
      const sample = (pts: { x: number; y: number; z: number }[]) => {
        const out: { x: number; y: number; z: number }[] = [];
        for (let k = 0; k + 1 < pts.length; k++) {
          const a = pts[k]!;
          const b = pts[k + 1]!;
          const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
          for (let t = 0; t <= steps; t++) out.push({ x: a.x + ((b.x - a.x) * t) / steps, y: a.y + ((b.y - a.y) * t) / steps, z: a.z + ((b.z - a.z) * t) / steps });
        }
        return out;
      };
      const paths = e.wires.map((w) => sample(w.points));
      let closest = Infinity;
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) for (const a of paths[i]!) for (const b of paths[j]!) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      expect(closest).toBeGreaterThanOrEqual(0.9 - 1e-6);
      for (const path of paths) for (const q of path) {
        const inside = Math.abs(q.x - box.center.x) < half - 1e-6 && Math.abs(q.y - box.center.y) < box.size.y / 2 - 1e-6 && Math.abs(q.z - box.center.z) < box.size.z / 2 - 1e-6;
        expect(inside).toBe(false);
      }
    }
  });

  it('le corsie sono ordinate per distanza dal BMS: nessuna discesa dalla linguetta incrocia la corsia di un altro', () => {
    for (const end of ['start', 'end'] as const) {
      const e = buildHarness(setBmsMount(p, { place: 'head', connectorEnd: end }), strips, 0.1)!;
      for (const a of e.wires) {
        for (const b of e.wires) {
          if (a === b || a.face !== b.face) continue;
          // discesa di a: x fisso (foro), y da p0 a piede; corsia di b: y fisso, x da foro di b al pad di b
          const drop = { x: a.points[0]!.x, y0: a.points[0]!.y, y1: a.points[1]!.y };
          const lane = { y: b.points[1]!.y, x0: b.points[0]!.x, x1: b.points[3]!.x };
          const crossesX = drop.x > Math.min(lane.x0, lane.x1) + 1e-6 && drop.x < Math.max(lane.x0, lane.x1) - 1e-6;
          const crossesY = lane.y > Math.min(drop.y0, drop.y1) + 1e-6 && lane.y < Math.max(drop.y0, drop.y1) - 1e-6;
          expect(crossesX && crossesY).toBe(false);
        }
      }
    }
  });

  it('nessun filo entra nel volume della scatola', () => {
    const box = h.box!;
    const inside = (q: { x: number; y: number; z: number }) =>
      Math.abs(q.x - box.center.x) < box.size.x / 2 - 1e-6 && Math.abs(q.y - box.center.y) < box.size.y / 2 - 1e-6 && Math.abs(q.z - box.center.z) < box.size.z / 2 - 1e-6;
    for (const place of ['top', 'end'] as const) {
      for (const end of ['start', 'end'] as const) {
        const e = buildHarness(setBmsMount(p, { connector: place, connectorEnd: end }), strips, 0.1)!;
        for (const w of e.wires) {
          // controlla i segmenti campionati, non solo i vertici
          for (let k = 0; k + 1 < w.points.length; k++) {
            const a = w.points[k]!;
            const b = w.points[k + 1]!;
            for (let t = 0; t <= 1; t += 0.05) expect(inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })).toBe(false);
          }
        }
      }
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
    const xs = h.wires.map((w) => w.points[w.points.length - 1]!.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(2.5, 6);
  });

  it('di default i fili scavalcano il bordo della scatola e arrivano sulla sua faccia superiore', () => {
    const box = h.box!;
    const alongX = box.size.x > box.size.z;
    const c = (v: { x: number; z: number }) => (alongX ? v.x : v.z);
    const o = (v: { x: number; z: number }) => (alongX ? v.z : v.x);
    const halfL = (alongX ? box.size.x : box.size.z) / 2;
    const halfT = (alongX ? box.size.z : box.size.x) / 2;
    const outward = Math.sign(o(box.center) - o(h.wires[0]!.points[0]!));
    for (const w of h.wires) {
      expect(w.points.length).toBe(6);
      const pin = w.points[5]!;
      expect(Math.abs(c(pin) - c(box.center))).toBeLessThan(halfL); // sopra la scheda
      expect(o(pin)).toBeCloseTo(o(box.center) + outward * halfT, 6); // sulla faccia esterna
      expect(Math.abs(pin.y - box.center.y)).toBeLessThan(1e-6);
    }
    const cs = h.wires.map((w) => c(w.points[5]!)).sort((a, b) => a - b);
    for (let k = 1; k < cs.length; k++) expect(cs[k]! - cs[k - 1]!).toBeCloseTo(2.5, 6);
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
        expect(w.points.length).toBe(6);
        expect(o(w.points[5]!)).toBeCloseTo(o(e.connector), 6); // stessa quota del retro della scatola
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

describe('uscita dei fili dal portacelle, senza linguette', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const ROUND = { ...DEFAULT_HOLDER_SETTINGS, shape: 'rounded' as const }; // con la forma arrotondata la plastica tra le celle basta
  const plain = buildHolder(p, ROUND, false)!;
  const strips = buildStrips(p, { tabs: { side: 'bottom', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, style: 'none' } });
  const exits = findWireExits(p, strips, plain.wall, 'bottom', 1.21, plain.totalMm, plain.floorMm);

  it('niente linguette di bilanciamento: ogni giunzione ha il suo foro nel portacelle', () => {
    expect(strips.some((x) => x.tab)).toBe(false);
    expect(exits).toHaveLength(5);
    expect(new Set(exits.map((e) => e.stripId)).size).toBe(5);
  });

  it('il foro non sta in una tasca né sotto una lamella della sua faccia, ed è vicino al punto di saldatura', () => {
    for (const e of exits) {
      for (const hole of plain.wall.flatMap((r) => r.holes)) expect(pointInRegions(e.hole!, [{ outline: hole, holes: [] }])).toBe(false);
      const covering = strips.filter((x) => x.face === e.face).map((x) => ({ outline: x.outline, holes: x.holes }));
      expect(covering.some((c) => pointInRegions(e.hole!, [c]))).toBe(false);
      expect(Math.hypot(e.hole!.x - e.solder.x, e.hole!.y - e.solder.y)).toBeLessThanOrEqual(24);
    }
  });

  it('con uno smusso grande il foro resta in plastica e il contorno non cambia mai (niente rinforzi)', () => {
    for (const chamferMm of [0.6, 2]) {
      const st = { ...ROUND, chamferMm };
      const base = buildHolder(p, st, false)!;
      const ex = findWireExits(p, strips, base.wall, 'bottom', 1.21, base.totalMm, base.floorMm, chamferMm);
      expect(ex.length).toBe(5);
      for (const e of ex) {
        // almeno la parete stampabile attorno al foro, dentro il contorno del portacelle (che resta quello senza fori)
        const r = e.diameterMm / 2 + 0.8 - 0.05;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          expect(pointInRegions({ x: e.hole!.x + Math.cos(a) * r, y: e.hole!.y + Math.sin(a) * r }, base.wall.map((rg) => ({ outline: rg.outline, holes: [] })))).toBe(true);
        }
      }
    }
  });

  it('con il profilo della cella dove la plastica è sottile il giunto fa il giro esterno: nessun filo manca', () => {
    const prof = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, shape: 'profile' }, false)!;
    const routes = findWireRoutes(p, strips, prof.wall, 'bottom', 1.21, prof.totalMm, prof.floorMm, 0.6, 0.3);
    expect(routes).toHaveLength(5);
    expect(routes.every((e) => e.hole || e.edge)).toBe(true);
    expect(new Set(routes.map((e) => e.stripId)).size).toBe(5);
  });

  it('i fori tolgono materiale alla piastra e il filo passa per il foro senza toccare gli altri', () => {
    const holes = exits.map((e) => circlePoints(e.hole!.x, e.hole!.y, e.diameterMm / 2, 16));
    const vol = (m: { layers: { z0: number; z1: number; regions: Parameters<typeof regionArea>[0][] }[] }) =>
      m.layers.reduce((a, l) => a + (l.z1 - l.z0) * l.regions.reduce((b, r) => b + regionArea(r), 0), 0);
    expect(vol(buildHolder(p, ROUND, true)!) - vol(buildHolder(p, ROUND, true, { throughHoles: holes })!)).toBeGreaterThan(0.5);
    // cablaggio: le lamelle portano l'uscita
    for (const e of exits) strips.find((x) => x.id === e.stripId)!.wireExit = e;
    const h = buildHarness(p, strips, 0.1)!;
    expect(h.wires).toHaveLength(5);
    for (const w of h.wires) {
      const ex = exits.find((e) => e.stripId === w.stripId)!;
      expect(w.points[1]!.x).toBeCloseTo(ex.hole!.x, 6); // dal punto di saldatura al foro…
      expect(w.points[2]!.x).toBeCloseTo(ex.hole!.x, 6); // …e attraverso la piastra
      expect(Math.abs(w.points[2]!.y - w.points[1]!.y)).toBeGreaterThanOrEqual(ex.plateMm - 1e-6); // attraversa tutto lo spessore
    }
    const sample = (pts: { x: number; y: number; z: number }[]) => {
      const out: { x: number; y: number; z: number }[] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
        for (let t = 0; t <= steps; t++) out.push({ x: a.x + ((b.x - a.x) * t) / steps, y: a.y + ((b.y - a.y) * t) / steps, z: a.z + ((b.z - a.z) * t) / steps });
      }
      return out;
    };
    const paths = h.wires.map((w) => sample(w.points));
    let closest = Infinity;
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) for (const a of paths[i]!) for (const b of paths[j]!) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    expect(closest).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });
});

describe('giro esterno del portacelle, senza linguette né fori', () => {
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const plain = buildHolder(p, DEFAULT_HOLDER_SETTINGS, false)!;
  const strips = buildStrips(p, { tabs: { side: 'bottom', widthMm: 6, lengthMm: 8, holeMm: 1.21, bendMm: 0.3, style: 'none' } });
  const exits = findAroundExits(p, strips, plain.wall, 'bottom', plain.totalMm, plain.floorMm, 0.3);

  it('ogni giunzione ha il suo punto di saldatura e il bordo da cui il filo scende, senza foro', () => {
    expect(exits).toHaveLength(5);
    for (const e of exits) {
      expect(e.hole).toBeUndefined();
      // lato 'bottom': d = (0, 1): il bordo sta oltre il punto di saldatura
      expect(e.edge!.y).toBeGreaterThan(e.solder.y);
      expect(e.edge!.x).toBeCloseTo(e.solder.x, 6); // in linea retta
      // il punto di saldatura sta sulla lamella
      const st = strips.find((x) => x.id === e.stripId)!;
      expect(pointInRegions(e.solder, [{ outline: st.outline, holes: st.holes }])).toBe(true);
    }
  });

  it('il corridoio è libero nel 4S3P: nessun filo passa sopra un’altra lamella', () => {
    expect(exits.every((e) => !e.blocked)).toBe(true);
  });

  it('i fili partono dal piano, vanno al bordo e scendono; senza toccarsi né entrare nella scatola', () => {
    for (const e of exits) strips.find((x) => x.id === e.stripId)!.wireExit = e;
    const h = buildHarness(p, strips, 0.1)!;
    expect(h.wires).toHaveLength(5);
    for (const w of h.wires) {
      expect(w.points[0]!.y).toBeCloseTo(w.points[1]!.y, 6); // sul piano della lamella fino al bordo
      expect(w.points[2]!.y).not.toBeCloseTo(w.points[1]!.y, 3); // poi scende
    }
    const sample = (pts: { x: number; y: number; z: number }[]) => {
      const out: { x: number; y: number; z: number }[] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.1));
        for (let t = 0; t <= steps; t++) out.push({ x: a.x + ((b.x - a.x) * t) / steps, y: a.y + ((b.y - a.y) * t) / steps, z: a.z + ((b.z - a.z) * t) / steps });
      }
      return out;
    };
    const paths = h.wires.map((w) => sample(w.points));
    let closest = Infinity;
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) for (const a of paths[i]!) for (const b of paths[j]!) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    expect(closest).toBeGreaterThanOrEqual(0.9 - 1e-6);
    const box = h.box!;
    for (const path of paths) for (const q of path) {
      const inside = Math.abs(q.x - box.center.x) < box.size.x / 2 - 1e-6 && Math.abs(q.y - box.center.y) < box.size.y / 2 - 1e-6 && Math.abs(q.z - box.center.z) < box.size.z / 2 - 1e-6;
      expect(inside).toBe(false);
    }
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
