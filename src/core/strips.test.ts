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
  it('+ pole up: + on top and − below; flipped the opposite', () => {
    expect(poleOnFace({ plusUp: true }, 'top')).toBe('+');
    expect(poleOnFace({ plusUp: true }, 'bottom')).toBe('-');
    expect(poleOnFace({ plusUp: false }, 'top')).toBe('-');
    expect(poleOnFace({ plusUp: false }, 'bottom')).toBe('+');
  });
});

describe('contactRadiusMm', () => {
  it('+ = button (≈41% of the radius); − = bottom minus the rim', () => {
    expect(contactRadiusMm(21.4, '+')).toBeCloseTo(0.41 * 10.7, 9);
    expect(contactRadiusMm(21.4, '-')).toBeCloseTo(10.7 - 1.5, 9);
  });
});

describe('buildStrips', () => {
  it('without groups it generates nothing', () => {
    const p = createProject();
    expect(buildStrips(p)).toEqual([]);
    const ungrouped = { ...pack(2, 1), cells: pack(2, 1).cells.map((c) => ({ ...c, group: null })) };
    expect(buildStrips(ungrouped)).toEqual([]);
  });

  it('2S1P with alternating polarities: + and − terminals on top, series connection below', () => {
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

  it('4S3P: S+1 strips, each terminal of each cell in a single strip per face', () => {
    const p = pack(4, 3);
    const strips = buildStrips(p);
    expect(strips).toHaveLength(5);
    for (const face of ['top', 'bottom'] as const) {
      const ids = strips.filter((s) => s.face === face).flatMap((s) => s.nodes.map((n) => n.cellId));
      expect(ids.sort()).toEqual(p.cells.map((c) => c.id).sort());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('the strips of the same face do not touch (hexagonal and square)', () => {
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

  it('without alternating polarities (all + up) the series connections come out partial', () => {
    const p = pack(3, 2);
    const flat = { ...p, cells: p.cells.map((c) => ({ ...c, plusUp: true })) };
    const strips = buildStrips(flat);
    expect(strips.some((s) => s.kind === 'series' && s.partial)).toBe(true);
    // alternating again brings everything back to complete
    const fixed = alternateGroupPolarity(flat);
    expect(buildStrips(fixed).some((s) => s.partial)).toBe(false);
  });

  it('the outline encloses the contact areas of all its nodes', () => {
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
  it('it is the band width: by default 60% of the support, equal for all the series strips', () => {
    const strips = buildStrips(pack(2, 3));
    const series = strips.find((s) => s.kind === 'series')!;
    const pad = 2 * (contactRadiusMm(D, '+') + 1);
    expect(neckWidthMm(series)).toBeCloseTo(0.6 * pad, 6);
  });

  it('terminals: the band is never narrower than the support', () => {
    const term = buildStrips(pack(2, 3)).find((s) => s.kind === 'terminal-plus')!;
    const pad = 2 * (contactRadiusMm(D, '+') + 1);
    expect(neckWidthMm(term)).toBeCloseTo(pad, 6);
  });
});

describe('round outlines', () => {
  it('a single support is a dense circle: short sides and all the vertices on the radius', () => {
    const strips = buildStrips(pack(1, 1));
    const s = strips.find((x) => x.nodes.length === 1)!;
    const n = s.nodes[0]!;
    expect(s.outline.length).toBeGreaterThanOrEqual(80);
    let maxEdge = 0;
    for (let i = 0; i < s.outline.length; i++) {
      const p = s.outline[i]!;
      const q = s.outline[(i + 1) % s.outline.length]!;
      maxEdge = Math.max(maxEdge, Math.hypot(p.x - q.x, p.y - q.y));
      expect(Math.hypot(p.x - n.x, p.y - n.y)).toBeCloseTo(n.reachMm, 2);
    }
    expect(maxEdge).toBeLessThanOrEqual(0.45);
  });
});
