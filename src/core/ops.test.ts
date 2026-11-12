import { describe, expect, it } from 'vitest';
import {
  addCell,
  addCustomCellType,
  flipPolarity,
  moveCells,
  paintGroup,
  removeCells,
  removeCustomCellType,
  setGroup,
  updateCustomCellType,
} from './ops';
import { createProject } from './project';

const T = '21700-5000-10a';

describe('ops', () => {
  it('addCell does not modify the original project', () => {
    const p = createProject();
    const q = addCell(p, { typeId: T, x: 1, y: 2 });
    expect(p.cells).toHaveLength(0);
    expect(q.cells).toHaveLength(1);
    expect(q.cells[0]).toMatchObject({ x: 1, y: 2, plusUp: true, group: null });
  });

  it('moveCells moves only the chosen cells', () => {
    let p = createProject();
    p = addCell(p, { typeId: T, x: 0, y: 0, id: 'a' });
    p = addCell(p, { typeId: T, x: 10, y: 10, id: 'b' });
    const q = moveCells(p, ['a'], 5, -3);
    expect(q.cells.find((c) => c.id === 'a')).toMatchObject({ x: 5, y: -3 });
    expect(q.cells.find((c) => c.id === 'b')).toMatchObject({ x: 10, y: 10 });
  });

  it('returns the same object when nothing changes', () => {
    let p = createProject();
    p = addCell(p, { typeId: T, x: 0, y: 0, id: 'a' });
    expect(moveCells(p, ['a'], 0, 0)).toBe(p);
    expect(moveCells(p, ['nope'], 1, 1)).toBe(p);
    expect(removeCells(p, ['nope'])).toBe(p);
    expect(setGroup(p, ['a'], null)).toBe(p);
  });

  it('flipPolarity inverts and reverts', () => {
    let p = createProject();
    p = addCell(p, { typeId: T, x: 0, y: 0, id: 'a' });
    const q = flipPolarity(p, ['a']);
    expect(q.cells[0]!.plusUp).toBe(false);
    expect(flipPolarity(q, ['a']).cells[0]!.plusUp).toBe(true);
  });

  it('removeCells deletes the chosen cells', () => {
    let p = createProject();
    p = addCell(p, { typeId: T, x: 0, y: 0, id: 'a' });
    p = addCell(p, { typeId: T, x: 9, y: 0, id: 'b' });
    expect(removeCells(p, ['a']).cells.map((c) => c.id)).toEqual(['b']);
  });

  it('addCustomCellType rejects duplicate ids', () => {
    const type = {
      id: 'mia',
      name: 'Mia',
      chemistry: 'li-ion' as const,
      diameterMm: 18,
      heightMm: 65,
      nominalV: 3.6,
      maxV: 4.2,
      minV: 3,
      capacityAh: 2,
      maxDischargeA: 5,
      weightG: 40,
    };
    const p = addCustomCellType(createProject(), type);
    expect(() => addCustomCellType(p, type)).toThrow();
  });

  it('paintGroup assigns the group and, if requested, alternates the polarity', () => {
    let p = createProject();
    p = addCell(p, { typeId: T, x: 0, y: 0, id: 'a' });
    p = addCell(p, { typeId: T, x: 9, y: 0, id: 'b' });
    const plain = paintGroup(p, ['a'], 1);
    expect(plain.cells[0]).toMatchObject({ group: 1, plusUp: true });
    const alt = paintGroup(p, ['a', 'b'], 1, { alternatePolarity: true });
    expect(alt.cells.map((c) => [c.group, c.plusUp])).toEqual([[1, false], [1, false]]);
    expect(paintGroup(alt, ['a'], 1, { alternatePolarity: true })).toBe(alt); // niente da cambiare
  });

  describe('custom types', () => {
    const type = {
      id: 'mia',
      name: 'Mia',
      chemistry: 'li-ion' as const,
      diameterMm: 18,
      heightMm: 65,
      nominalV: 3.6,
      maxV: 4.2,
      minV: 3,
      capacityAh: 2,
      maxDischargeA: 5,
      weightG: 40,
    };

    it('updateCustomCellType replaces the one with the same id and rejects unknown ones', () => {
      const p = addCustomCellType(createProject(), type);
      const q = updateCustomCellType(p, { ...type, priceEur: 3.5 });
      expect(q.customCellTypes[0]!.priceEur).toBe(3.5);
      expect(() => updateCustomCellType(createProject(), type)).toThrow();
    });

    it('removeCustomCellType deletes an unused type and rejects one in use', () => {
      let p = addCustomCellType(createProject(), type);
      expect(removeCustomCellType(p, 'mia').customCellTypes).toHaveLength(0);
      expect(removeCustomCellType(p, 'inesistente')).toBe(p);
      p = addCell(p, { typeId: 'mia', x: 0, y: 0 });
      expect(() => removeCustomCellType(p, 'mia')).toThrow(/usato da 1 celle/);
    });
  });
});
