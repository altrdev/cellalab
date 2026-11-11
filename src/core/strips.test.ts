import { describe, expect, it } from 'vitest';
import { generateGrid } from './layout';
import { alternateGroupPolarity, replaceCells } from './ops';
import { regionDistance } from './clip';
import { createProject } from './project';
import { buildStrips, contactRadiusMm, neckWidthMm, poleOnFace } from './strips';

const D = 21.4;

function pack(series: number, parallel: number, kind: 'hex' | 'square' = 'hex') {
  const cells = generateGrid({ typeId: '21700-5000-10a', diameterMm: D, series, parallel, kind, gapMm: 1 });
  return replaceCells(createProject(), cells);
}

describe('poleOnFace', () => {
  it('polo + in alto: + sopra e − sotto; capovolta il contrario', () => {
    expect(poleOnFace({ plusUp: true }, 'top')).toBe('+');
    expect(poleOnFace({ plusUp: true }, 'bottom')).toBe('-');
    expect(poleOnFace({ plusUp: false }, 'top')).toBe('-');
    expect(poleOnFace({ plusUp: false }, 'bottom')).toBe('+');
  });
});

describe('contactRadiusMm', () => {
  it('+ = bottone (≈41% del raggio); − = fondo meno il bordo', () => {
    expect(contactRadiusMm(21.4, '+')).toBeCloseTo(0.41 * 10.7, 9);
    expect(contactRadiusMm(21.4, '-')).toBeCloseTo(10.7 - 1.5, 9);
  });
});

describe('buildStrips', () => {
  it('senza gruppi non genera nulla', () => {
    const p = createProject();
    expect(buildStrips(p)).toEqual([]);
    const ungrouped = { ...pack(2, 1), cells: pack(2, 1).cells.map((c) => ({ ...c, group: null })) };
    expect(buildStrips(ungrouped)).toEqual([]);
  });

  it('2S1P con polarità alternate: terminali + e − in alto, collegamento in serie sotto', () => {
    const strips = buildStrips(pack(2, 1));
    const top = strips.filter((s) => s.face === 'top').map((s) => s.kind);
    const bottom = strips.filter((s) => s.face === 'bottom').map((s) => s.kind);
    expect(top).toEqual(['terminal-plus', 'terminal-minus']);
    expect(bottom).toEqual(['series']);
    const series = strips.find((s) => s.kind === 'series')!;
    expect(series.nodes.map((n) => n.pole).sort()).toEqual(['+', '-']);
    expect(series.label).toBe('S1→S2');
    expect(series.partial).toBe(false);
  });

  it('4S3P: S+1 lamelle, ogni terminale di ogni cella in una sola lamella per faccia', () => {
    const p = pack(4, 3);
    const strips = buildStrips(p);
    expect(strips).toHaveLength(5);
    for (const face of ['top', 'bottom'] as const) {
      const ids = strips.filter((s) => s.face === face).flatMap((s) => s.nodes.map((n) => n.cellId));
      expect(ids.sort()).toEqual(p.cells.map((c) => c.id).sort());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('le lamelle della stessa faccia non si toccano (esagonale e quadrata)', () => {
    for (const kind of ['hex', 'square'] as const) {
      const strips = buildStrips(pack(6, 4, kind));
      for (const face of ['top', 'bottom'] as const) {
        const list = strips.filter((s) => s.face === face);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            expect(regionDistance(list[i]!, list[j]!), `${kind} ${list[i]!.id}/${list[j]!.id}`).toBeGreaterThan(0.5);
          }
        }
      }
    }
  });

  it('senza alternare le polarità (tutte + sopra) i collegamenti in serie risultano parziali', () => {
    const p = pack(3, 2);
    const flat = { ...p, cells: p.cells.map((c) => ({ ...c, plusUp: true })) };
    const strips = buildStrips(flat);
    expect(strips.some((s) => s.kind === 'series' && s.partial)).toBe(true);
    // alternando di nuovo torna tutto completo
    const fixed = alternateGroupPolarity(flat);
    expect(buildStrips(fixed).some((s) => s.partial)).toBe(false);
  });

  it('il contorno racchiude le aree di contatto di tutti i suoi nodi', () => {
    const strips = buildStrips(pack(3, 3), { marginMm: 1 });
    for (const s of strips) {
      expect(s.areaMm2).toBeGreaterThan(0);
      const minX = Math.min(...s.outline.map((p) => p.x));
      const maxX = Math.max(...s.outline.map((p) => p.x));
      for (const n of s.nodes) {
        expect(n.x - n.contactRadiusMm).toBeGreaterThanOrEqual(minX - 1e-6);
        expect(n.x + n.contactRadiusMm).toBeLessThanOrEqual(maxX + 1e-6);
      }
    }
  });
});

describe('neckWidthMm', () => {
  it('è la larghezza delle bande: di default il 60% dell’appoggio, uguale per tutte le lamelle in serie', () => {
    const strips = buildStrips(pack(2, 3));
    const series = strips.find((s) => s.kind === 'series')!;
    const pad = 2 * (contactRadiusMm(D, '+') + 1);
    expect(neckWidthMm(series)).toBeCloseTo(0.6 * pad, 6);
  });

  it('terminali: la banda non è mai più stretta dell’appoggio', () => {
    const term = buildStrips(pack(2, 3)).find((s) => s.kind === 'terminal-plus')!;
    const pad = 2 * (contactRadiusMm(D, '+') + 1);
    expect(neckWidthMm(term)).toBeCloseTo(pad, 6);
  });
});
