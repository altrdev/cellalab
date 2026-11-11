import { afterEach, describe, expect, it } from 'vitest';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS } from '../core/lamelle';
import { buildCutSummary } from '../core/lamelleExport';
import { runDrc } from '../core/drc';
import { buildHolder, analyzeHolder, DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { generateGrid } from '../core/layout';
import { replaceCells } from '../core/ops';
import { createProject, parseProject } from '../core/project';
import { buildStrips } from '../core/strips';
import { findMaterial } from '../core/materials';
import { BUILTIN_CELL_TYPES } from '../core/catalog';
import { drc, history } from '../state';
import { reportOf } from '../ui/lamelle';
import { en } from './en';
import { it as itDict } from './it';
import { setLocale } from './index';
import { resetPrefsForTests, setPrefs } from '../prefs';

afterEach(() => {
  setLocale('it');
  resetPrefsForTests();
});

const pack = (series: number, parallel: number, gapMm = 1) =>
  replaceCells(createProject(), generateGrid({ typeId: '21700-5000-10a', diameterMm: 21.4, series, parallel, kind: 'hex', gapMm }));

describe('messaggi in inglese', () => {
  it('le verifiche sul pacco', () => {
    const p = pack(3, 2, 0);
    setLocale('en');
    const messages = runDrc(p).map((i) => i.message);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join(' ')).toMatch(/overlap|cells/i);
    expect(messages.join(' ')).not.toMatch(/celle|coppie/i);
  });

  it('le verifiche sulle lamelle: spessore insufficiente e saldatrice', () => {
    const p = pack(4, 3);
    const strips = buildStrips(p);
    setLocale('en');
    const r = analyzeLamelle(p, strips, { ...DEFAULT_LAMELLA_SETTINGS, thicknessMm: 0.1 }, 90);
    const text = r.issues.map((i) => i.message).join(' ');
    expect(text).toMatch(/Thickness|thickness/);
    expect(text).not.toMatch(/Spessore|lamella/);
    // i decimali usano il punto
    expect(text).toMatch(/\d\.\d/);
    expect(r.alternatives.join(' ')).toMatch(/Two-level structure/);
  });

  it('materiali, saldatrici e raffreddamento seguono la lingua', () => {
    expect(findMaterial('nichel-puro')!.name).toBe('Nichel puro (Ni 99,6%)');
    setLocale('en');
    expect(findMaterial('nichel-puro')!.name).toBe('Pure nickel (Ni 99.6%)');
    expect(findMaterial('nichel-puro')!.note).toMatch(/reference for spot welding/);
    expect(BUILTIN_CELL_TYPES[0]!.name).toMatch(/\(energy\)/);
  });

  it('le verifiche sul portacelle', () => {
    const p = pack(3, 2, 0.1);
    setLocale('en');
    const h = buildHolder(p, DEFAULT_HOLDER_SETTINGS, false)!;
    const text = analyzeHolder(p, h).issues.map((i) => i.text).join(' ');
    expect(text).toMatch(/PETG, ASA or ABS/);
    expect(text).not.toMatch(/Stampa/);
  });

  it('riepilogo di taglio, errori di lettura del file e nome predefinito', () => {
    const p = pack(4, 3);
    const strips = buildStrips(p);
    const report = analyzeLamelle(p, strips, DEFAULT_LAMELLA_SETTINGS, 30);
    setLocale('en');
    const summary = buildCutSummary(report, 'My pack');
    expect(summary).toMatch(/Busbars - My pack/);
    expect(summary).toMatch(/Material: Pure nickel/);
    expect(() => parseProject('not json')).toThrow(/not valid JSON/);
    expect(createProject().name).toBe('New pack');
  });
});

