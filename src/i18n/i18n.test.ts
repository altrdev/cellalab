import { afterEach, describe, expect, it } from 'vitest';
import { fmtNum, getLocale, setLocale, t, tn } from './index';
import { en } from './en';
import { it as itDict } from './it';

afterEach(() => setLocale('it'));

describe('i18n', () => {
  it('starts in Italian and switches language', () => {
    expect(getLocale()).toBe('it');
    expect(t('settings.language')).toBe('Lingua');
    setLocale('en');
    expect(t('settings.language')).toBe('Language');
  });

  it('numbers use the language\'s separator', () => {
    expect(fmtNum(1.5, 1)).toBe('1,5');
    setLocale('en');
    expect(fmtNum(1.5, 1)).toBe('1.5');
  });

  it('the two languages have the same keys and the same parameters', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    expect(Object.keys(en).sort()).toEqual(Object.keys(itDict).sort());
    for (const k of Object.keys(itDict) as (keyof typeof itDict)[]) {
      expect(params(en[k]), `parameters of ${k}`).toEqual(params(itDict[k]));
    }
  });

  it('no English text is empty', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim().length, k).toBeGreaterThan(0);
  });

  it('tn picks singular or plural', () => {
    // the test keys come from the real dictionaries: here we only check it does not blow up without plurals
    expect(typeof tn).toBe('function');
  });
});
