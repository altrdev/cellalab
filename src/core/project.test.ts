import { describe, expect, it } from 'vitest';
import { addCell } from './ops';
import { createProject, parseProject, ProjectParseError, serializeProject } from './project';

const T = '21700-5000-10a';

describe('salvataggio JSON', () => {
  it('serializza e rilegge senza perdere nulla', () => {
    let p = createProject('Prova');
    p = addCell(p, { typeId: T, x: 1.5, y: 2.5, plusUp: false, group: 2, id: 'a' });
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  it.each([
    ['json rotto', '{non json'],
    ['radice non oggetto', '[]'],
    ['versione sconosciuta', JSON.stringify({ version: 9, name: 'x', customCellTypes: [], cells: [] })],
    [
      'cella con coordinate non numeriche',
      JSON.stringify({
        version: 1,
        name: 'x',
        customCellTypes: [],
        cells: [{ id: 'a', typeId: T, x: 'uno', y: 0, plusUp: true, group: null }],
      }),
    ],
    [
      'gruppo negativo',
      JSON.stringify({
        version: 1,
        name: 'x',
        customCellTypes: [],
        cells: [{ id: 'a', typeId: T, x: 0, y: 0, plusUp: true, group: -1 }],
      }),
    ],
    [
      'tipo di cella sconosciuto',
      JSON.stringify({
        version: 1,
        name: 'x',
        customCellTypes: [],
        cells: [{ id: 'a', typeId: 'inesistente', x: 0, y: 0, plusUp: true, group: null }],
      }),
    ],
    [
      'id duplicati',
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
  ])('rifiuta: %s', (_nome, json) => {
    expect(() => parseProject(json)).toThrow(ProjectParseError);
  });

  it('ignora chiavi sconosciute, anche pericolose', () => {
    const json =
      '{"version":1,"name":"x","customCellTypes":[],"cells":[],"__proto__":{"hack":true},"extra":1}';
    const p = parseProject(json);
    expect(Object.keys(p).sort()).toEqual(['cells', 'customCellTypes', 'name', 'version']);
    expect(({} as Record<string, unknown>).hack).toBeUndefined();
  });
});


describe('ricetta di generazione', () => {
  const recipe = { series: 3, parallel: 2, kind: 'hex', gapMm: 1, pitchMm: 22.4, typeId: '21700-5000-10a' } as const;
  const base = () => {
    const p = createProject();
    return { ...p, cells: [{ id: 'a', typeId: '21700-5000-10a', x: 0, y: 0, plusUp: true, group: 0 }] };
  };

  it('si salva e si rilegge', () => {
    const p = { ...base(), generator: recipe };
    expect(parseProject(serializeProject(p)).generator).toEqual(recipe);
  });

  it('se è malformata si ignora senza rifiutare il progetto', () => {
    const raw = JSON.parse(serializeProject({ ...base(), generator: recipe })) as Record<string, unknown>;
    raw.generator = { ...recipe, kind: 'triangolare' };
    expect(parseProject(JSON.stringify(raw)).generator).toBeUndefined();
  });

  it('senza celle non si tiene', () => {
    const raw = JSON.parse(serializeProject({ ...createProject(), generator: recipe })) as Record<string, unknown>;
    expect(parseProject(JSON.stringify(raw)).generator).toBeUndefined();
  });
});

describe('limite di corrente', () => {
  it('si salva e si rilegge; valori non validi si ignorano', () => {
    const p = { ...createProject(), currentLimitA: 25 };
    expect(parseProject(serializeProject(p)).currentLimitA).toBe(25);
    const raw = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    raw.currentLimitA = -3;
    expect(parseProject(JSON.stringify(raw)).currentLimitA).toBeUndefined();
    raw.currentLimitA = 'molto';
    expect(parseProject(JSON.stringify(raw)).currentLimitA).toBeUndefined();
  });
});