describe('messaggi con le unità scelte', () => {
  it('lamelle: spessori in pollici e salti di temperatura in °F', () => {
    const p = pack(4, 3);
    const strips = buildStrips(p);
    setPrefs({ length: 'in', temp: 'F' });
    const r = analyzeLamelle(p, strips, { ...DEFAULT_LAMELLA_SETTINGS, thicknessMm: 0.1 }, 90);
    const text = r.issues.map((i) => i.message).join(' ');
    expect(text).toMatch(/\d,\d+ in\b/);
    expect(text).toMatch(/°F/);
    expect(text).not.toMatch(/\bmm\b|°C|\bK\b/);
  });

  it('portacelle: piano di stampa e materiale nelle unità scelte', () => {
    const p = pack(3, 2, 0.1);
    setPrefs({ length: 'in', temp: 'F' });
    const h = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, bedXMm: 50, bedYMm: 50 }, false)!;
    const text = analyzeHolder(p, h).issues.map((i) => i.text).join(' ');
    expect(text).toMatch(/[\d,]+×[\d,]+ in/);
    expect(text).toMatch(/140 °F/); // 60 °C
    expect(text).not.toMatch(/\bmm\b|°C/);
  });

  it('verifiche sul pacco: lo spazio minimo in pollici', () => {
    const p = pack(3, 2, 0.3);
    setPrefs({ length: 'in' });
    const text = runDrc(p).map((i) => i.message).join(' ');
    expect(text).toMatch(/in di spazio/);
    expect(text).not.toMatch(/\bmm\b/);
  });
});

describe('cambio lingua a interfaccia aperta', () => {
  it('il rapporto delle lamelle in cache si ricalcola nella nuova lingua', () => {
    const p = pack(4, 3);
    const settings = { ...DEFAULT_LAMELLA_SETTINGS, layers: 5 }; // più strati di quanti ne salda la saldatrice
    const itText = reportOf(p, settings).issues.map((i) => i.message).join(' ');
    expect(itText).toMatch(/strati/);
    setLocale('en');
    const enText = reportOf(p, settings).issues.map((i) => i.message).join(' ');
    expect(enText).toMatch(/layers/);
    expect(enText).not.toMatch(/strati/);
  });

  it('lo store delle verifiche emette di nuovo i testi nella nuova lingua', () => {
    history.reset(pack(3, 2, 0));
    const seen: string[] = [];
    const unsubscribe = drc.subscribe((issues) => seen.push(issues.map((i) => i.message).join(' | ')));
    const before = seen[seen.length - 1]!;
    expect(before).toMatch(/celle|coppie|gruppo/i);
    setLocale('en');
    const after = seen[seen.length - 1]!;
    expect(after).not.toBe(before);
    expect(after).toMatch(/cells|groups|overlap/i);
    unsubscribe();
    history.reset(createProject());
  });
});

describe('dizionari', () => {
  // tutti i sorgenti (non i test e non i dizionari) come testo
  const files = import.meta.glob(['../**/*.ts', '../**/*.svelte', '!../**/*.test.ts', '!../i18n/**', '!../**/*.d.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const code = Object.values(files).join('\n');

  it('ogni chiave è usata da qualche parte nel codice', () => {
    const unused = Object.keys(itDict).filter((k) => {
      const base = k.replace(/_(one|other)$/, '');
      return !code.includes(`'${k}'`) && !code.includes(`'${base}'`) && !code.includes(`"${k}"`) && !code.includes(`\`${k}\``);
    });
    expect(unused).toEqual([]);
  });

  it('nessun testo ha unità fisse: i valori arrivano già con la loro unità', () => {
    // eccezioni volute: l'incisione del pezzo test è in centesimi di mm, le note sulle impostazioni parlano di mm e kg
    const allowed = new Set(['exp.testHelp', 'settings.weightMetric', 'settings.rate', 'settings.exportNote']);
    const strip = (v: string) => v.replace('(mm)', '').replace('(°C)', '').replace('(g)', '').replace('(€/', '(');
    for (const dict of [itDict, en] as Record<string, string>[]) {
      for (const [k, v] of Object.entries(dict)) {
        if (allowed.has(k)) continue;
        expect(strip(v), k).not.toMatch(/\bmm\b|°[CF]|\bK\b|cm²|cm2|\bkg\b|€/);
      }
    }
  });

  it('i testi inglesi non contengono lettere accentate italiane', () => {
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/[àèéìòù]/);
  });
});
