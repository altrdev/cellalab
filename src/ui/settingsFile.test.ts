import { describe, expect, it } from 'vitest';
import { DEFAULT_HOLDER_SETTINGS } from '../core/holder';
import { DEFAULT_LAMELLA_SETTINGS } from '../core/busbar';
import { createProject, parseProject, parseProjectSettings, serializeProject } from '../core/project';
import { sanitizeHolderSettings } from './holder';
import { sanitizeLamellaSettings } from './busbarSettings';

describe('settings in the project file', () => {
  it('strips and holder go through a save → read round trip', () => {
    const lamella = { ...DEFAULT_LAMELLA_SETTINGS, thicknessMm: 0.3, layers: 2 };
    const holder = { ...DEFAULT_HOLDER_SETTINGS, wallMm: 2.4, shape: 'rounded' as const };
    const json = serializeProject(createProject(), { lamella, holder });
    const saved = parseProjectSettings(json);
    expect(sanitizeLamellaSettings(saved.lamella)).toEqual(lamella);
    expect(sanitizeHolderSettings(saved.holder)).toEqual(holder);
  });

  it('without settings the file is identical to before and still reads', () => {
    const json = serializeProject(createProject());
    expect(json).not.toContain('settings');
    expect(parseProjectSettings(json)).toEqual({});
    expect(parseProject(json)).toEqual(createProject());
  });

  it('a file with settings stays a valid project', () => {
    const json = serializeProject(createProject(), { lamella: DEFAULT_LAMELLA_SETTINGS });
    expect(parseProject(json)).toEqual(createProject());
  });

  it('wrong or out-of-range values go back to the default or the limits', () => {
    const l = sanitizeLamellaSettings({ thicknessMm: -2, layers: 99, cooling: 'boh', currentA: 'x' });
    expect(l.thicknessMm).toBeNull();
    expect(l.layers).toBe(5);
    expect(l.cooling).toBe(DEFAULT_LAMELLA_SETTINGS.cooling);
    expect(sanitizeLamellaSettings({ spotsPerTerminal: 99 }).spotsPerTerminal).toBe(12);
    expect(sanitizeLamellaSettings({ spotsPerTerminal: 'x' }).spotsPerTerminal).toBeNull();
    expect(sanitizeLamellaSettings({ spotsPerTerminal: 3.6, spotCurrentA: -1 })).toMatchObject({ spotsPerTerminal: 4, spotCurrentA: null });
    // the old currentA field no longer exists: a file or saved state that contains it ignores it
    expect('currentA' in l).toBe(false);
    const h = sanitizeHolderSettings({ wallMm: 999, shape: 'strano', lockCells: 'sì' });
    expect(h.wallMm).toBeLessThanOrEqual(6);
    expect(h.shape).toBe(DEFAULT_HOLDER_SETTINGS.shape);
    expect(h.lockCells).toBe(DEFAULT_HOLDER_SETTINGS.lockCells);
  });

  it('non-object data give the defaults', () => {
    expect(sanitizeLamellaSettings(null)).toEqual(DEFAULT_LAMELLA_SETTINGS);
    expect(sanitizeHolderSettings([1, 2])).toEqual(DEFAULT_HOLDER_SETTINGS);
    expect(parseProjectSettings('non json')).toEqual({});
  });
});
