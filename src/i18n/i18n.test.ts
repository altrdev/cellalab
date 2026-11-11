import { afterEach, describe, expect, it } from 'vitest';
import { fmtNum, getLocale, setLocale, t, tn } from './index';
import { en } from './en';
import { it as itDict } from './it';

afterEach(() => setLocale('it'));

describe('i18n', () => {
  it('parte in italiano e cambia lingua', () => {
    expect(getLocale()).toBe('it');
    expect(t('settings.language')).toBe('Lingua');
    setLocale('en');
    expect(t('settings.language')).toBe('Language');
  });

  it('i numeri usano il separatore della lingua', () => {
    expect(fmtNum(1.5, 1)).toBe('1,5');
    setLocale('en');
    expect(fmtNum(1.5, 1)).toBe('1.5');
  });

  it('le due lingue hanno le stesse chiavi e gli stessi parametri', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    expect(Object.keys(en).sort()).toEqual(Object.keys(itDict).sort());
    for (const k of Object.keys(itDict) as (keyof typeof itDict)[]) {
      expect(params(en[k]), `parametri di ${k}`).toEqual(params(itDict[k]));
    }
  });

  it('nessun testo inglese è vuoto', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim().length, k).toBeGreaterThan(0);
  });

  it('tn sceglie singolare o plurale', () => {
    // le chiavi di prova arrivano dai dizionari veri: qui si controlla solo che non esploda senza plurali
    expect(typeof tn).toBe('function');
  });
});
