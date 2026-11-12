import { fmtNum, getLocale } from './i18n';
import { CURRENCIES, getPrefs } from './prefs';

/**
 * Conversioni e formati secondo le preferenze (`prefs.ts`). Il progetto è sempre in mm, °C, g ed euro:
 * qui si convertono solo i valori da mostrare e quelli che l'utente scrive.
 */

const MM_PER_IN = 25.4;
const G_PER_OZ = 28.349523125;
const G_PER_LB = 453.59237;
const CM2_PER_IN2 = 6.4516;

// ---- Lunghezze

export const lenLabel = (): string => (getPrefs().length === 'in' ? 'in' : 'mm');
/** mm → unità scelta. */
export const toLen = (mm: number): number => (getPrefs().length === 'in' ? mm / MM_PER_IN : mm);
/** Unità scelta → mm. */
export const fromLen = (v: number): number => (getPrefs().length === 'in' ? v * MM_PER_IN : v);
/** Decimali da mostrare: in pollici ne servono due in più che in mm. */
export const lenDigits = (dMm: number): number => (getPrefs().length === 'in' ? dMm + 2 : dMm);
/** Il numero, senza unità, con il separatore della lingua. */
export const lenNum = (mm: number, d = 1): string => fmtNum(toLen(mm), lenDigits(d));
/** «12,3 mm» o «0,484 in». */
export const len = (mm: number, d = 1): string => `${lenNum(mm, d)} ${lenLabel()}`;
/** Area: cm² → in². */
export const areaLabel = (): string => (getPrefs().length === 'in' ? 'in²' : 'cm²');
export const area = (cm2: number, d = 1): string => `${fmtNum(getPrefs().length === 'in' ? cm2 / CM2_PER_IN2 : cm2, d)} ${areaLabel()}`;

// ---- Temperatura

export const tempLabel = (): string => (getPrefs().temp === 'F' ? '°F' : '°C');
/** °C assoluti → unità scelta. */
export const toTemp = (c: number): number => (getPrefs().temp === 'F' ? (c * 9) / 5 + 32 : c);
export const fromTemp = (v: number): number => (getPrefs().temp === 'F' ? ((v - 32) * 5) / 9 : v);
/** Differenze di temperatura (K = °C): in °F si moltiplica per 1,8 senza scarto. */
export const toTempDelta = (k: number): number => (getPrefs().temp === 'F' ? k * 1.8 : k);
export const fromTempDelta = (v: number): number => (getPrefs().temp === 'F' ? v / 1.8 : v);
export const temp = (c: number, d = 0): string => `${fmtNum(toTemp(c), d)} ${tempLabel()}`;
/** «+25 °C» come differenza. */
export const tempDelta = (k: number, d = 0): string => `${fmtNum(toTempDelta(k), d)} ${tempLabel()}`;

// ---- Peso

/** Peso piccolo (plastica, lamelle): g oppure oz. */
export const massSmall = (g: number, d = 0): string =>
  getPrefs().weight === 'imperial' ? `${fmtNum(g / G_PER_OZ, Math.max(d, 1))} oz` : `${fmtNum(g, d)} g`;
/** g → unità del peso piccolo (g oppure oz) e ritorno: per i campi in cui si scrive un peso. */
export const toMassSmall = (g: number): number => (getPrefs().weight === 'imperial' ? g / G_PER_OZ : g);
export const fromMassSmall = (v: number): number => (getPrefs().weight === 'imperial' ? v * G_PER_OZ : v);
/** Peso grande (pacco di celle): kg oppure lb. */
export const mass = (g: number, d = 2): string =>
  getPrefs().weight === 'imperial' ? `${fmtNum(g / G_PER_LB, d)} lb` : `${fmtNum(g / 1000, d)} kg`;

// ---- Valuta (i prezzi del catalogo sono in euro)

export const toMoney = (eur: number): number => eur * getPrefs().rate;
export const fromMoney = (v: number): number => v / getPrefs().rate;
/** «12,34 €» (euro, in italiano) oppure «$12.34». */
export function money(eur: number, d = 2): string {
  const p = getPrefs();
  const n = fmtNum(eur * p.rate, d);
  return p.currency === 'EUR' && getLocale() === 'it' ? `${n} €` : `${CURRENCIES[p.currency].symbol}${n}`;
}
