import { describe, expect, it } from 'vitest';
import { addCell, setCurrentLimit } from './ops';
import { createProject } from './project';
import { computeStats } from './stats';
import type { Project } from './types';

/** Costruisce un pacco S×P in 21700 energia (3,6 V, 5 Ah, 10 A, 69 g, Ø21,4). */
function pack(s: number, p: number, typeId = '21700-5000-10a'): Project {
  let proj = createProject();
  for (let g = 0; g < s; g++) {
    for (let k = 0; k < p; k++) {
      proj = addCell(proj, { typeId, x: g * 22, y: k * 22, group: g });
    }
  }
  return proj;
}

describe('computeStats', () => {
  it('progetto vuoto: niente valori elettrici', () => {
    const st = computeStats(createProject());
    expect(st.cellCount).toBe(0);
    expect(st.configLabel).toBeNull();
    expect(st.nominalV).toBeNull();
    expect(st.boundsMm).toBeNull();
    expect(st.costEur).toBeNull();
  });

  it('13S4P: tensione, capacità, energia, corrente, peso', () => {
    const st = computeStats(pack(13, 4));
    expect(st.cellCount).toBe(52);
    expect(st.configLabel).toBe('13S4P');
    expect(st.nominalV).toBeCloseTo(46.8, 6);
    expect(st.maxV).toBeCloseTo(54.6, 6);
    expect(st.minV).toBeCloseTo(32.5, 6);
    expect(st.capacityAh).toBeCloseTo(20, 6);
    expect(st.energyWh).toBeCloseTo(936, 6);
    expect(st.maxCurrentA).toBe(40);
    expect(st.weightG).toBe(52 * 69);
  });

  it('ingombro: bordo esterno delle celle + altezza cella', () => {
    const st = computeStats(pack(2, 2));
    // centri a 0 e 22 mm, raggio 10,7 → 22 + 21,4 = 43,4
    expect(st.boundsMm!.width).toBeCloseTo(43.4, 6);
    expect(st.boundsMm!.depth).toBeCloseTo(43.4, 6);
    expect(st.boundsMm!.height).toBeCloseTo(70.4, 6);
  });

  it('gruppi disuguali: P non definito e capacità = gruppo più debole', () => {
    let p = pack(2, 3);
    p = addCell(p, { typeId: '21700-5000-10a', x: 0, y: 99, group: 0 }); // gruppo 0 ha 4 celle, gruppo 1 ne ha 3
    const st = computeStats(p);
    expect(st.parallel).toBeNull();
    expect(st.configLabel).toBeNull();
    expect(st.capacityAh).toBeCloseTo(15, 6);
    expect(st.maxCurrentA).toBe(30);
  });

  it('celle non assegnate: contate ma escluse dall elettrica', () => {
    let p = pack(2, 2);
    p = addCell(p, { typeId: '21700-5000-10a', x: 0, y: 99 });
    const st = computeStats(p);
    expect(st.cellCount).toBe(5);
    expect(st.ungroupedCount).toBe(1);
    expect(st.configLabel).toBe('2S2P');
  });

  it('indici di gruppo con buchi vengono segnalati', () => {
    let p = createProject();
    p = addCell(p, { typeId: '21700-5000-10a', x: 0, y: 0, group: 0 });
    p = addCell(p, { typeId: '21700-5000-10a', x: 22, y: 0, group: 2 });
    const st = computeStats(p);
    expect(st.groupGaps).toBe(true);
    expect(st.configLabel).toBeNull();
  });

  it('tipi misti nello stesso gruppo vengono segnalati', () => {
    let p = createProject();
    p = addCell(p, { typeId: '21700-5000-10a', x: 0, y: 0, group: 0 });
    p = addCell(p, { typeId: '21700-4000-30a', x: 22, y: 0, group: 0 });
    expect(computeStats(p).mixedTypesInGroup).toBe(true);
  });

  it('LiFePO4: tensione nominale 3,2 V per cella', () => {
    const st = computeStats(pack(4, 1, '26650-lfp-3200'));
    expect(st.nominalV).toBeCloseTo(12.8, 6);
    expect(st.maxV).toBeCloseTo(14.6, 6);
  });

  it('costo: somma se tutte le celle hanno prezzo, altrimenti null', () => {
    const custom: Project = {
      ...createProject(),
      customCellTypes: [
        {
          id: 'x',
          name: 'X',
          chemistry: 'li-ion',
          diameterMm: 18,
          heightMm: 65,
          nominalV: 3.6,
          maxV: 4.2,
          minV: 3,
          capacityAh: 2,
          maxDischargeA: 5,
          weightG: 40,
          priceEur: 3.5,
        },
      ],
    };
    let p = addCell(custom, { typeId: 'x', x: 0, y: 0, group: 0 });
    p = addCell(p, { typeId: 'x', x: 20, y: 0, group: 0 });
    expect(computeStats(p).costEur).toBeCloseTo(7, 6);
    p = addCell(p, { typeId: '21700-5000-10a', x: 40, y: 0, group: 0 }); // senza prezzo
    expect(computeStats(p).costEur).toBeNull();
  });

  it('limite BMS: la corrente del pacco è la più bassa tra celle e limite', () => {
    const base = pack(2, 3); // celle: 3 × 10 A = 30 A
    expect(computeStats(base).maxCurrentA).toBe(30);
    const low = computeStats(setCurrentLimit(base, 15));
    expect(low.maxCurrentA).toBe(15);
    expect(low.cellCurrentA).toBe(30);
    expect(low.limitedByBms).toBe(true);
    const high = computeStats(setCurrentLimit(base, 50));
    expect(high.maxCurrentA).toBe(30);
    expect(high.limitedByBms).toBe(false);
  });

  it('setCurrentLimit: valori non validi tolgono il limite', () => {
    const p = setCurrentLimit(pack(1, 1), 20);
    expect(p.currentLimitA).toBe(20);
    expect(setCurrentLimit(p, undefined).currentLimitA).toBeUndefined();
    expect(setCurrentLimit(p, 0).currentLimitA).toBeUndefined();
    expect(setCurrentLimit(p, NaN).currentLimitA).toBeUndefined();
  });
});
