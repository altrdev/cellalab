import { describe, expect, it } from 'vitest';
import { setBms, setBmsMount } from './ops';
import { buildHarness } from './harness';
import { buildStrips } from './strips';
import type { Project } from './types';
import { pack, samplePath, closestApart } from './bmsFixtures';

describe('ingombro della scheda del BMS', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3 } as const;
  const fitOf = (packP: Project, mount: Parameters<typeof setBmsMount>[1] = {}) => {
    const q = setBmsMount(setBms(packP, 'bms-4s-30a-li-ion'), mount);
    return buildHarness(q, buildStrips(q, { tabs }), 0.1)!.fit!;
  };

  it('un pacco grande a sufficienza ospita la scheda: niente sporgenze', () => {
    const f = fitOf(pack(4, 3));
    expect(f.lengthOverMm).toBe(0);
    expect(f.heightOverMm).toBe(0);
  });

  it('sul fianco, se la scheda è più lunga del fianco sporge della differenza', () => {
    const f = fitOf(pack(2, 1));
    expect(f.lengthKind).toBe('flank');
    expect(f.lengthOverMm).toBeCloseTo(f.boardLengthMm - f.packLengthMm, 6);
    expect(f.lengthOverMm).toBeGreaterThan(5);
  });

  it('in testa la lunghezza della scheda va in profondità: la confronta con la profondità del pacco', () => {
    const f = fitOf(pack(4, 1), { place: 'head' });
    expect(f.lengthKind).toBe('head');
    expect(f.packLengthMm).toBeCloseTo(21.4, 1); // una sola fila di celle in profondità
    expect(f.lengthOverMm).toBeGreaterThan(30);
  });

  it('senza scatola (BMS esterno) non c’è niente da controllare', () => {
    const q = setBmsMount(setBms(pack(4, 3), 'bms-4s-30a-li-ion'), { mode: 'external' });
    expect(buildHarness(q, buildStrips(q, { tabs }), 0.1)!.fit).toBeNull();
  });
});

