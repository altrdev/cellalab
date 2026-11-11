import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from './i18n';
import { resetPrefsForTests, sanitizePrefs, setPrefs } from './prefs';
import { area, fromLen, fromMoney, fromTemp, fromTempDelta, len, lenLabel, lenNum, mass, massSmall, money, temp, tempDelta, toLen, toMoney, toTemp } from './units';
import { t } from './i18n';

afterEach(() => {
  resetPrefsForTests();
  setLocale('it');
});

// le preferenze si cambiano senza toccare il browser: setPrefs scrive solo se c'è localStorage
const use = (patch: Parameters<typeof setPrefs>[0]) => setPrefs(patch);

describe('lunghezze', () => {
  it('in mm non cambia nulla', () => {
    expect(toLen(25.4)).toBe(25.4);
    expect(len(12.34, 1)).toBe('12,3 mm');
    expect(lenLabel()).toBe('mm');
  });
  it('in pollici converte, con due decimali in più, e torna indietro', () => {
    use({ length: 'in' });
    expect(toLen(25.4)).toBeCloseTo(1, 9);
    expect(len(25.4, 1)).toBe('1,000 in');
    expect(len(1.5, 1)).toBe('0,059 in');
    expect(lenNum(105, 0)).toBe('4,13');
    expect(fromLen(toLen(37.3))).toBeCloseTo(37.3, 9);
  });
  it('il separatore segue la lingua', () => {
    use({ length: 'in' });
    setLocale('en');
    expect(len(1.5, 1)).toBe('0.059 in');
  });
  it("l'area passa da cm² a in²", () => {
    expect(area(6.4516, 1)).toBe('6,5 cm²');
    use({ length: 'in' });
    expect(area(6.4516, 1)).toBe('1,0 in²');
  });
});

describe('temperatura', () => {
  it('assoluta: °C ↔ °F', () => {
    use({ temp: 'F' });
    expect(toTemp(25)).toBeCloseTo(77, 9);
    expect(fromTemp(77)).toBeCloseTo(25, 9);
    expect(temp(25)).toBe('77 °F');
  });
  it('differenze: solo il fattore 1,8, senza scarto', () => {
    use({ temp: 'F' });
    expect(tempDelta(25)).toBe('45 °F');
    expect(fromTempDelta(45)).toBeCloseTo(25, 9);
  });
});

describe('peso', () => {
  it('metrico: g e kg', () => {
    expect(massSmall(12.4, 0)).toBe('12 g');
    expect(mass(830)).toBe('0,83 kg');
  });
  it('imperiale: oz e lb', () => {
    use({ weight: 'imperial' });
    expect(massSmall(28.349523125, 1)).toBe('1,0 oz');
    expect(mass(453.59237)).toBe('1,00 lb');
  });
});

describe('valuta', () => {
  it('euro in italiano: numero e simbolo dopo; in inglese il simbolo prima', () => {
    expect(money(12.5)).toBe('12,50 €');
    setLocale('en');
    expect(money(12.5)).toBe('€12.50');
  });
  it('con un altro cambio converte e torna indietro', () => {
    use({ currency: 'USD', rate: 1.2 });
    expect(toMoney(10)).toBeCloseTo(12, 9);
    expect(fromMoney(12)).toBeCloseTo(10, 9);
    expect(money(10)).toBe('$12,00');
  });
  it('cambiando valuta il cambio riparte dal valore di partenza', () => {
    use({ currency: 'USD', rate: 1.2 });
    use({ currency: 'GBP' });
    expect(money(1)).toBe('£0,85');
    use({ currency: 'EUR' });
    expect(money(1)).toBe('1,00 €');
  });
});

describe('etichette dei campi', () => {
  it('«(mm)», «(°C)», «(g)» e «(€/…)» seguono le preferenze', () => {
    expect(t('side.gap')).toContain('(mm)');
    use({ length: 'in', temp: 'F', weight: 'imperial', currency: 'USD' });
    expect(t('side.gap')).toContain('(in)');
    expect(t('lam.ambient')).toContain('(°F)');
    expect(t('side.draft.weight')).toContain('(oz)');
    expect(t('side.draft.price')).toContain('($/');
  });
});

describe('preferenze', () => {
  it('dati sbagliati tornano ai valori di partenza', () => {
    expect(sanitizePrefs({ length: 'cubit', temp: 5, currency: 'XXX', rate: -3 })).toEqual({ length: 'mm', temp: 'C', weight: 'metric', currency: 'EUR', rate: 1 });
    expect(sanitizePrefs({ currency: 'USD', rate: 'x' }).rate).toBeCloseTo(1.1, 9);
  });
});
