import type { Pt } from './polygon';

/**
 * Cifre a sette segmenti, fatte di rettangoli (anche sovrapposti: vanno bene per un'unione o una differenza
 * con Clipper). Servono a incidere numeri sui pezzi stampati senza dipendere da un font.
 * Coordinate del disegno: y verso il basso, il testo si legge dall'alto come nell'editor.
 */

// segmenti: a alto, b alto-destra, c basso-destra, d basso, e basso-sinistra, f alto-sinistra, g centro
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Larghezza di una cifra e spazio tra due cifre, in rapporto all'altezza. */
const WIDTH_RATIO = 0.58;
const GAP_RATIO = 0.22;

/**
 * Ogni cifra è alzata di qualche centesimo di mm in più della precedente: se i bordi di cifre diverse stessero
 * sulla stessa riga, la triangolazione delle facce darebbe lati che passano per vertici altrui e gli slicer
 * segnalerebbero bordi aperti. Sotto i 0,05 mm non si vede e non si stampa.
 */
const JITTER_MM = 0.013;

/** Larghezza totale di `text` (solo cifre), mm. */
export function textWidth(text: string, heightMm: number): number {
  const n = [...text].length;
  return n === 0 ? 0 : n * heightMm * WIDTH_RATIO + (n - 1) * heightMm * GAP_RATIO;
}

/**
 * Poligoni delle cifre di `text`, centrati in (cx, cy). `strokeMm` è lo spessore del tratto:
 * per una stampa con ugello da 0,4 mm non scendere sotto 0,8.
 */
export function digitPolygons(text: string, cx: number, cy: number, heightMm: number, strokeMm: number): Pt[][] {
  const w = heightMm * WIDTH_RATIO;
  const gap = heightMm * GAP_RATIO;
  const t = Math.min(strokeMm, w / 2.5, heightMm / 3.5);
  const out: Pt[][] = [];
  let x = cx - textWidth(text, heightMm) / 2;
  let k = 0;
  for (const ch of text) {
    const dy = k++ * JITTER_MM;
    const y0 = cy - heightMm / 2 + dy;
    const y1 = cy + heightMm / 2 + dy;
    const ym = cy + dy;
    const segs = SEGMENTS[ch];
    if (segs) {
      const x1 = x + w;
      const shapes: Record<string, Pt[]> = {
        a: rect(x, y0, x1, y0 + t),
        b: rect(x1 - t, y0, x1, ym + t / 2),
        c: rect(x1 - t, ym - t / 2, x1, y1),
        d: rect(x, y1 - t, x1, y1),
        e: rect(x, ym - t / 2, x + t, y1),
        f: rect(x, y0, x + t, ym + t / 2),
        g: rect(x, ym - t / 2, x1, ym + t / 2),
      };
      for (const s of segs) out.push(shapes[s]!);
    }
    x += w + gap;
  }
  return out;
}