describe('cablaggio del BMS', () => {
  const tabs = { side: 'top', widthMm: 6, lengthMm: 8, holeMm: 1.2, bendMm: 0.3 } as const;
  const p = setBms(pack(4, 3), 'bms-4s-30a-li-ion');
  const strips = buildStrips(p, { tabs });
  const h = buildHarness(p, strips, 0.1)!;

  it('un filo per nodo, da B0 a BS', () => {
    expect(h.wires.map((w) => w.label)).toEqual(['B0', 'B1', 'B2', 'B3', 'B4']);
    // B0 è il meno del pacco: la lamella P−
    expect(strips.find((s) => s.id === h.wires[0]!.stripId)!.kind).toBe('terminal-minus');
    expect(strips.find((s) => s.id === h.wires[4]!.stripId)!.kind).toBe('terminal-plus');
  });

  it('nessun filo attraversa da una piastra all’altra: scende (o sale) fino al bordo della scatola e arriva a metà altezza', () => {
    const half = h.box!.size.y / 2;
    for (const w of h.wires) {
      const foot = w.points[1]!;
      expect(w.points[w.points.length - 1]!.y).toBeCloseTo(35.2, 6); // metà dell'altezza delle celle (70,4)
      expect(Math.abs(foot.y - 35.2)).toBeGreaterThan(half); // il piede sta fuori dalla scatola
      expect(foot.y > 35.2).toBe(w.face === 'top');
      expect(w.points[0]!.y > foot.y).toBe(w.face === 'top');
    }
  });

  it('nessun filo ne tocca un altro: ogni percorso ha la sua corsia, e dove si incrociano passano a profondità diverse', () => {
    const DIAMETER = 0.9; // filo 26 AWG con la guaina, un po' abbondante
    for (const connector of ['top', 'end'] as const) {
      for (const connectorEnd of ['start', 'end'] as const) {
        const e = buildHarness(setBmsMount(p, { connector, connectorEnd }), strips, 0.1)!;
        const paths = e.wires.map((w) => samplePath(w.points));
        const closest = closestApart(paths);
        expect(closest).toBeGreaterThanOrEqual(DIAMETER - 1e-6);
      }
    }
  });

  it('in testa la scheda sta contro la testata del pacco, girata di 90°, e i pad sono sui suoi bordi', () => {
    const xs = p.cells.map((c) => c.x);
    const pMin = Math.min(...xs) - 10.7;
    const pMax = Math.max(...xs) + 10.7;
    for (const end of ['start', 'end'] as const) {
      const e = buildHarness(setBmsMount(p, { place: 'head', connectorEnd: end }), strips, 0.1)!;
      const box = e.box!;
      // lato 'top': il fianco corre lungo X; lo spessore della scheda va lungo X, la lunghezza lungo Z
      expect(box.size.x).toBeLessThan(box.size.z);
      if (end === 'end') expect(box.center.x - box.size.x / 2).toBeGreaterThan(pMax - 1e-6);
      else expect(box.center.x + box.size.x / 2).toBeLessThan(pMin + 1e-6);
      const pads: number[] = [];
      for (const w of e.wires) {
        const pin = w.points[w.points.length - 1]!;
        expect(pin.x).toBeCloseTo(box.center.x, 6); // sul bordo della scheda
        expect(Math.abs(pin.z - box.center.z)).toBeLessThanOrEqual(box.size.z / 2); // lungo la scheda
        const edgeY = w.face === 'top' ? box.center.y + box.size.y / 2 : box.center.y - box.size.y / 2;
        expect(pin.y).toBeCloseTo(edgeY, 6); // bordo alto per la faccia sopra, basso per la faccia sotto
        pads.push(pin.z);
      }
      // pad a passo fisso, nell'ordine dei nodi
      const sorted = [...pads].sort((a, b) => a - b);
      for (let k = 1; k < sorted.length; k++) expect(sorted[k]! - sorted[k - 1]!).toBeCloseTo(2.5, 6);
      // nessun filo dentro la scheda e nessuno a meno di un diametro da un altro
      const paths = e.wires.map((w) => samplePath(w.points));
      const closest = closestApart(paths);
      expect(closest).toBeGreaterThanOrEqual(0.9 - 1e-6);
      for (const path of paths) for (const q of path) {
        const inside = Math.abs(q.x - box.center.x) < box.size.x / 2 - 1e-6 && Math.abs(q.y - box.center.y) < box.size.y / 2 - 1e-6 && Math.abs(q.z - box.center.z) < box.size.z / 2 - 1e-6;
        expect(inside).toBe(false);
      }
    }
  });

  it('in testa il filo del pad più dentro prende la corsia più lontana dalla scheda: le discese sui pad non incrociano le corsie', () => {
    for (const end of ['start', 'end'] as const) {
      const e = buildHarness(setBmsMount(p, { place: 'head', connectorEnd: end }), strips, 0.1)!;
      const box = e.box!;
      for (const a of e.wires) {
        for (const b of e.wires) {
          if (a === b || a.face !== b.face || a.node >= b.node) continue;
          // stessa faccia, nodo più basso = pad più dentro: corsia più lontana dalla scheda
          expect(Math.abs(a.points[1]!.y - box.center.y)).toBeGreaterThan(Math.abs(b.points[1]!.y - box.center.y));
        }
      }
    }
  });

  it('nessun filo entra nel volume della scatola', () => {
    const box = h.box!;
    const inside = (q: { x: number; y: number; z: number }) =>
      Math.abs(q.x - box.center.x) < box.size.x / 2 - 1e-6 && Math.abs(q.y - box.center.y) < box.size.y / 2 - 1e-6 && Math.abs(q.z - box.center.z) < box.size.z / 2 - 1e-6;
    for (const place of ['top', 'end'] as const) {
      for (const end of ['start', 'end'] as const) {
        const e = buildHarness(setBmsMount(p, { connector: place, connectorEnd: end }), strips, 0.1)!;
        for (const w of e.wires) {
          // controlla i segmenti campionati, non solo i vertici
          for (let k = 0; k + 1 < w.points.length; k++) {
            const a = w.points[k]!;
            const b = w.points[k + 1]!;
            for (let t = 0; t <= 1; t += 0.05) expect(inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })).toBe(false);
          }
        }
      }
    }
  });

  it('i fili partono da giunzioni sulle due facce e le lunghezze sono ragionevoli', () => {
    expect(new Set(h.wires.map((w) => w.face)).size).toBe(2);
    for (const w of h.wires) {
      expect(w.lengthMm).toBeGreaterThan(20);
      expect(w.lengthMm).toBeLessThan(120);
      expect(w.cutMm).toBeGreaterThanOrEqual(w.lengthMm + h.mount.slackMm - 1e-6);
      expect(w.cutMm % 5).toBe(0);
    }
  });

  it('i contatti del connettore sono ordinati e a passo fisso', () => {
    const xs = h.wires.map((w) => w.points[w.points.length - 1]!.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(2.5, 6);
  });

  it('di default i fili scavalcano il bordo della scatola e arrivano sulla sua faccia superiore', () => {
    const box = h.box!;
    const alongX = box.size.x > box.size.z;
    const c = (v: { x: number; z: number }) => (alongX ? v.x : v.z);
    const o = (v: { x: number; z: number }) => (alongX ? v.z : v.x);
    const halfL = (alongX ? box.size.x : box.size.z) / 2;
    const halfT = (alongX ? box.size.z : box.size.x) / 2;
    const outward = Math.sign(o(box.center) - o(h.wires[0]!.points[0]!));
    for (const w of h.wires) {
      expect(w.points.length).toBe(6);
      const pin = w.points[5]!;
      expect(Math.abs(c(pin) - c(box.center))).toBeLessThan(halfL); // sopra la scheda
      expect(o(pin)).toBeCloseTo(o(box.center) + outward * halfT, 6); // sulla faccia esterna
      expect(Math.abs(pin.y - box.center.y)).toBeLessThan(1e-6);
    }
    const cs = h.wires.map((w) => c(w.points[5]!)).sort((a, b) => a - b);
    for (let k = 1; k < cs.length; k++) expect(cs[k]! - cs[k - 1]!).toBeCloseTo(2.5, 6);
  });

  it('il connettore su una testata sta oltre la scatola, dal lato scelto, e i fili non la attraversano', () => {
    const box = h.box!;
    const alongX = box.size.x > box.size.z;
    const half = (alongX ? box.size.x : box.size.z) / 2;
    const c = (v: { x: number; z: number }) => (alongX ? v.x : v.z);
    const o = (v: { x: number; z: number }) => (alongX ? v.z : v.x);
    for (const end of ['start', 'end'] as const) {
      const e = buildHarness(setBmsMount(p, { connector: 'end', connectorEnd: end }), strips, 0.1)!;
      const off = c(e.connector) - c(box.center);
      expect(Math.abs(off)).toBeGreaterThan(half);
      expect(off < 0).toBe(end === 'start');
      for (const w of e.wires) {
        expect(w.points.length).toBe(6);
        expect(o(w.points[5]!)).toBeCloseTo(o(e.connector), 6); // stessa quota del retro della scatola
      }
    }
  });

  it('la posizione lungo il lato sposta il connettore; esterno aggiunge la coda e toglie la scatola', () => {
    const left = buildHarness(setBmsMount(p, { along: 0 }), strips, 0.1)!;
    const right = buildHarness(setBmsMount(p, { along: 1 }), strips, 0.1)!;
    expect(right.connector.x).toBeGreaterThan(left.connector.x + 50);
    expect(h.box).not.toBeNull();
    const ext = buildHarness(setBmsMount(p, { mode: 'external', tailMm: 100 }), strips, 0.1)!;
    expect(ext.box).toBeNull();
    expect(ext.wires[0]!.cutMm).toBeGreaterThanOrEqual(ext.wires[0]!.lengthMm + ext.mount.slackMm + 100 - 1e-6); // la coda esterna
  });

  it('senza BMS o senza linguette non c’è cablaggio', () => {
    expect(buildHarness(pack(4, 3), buildStrips(pack(4, 3), { tabs }), 0.1)).toBeNull();
    expect(buildHarness(p, buildStrips(p, {}), 0.1)).toBeNull();
  });

  it('setBmsMount tiene i valori nei limiti', () => {
    expect(setBmsMount(p, { along: 3, slackMm: -5 }).bmsMount).toMatchObject({ along: 1, slackMm: 0 });
  });
});
