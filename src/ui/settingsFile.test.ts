import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { DEFAULT_LAMELLA_SETTINGS } from '../core/lamelle';
import { createProject, parseProject, parseProjectSettings, serializeProject } from '../core/project';
import { sanitizeHolderSettings } from './holder';
import { sanitizeLamellaSettings } from './lamelle';

describe('impostazioni nel file del progetto', () => {
  it('lamelle e portacelle fanno il giro salvataggio → lettura', () => {
    const lamella = { ...DEFAULT_LAMELLA_SETTINGS, thicknessMm: 0.3, layers: 2 };
    const holder = { ...DEFAULT_HOLDER_SETTINGS, wallMm: 2.4, shape: 'rounded' as const };
    const json = serializeProject(createProject(), { lamella, holder });
    const saved = parseProjectSettings(json);
    expect(sanitizeLamellaSettings(saved.lamella)).toEqual(lamella);
    expect(sanitizeHolderSettings(saved.holder)).toEqual(holder);
  });

  it('senza impostazioni il file è identico a prima e si legge ancora', () => {
    const json = serializeProject(createProject());
    expect(json).not.toContain('settings');
    expect(parseProjectSettings(json)).toEqual({});
    expect(parseProject(json)).toEqual(createProject());
  });

  it('un file con impostazioni resta un progetto valido', () => {
    const json = serializeProject(createProject(), { lamella: DEFAULT_LAMELLA_SETTINGS });
    expect(parseProject(json)).toEqual(createProject());
  });

  it('valori sbagliati o fuori scala tornano al default o ai limiti', () => {
    const l = sanitizeLamellaSettings({ thicknessMm: -2, layers: 99, cooling: 'boh', currentA: 'x' });
    expect(l.thicknessMm).toBeNull();
    expect(l.layers).toBe(5);
    expect(l.cooling).toBe(DEFAULT_LAMELLA_SETTINGS.cooling);
    expect(l.currentA).toBeNull();
    const h = sanitizeHolderSettings({ wallMm: 999, shape: 'strano', lockCells: 'sì' });
    expect(h.wallMm).toBeLessThanOrEqual(6);
    expect(h.shape).toBe(DEFAULT_HOLDER_SETTINGS.shape);
    expect(h.lockCells).toBe(DEFAULT_HOLDER_SETTINGS.lockCells);
  });

  it('dati non oggetto danno i default', () => {
    expect(sanitizeLamellaSettings(null)).toEqual(DEFAULT_LAMELLA_SETTINGS);
    expect(sanitizeHolderSettings([1, 2])).toEqual(DEFAULT_HOLDER_SETTINGS);
    expect(parseProjectSettings('non json')).toEqual({});
  });
});
