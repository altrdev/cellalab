import { afterEach, describe, expect, it } from 'vitest';
import { analyzeLamelle, DEFAULT_LAMELLA_SETTINGS } from '../core/busbar';
import { buildCutSummary } from '../core/busbarExport';
import { runDrc } from '../core/drc';
import { buildHolder, analyzeHolder, DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { generateGrid } from '../core/layout';
import { replaceCells } from '../core/ops';
import { createProject, parseProject } from '../core/project';
import { buildStrips } from '../core/strips';
import { findMaterial } from '../core/materials';
import { BUILTIN_CELL_TYPES } from '../core/catalog';
import { drc, history } from '../state';
import { reportOf } from '../ui/busbar';
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

describe('messages in English', () => {
  it('the pack checks', () => {
    const p = pack(3, 2, 0);
    setLocale('en');
    const messages = runDrc(p).map((i) => i.message);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join(' ')).toMatch(/overlap|cells/i);
    expect(messages.join(' ')).not.toMatch(/celle|coppie/i);
  });

  it('the strip checks: insufficient thickness and welder', () => {
    const p = pack(4, 3);
    const strips = buildStrips(p);
    setLocale('en');
    const r = analyzeLamelle(p, strips, { ...DEFAULT_LAMELLA_SETTINGS, thicknessMm: 0.1 }, 90);
    const text = r.issues.map((i) => i.message).join(' ');
    expect(text).toMatch(/Thickness|thickness/);
    expect(text).not.toMatch(/Spessore|lamella/);
    // decimals use the dot
    expect(text).toMatch(/\d\.\d/);
    expect(r.alternatives.join(' ')).toMatch(/Two-level structure/);
  });

  it('materials, welders and cooling follow the language', () => {
    expect(findMaterial('nichel-puro')!.name).toBe('Nichel puro (Ni 99,6%)');
    setLocale('en');
    expect(findMaterial('nichel-puro')!.name).toBe('Pure nickel (Ni 99.6%)');
    expect(findMaterial('nichel-puro')!.note).toMatch(/reference for spot welding/);
    expect(BUILTIN_CELL_TYPES[0]!.name).toMatch(/\(energy\)/);
  });

  it('the holder checks', () => {
    const p = pack(3, 2, 0.1);
    setLocale('en');
    const h = buildHolder(p, DEFAULT_HOLDER_SETTINGS, false)!;
    const text = analyzeHolder(p, h).issues.map((i) => i.text).join(' ');
    expect(text).toMatch(/PETG, ASA or ABS/);
    expect(text).not.toMatch(/Stampa/);
  });

  it('cut summary, file read errors and default name', () => {
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

describe('messages with the chosen units', () => {
  it('strips: thicknesses in inches and temperature jumps in °F', () => {
    const p = pack(4, 3);
    const strips = buildStrips(p);
    setPrefs({ length: 'in', temp: 'F' });
    const r = analyzeLamelle(p, strips, { ...DEFAULT_LAMELLA_SETTINGS, thicknessMm: 0.1 }, 90);
    const text = r.issues.map((i) => i.message).join(' ');
    expect(text).toMatch(/\d,\d+ in\b/);
    expect(text).toMatch(/°F/);
    expect(text).not.toMatch(/\bmm\b|°C|\bK\b/);
  });

  it('holder: print bed and material in the chosen units', () => {
    const p = pack(3, 2, 0.1);
    setPrefs({ length: 'in', temp: 'F' });
    const h = buildHolder(p, { ...DEFAULT_HOLDER_SETTINGS, bedXMm: 50, bedYMm: 50 }, false)!;
    const text = analyzeHolder(p, h).issues.map((i) => i.text).join(' ');
    expect(text).toMatch(/[\d,]+×[\d,]+ in/);
    expect(text).toMatch(/140 °F/); // 60 °C
    expect(text).not.toMatch(/\bmm\b|°C/);
  });

  it('pack checks: the minimum space in inches', () => {
    const p = pack(3, 2, 0.3);
    setPrefs({ length: 'in' });
    const text = runDrc(p).map((i) => i.message).join(' ');
    expect(text).toMatch(/in di spazio/);
    expect(text).not.toMatch(/\bmm\b/);
  });
});

describe('language change with the interface open', () => {
  it('the cached strip report is recomputed in the new language', () => {
    const p = pack(4, 3);
    const settings = { ...DEFAULT_LAMELLA_SETTINGS, layers: 5 }; // more layers than the welder can weld
    const itText = reportOf(p, settings).issues.map((i) => i.message).join(' ');
    expect(itText).toMatch(/strati/);
    setLocale('en');
    const enText = reportOf(p, settings).issues.map((i) => i.message).join(' ');
    expect(enText).toMatch(/layers/);
    expect(enText).not.toMatch(/strati/);
  });

  it('the checks store emits the texts again in the new language', () => {
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

describe('dictionaries', () => {
  // all the sources (not the tests nor the dictionaries) as text
  const files = import.meta.glob(['../**/*.ts', '../**/*.svelte', '!../**/*.test.ts', '!../i18n/**', '!../**/*.d.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const code = Object.values(files).join('\n');

  it('every key is used somewhere in the code', () => {
    const unused = Object.keys(itDict).filter((k) => {
      const base = k.replace(/_(one|other)$/, '');
      return !code.includes(`'${k}'`) && !code.includes(`'${base}'`) && !code.includes(`"${k}"`) && !code.includes(`\`${k}\``);
    });
    expect(unused).toEqual([]);
  });

  it('no text has fixed units: values arrive already with their unit', () => {
    // intended exceptions: the test piece engraving is in hundredths of a mm, the settings notes talk about mm and kg
    const allowed = new Set(['exp.testHelp', 'settings.weightMetric', 'settings.rate', 'settings.exportNote']);
    const strip = (v: string) => v.replace('(mm)', '').replace('(°C)', '').replace('(g)', '').replace('(€/', '(');
    for (const dict of [itDict, en] as Record<string, string>[]) {
      for (const [k, v] of Object.entries(dict)) {
        if (allowed.has(k)) continue;
        expect(strip(v), k).not.toMatch(/\bmm\b|°[CF]|\bK\b|cm²|cm2|\bkg\b|€/);
      }
    }
  });

  it('the English texts contain no Italian accented letters', () => {
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/[àèéìòù]/);
  });
});
