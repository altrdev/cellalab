import { describe, expect, it } from 'vitest';
import { addCell } from './ops';
import { createProject, parseProject, ProjectParseError, serializeProject } from './project';

const T = '21700-5000-10a';

describe('JSON saving', () => {
  it('serialises and reads back without losing anything', () => {
    let p = createProject('Prova');
    p = addCell(p, { typeId: T, x: 1.5, y: 2.5, plusUp: false, group: 2, id: 'a' });
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it.each([
    ['broken json', '{non json'],
    ['root is not an object', '[]'],
    ['unknown version', JSON.stringify({ version: 9, name: 'x', customCellTypes: [], cells: [] })],
    [
      'cell with non-numeric coordinates',
      JSON.stringify({
        version: 1,
        name: 'x',
        customCellTypes: [],
        cells: [{ id: 'a', typeId: T, x: 'uno', y: 0, plusUp: true, group: null }],
      }),
    ],
    [
      'negative group',
      JSON.stringify({
        version: 1,
        name: 'x',
        customCellTypes: [],
        cells: [{ id: 'a', typeId: T, x: 0, y: 0, plusUp: true, group: -1 }],
      }),
    ],
    [
      'unknown cell type',
      JSON.stringify({
        version: 1,
        name: 'x',
        customCellTypes: [],
        cells: [{ id: 'a', typeId: 'inesistente', x: 0, y: 0, plusUp: true, group: null }],
      }),
    ],
    [
      'duplicate ids',
      JSON.stringify({
        version: 1,
        name: 'x',
        customCellTypes: [],
        cells: [
          { id: 'a', typeId: T, x: 0, y: 0, plusUp: true, group: null },
          { id: 'a', typeId: T, x: 9, y: 0, plusUp: true, group: null },
        ],
      }),
    ],
  ])('rejects: %s', (_name, json) => {
    expect(() => parseProject(json)).toThrow(ProjectParseError);
  });

  it('ignores unknown keys, even dangerous ones', () => {
    const json =
      '{"version":1,"name":"x","customCellTypes":[],"cells":[],"__proto__":{"hack":true},"extra":1}';
    const p = parseProject(json);
    expect(Object.keys(p).sort()).toEqual(['cells', 'customCellTypes', 'name', 'version']);
    expect(({} as Record<string, unknown>).hack).toBeUndefined();
  });
});


describe('generation recipe', () => {
  const recipe = { series: 3, parallel: 2, kind: 'hex', gapMm: 1, pitchMm: 22.4, typeId: '21700-5000-10a' } as const;
  const base = () => {
    const p = createProject();
    return { ...p, cells: [{ id: 'a', typeId: '21700-5000-10a', x: 0, y: 0, plusUp: true, group: 0 }] };
  };

  it('is saved and read back', () => {
    const p = { ...base(), generator: recipe };
    expect(parseProject(serializeProject(p)).generator).toEqual(recipe);
  });

  it('if malformed it is ignored without rejecting the project', () => {
    const raw = JSON.parse(serializeProject({ ...base(), generator: recipe })) as Record<string, unknown>;
    raw.generator = { ...recipe, kind: 'triangolare' };
    expect(parseProject(JSON.stringify(raw)).generator).toBeUndefined();
  });

  it('with no cells it is not kept', () => {
    const raw = JSON.parse(serializeProject({ ...createProject(), generator: recipe })) as Record<string, unknown>;
    expect(parseProject(JSON.stringify(raw)).generator).toBeUndefined();
  });
});

describe('current limit', () => {
  it('is saved and read back; invalid values are ignored', () => {
    const p = { ...createProject(), currentLimitA: 25 };
    expect(parseProject(serializeProject(p)).currentLimitA).toBe(25);
    const raw = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    raw.currentLimitA = -3;
    expect(parseProject(JSON.stringify(raw)).currentLimitA).toBeUndefined();
    raw.currentLimitA = 'molto';
    expect(parseProject(JSON.stringify(raw)).currentLimitA).toBeUndefined();
  });
});
