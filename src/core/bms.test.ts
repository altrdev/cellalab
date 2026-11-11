import { describe, expect, it } from 'vitest';
import { allBmsTypes, bmsFromDraft, bmsOf, BUILTIN_BMS_TYPES, validateBms } from './bms';
import { runDrc } from './drc';
import { generateGrid } from './layout';
import { addCustomBms, removeCustomBms, replaceCells, setBms, setCurrentLimit } from './ops';
import { createProject, parseProject, serializeProject } from './project';
import { computeStats } from './stats';
import { buildDxf } from './dxf';
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
    const type = bmsFromDraft(createProject(), { name: 'Mio 6S', minSeries: 6, maxSeries: 6, maxCurrentA: 25, chemistry: 'li-ion', ntc: false });
    let p = setBms(addCustomBms(createProject(), type), type.id);
    expect(allBmsTypes(p)[0]!.id).toBe(type.id);
    expect(() => addCustomBms(p, type)).toThrow();
    p = removeCustomBms(p, type.id);
    expect(p.bmsId).toBeUndefined();
    expect(p.customBmsTypes).toBeUndefined();
  });

  it('validateBms', () => {
    expect(validateBms({ name: '', minSeries: 5, maxSeries: 3, maxCurrentA: 0, chemistry: 'li-ion', ntc: true })).toHaveLength(3);
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
    const type = bmsFromDraft(createProject(), { name: 'Mio', minSeries: 4, maxSeries: 8, maxCurrentA: 20, chemistry: 'lifepo4', ntc: true });
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
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 2.5 } as const;
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
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 2, bendMm: 2.5 } as const;
  const strips = buildStrips(setBms(pack(4, 2), 'bms-4s-30a-li-ion'), { tabs });

  it('sta sulla linguetta, tra la cella e il foro', () => {
    for (const s of strips.filter((x) => x.tab)) {
      const [a, b] = s.tab!.bend;
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.y).toBeGreaterThan(s.tab!.holeY); // y verso il basso: la piega è più vicina alla cella del foro
      expect(Math.abs(a.x - b.x)).toBeCloseTo(6, 6);
    }
  });

  it('finisce in SVG e DXF', () => {
    expect(buildSvg(strips, { face: 'top', kerfMm: 0, includeContacts: false })).toContain('stroke-dasharray="1.5 0.8"');
    const dxf = buildDxf(strips, { face: 'all', kerfMm: 0, includeContacts: false, includeLabels: false });
    expect(dxf).toMatch(/\n0\r?\nLINE\r?\n/);
  });
});
