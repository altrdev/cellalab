import { t } from '../i18n';
import { fitFreeArcs, ringWithArcs, type Circle } from './arcs';
import { offsetRegion, regionRings } from './clip';
import { spotPositions } from './sizing';
import { tabsOf, type Face, type Strip } from './strips';

/**
 * Minimal ASCII DXF writer (R12 format, the most compatible: LibreCAD, LightBurn, Inkscape,
 * CAM software). Unit: millimetres. The DXF y axis points up, so the drawing's y is flipped.
 *
 * Layer:
 *  - CUT   cut outline, compensated by half the kerf outwards;
 *  - MARK  cell contact areas and tab fold lines (references, not to be cut);
 *  - SPOTS recommended weld spots;
 *  - TEXT  etichette.
 */

export interface DxfOptions {
  /** Quale faccia esportare. */
  face: Face | 'all';
  /** Cut width: the outline moves outwards by half of it. */
  kerfMm: number;
  /** Shows the contact areas. */
  includeContacts: boolean;
  includeLabels: boolean;
  /** Spots per terminal to mark, per strip (id → number). Empty = do not mark spots. */
  spotsPerTerminal?: ReadonlyMap<string, number>;
  spotDiameterMm?: number;
  spotSpacingMm?: number;
  /** Unit the coordinates are written in (the calculation stays in mm): 'in' divides by 25.4 and declares it in the header. */
  unit?: 'mm' | 'in';
}

const LAYERS: readonly [name: string, color: number][] = [
  ['CUT', 1],
  ['MARK', 5],
  ['SPOTS', 3],
  ['TEXT', 7],
];

/** DXF R12 is ASCII only: the arrows and typographic minus signs of the labels become plain characters. */
export const asciiLabel = (s: string) =>
  s
    .replace(/→/g, '->')
    .replace(/[−–—]/g, '-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');

const num = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e4) / 1e4).toString();

class Writer {
  private lines: string[] = [];
  pair(code: number, value: string | number) {
    this.lines.push(String(code), typeof value === 'number' ? num(value) : value);
  }
  toString() {
    return this.lines.join('\n') + '\n';
  }
}

const LABEL_HEIGHT_MM = 2.5;
/** Distance between a strip's outline and its label, mm. */
const LABEL_GAP_MM = 2;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

export interface LabelPlacement {
  /** Left edge of the text. */
  x: number;
  /** Horizontal centre of the text (for those who align it to the centre). */
  cx: number;
  /** Baseline. */
  y: number;
  width: number;
  text: string;
}

/**
 * Label positions: below each strip, outside the outline (in a cut file text inside the piece
 * would be engraved or cut, and on a template it covers the spots). If another strip or label is there it moves down
 * until there is room. Drawing coordinates (y down); `padMm` is the cut margin around the strips.
 */
export function labelPlacements(
  strips: readonly Strip[],
  padMm: number,
  opts: { heightMm?: number; textOf?: (s: Strip) => string } = {},
): LabelPlacement[] {
  const height = opts.heightMm ?? LABEL_HEIGHT_MM;
  const textOf = opts.textOf ?? ((s: Strip) => asciiLabel(`${s.label} ${t(s.face === 'top' ? 'face.top' : 'face.bottom')}`));
  const boxOf = (s: Strip): Box => {
    const xs = s.outline.map((p) => p.x);
    const ys = s.outline.map((p) => p.y);
    return { minX: Math.min(...xs) - padMm, maxX: Math.max(...xs) + padMm, minY: Math.min(...ys) - padMm, maxY: Math.max(...ys) + padMm };
  };
  const obstacles: Box[] = strips.map(boxOf);
  const out: LabelPlacement[] = [];
  const labelBox = (l: LabelPlacement): Box => ({ minX: l.x, maxX: l.x + l.width, minY: l.y - height, maxY: l.y });
  strips.forEach((s, i) => {
    const text = textOf(s);
    const b = obstacles[i]!;
    const width = [...text].length * height * 0.6;
    const cx = (b.minX + b.maxX) / 2;
    const x = cx - width / 2;
    let top = b.maxY + LABEL_GAP_MM;
    for (let guard = 0; guard < 200; guard++) {
      const box: Box = { minX: x, maxX: x + width, minY: top, maxY: top + height };
      // its own strip is above: only the rest counts
      if (!obstacles.some((o, k) => k !== i && overlaps(o, box)) && !out.some((l) => overlaps(labelBox(l), box))) break;
      top += height * 1.6;
    }
    out.push({ x, cx, y: top + height, width, text });
  });
  return out;
}

/** Centre and radius if all points lie on a circle (a round hole drawn as a polyline), otherwise null. */
function circleOf(ring: readonly { x: number; y: number }[]): { x: number; y: number; r: number } | null {
  if (ring.length < 12) return null;
  const x = ring.reduce((a, p) => a + p.x, 0) / ring.length;
  const y = ring.reduce((a, p) => a + p.y, 0) / ring.length;
  const ds = ring.map((p) => Math.hypot(p.x - x, p.y - y));
  const r = ds.reduce((a, v) => a + v, 0) / ds.length;
  return ds.every((v) => Math.abs(v - r) < 0.005) ? { x, y, r } : null;
}

export function buildDxf(strips: readonly Strip[], options: DxfOptions): string {
  const w = new Writer();
  const list = strips.filter((s) => options.face === 'all' || s.face === options.face);
  // y verso l'alto
  const Y = (y: number) => -y;
  // the drawing is computed in mm; on output it is scaled to the chosen unit
  const inches = options.unit === 'in';
  const f = inches ? 1 / 25.4 : 1;

  w.pair(0, 'SECTION');
  w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER');
  w.pair(1, 'AC1009');
  // drawing units (1 = inches, 4 = millimetres) and measurement system (0 = imperial, 1 = metric)
  w.pair(9, '$INSUNITS');
  w.pair(70, inches ? 1 : 4);
  w.pair(9, '$MEASUREMENT');
  w.pair(70, inches ? 0 : 1);
  w.pair(0, 'ENDSEC');

  w.pair(0, 'SECTION');
  w.pair(2, 'TABLES');
  w.pair(0, 'TABLE');
  w.pair(2, 'LAYER');
  w.pair(70, LAYERS.length);
  for (const [name, color] of LAYERS) {
    w.pair(0, 'LAYER');
    w.pair(2, name);
    w.pair(70, 0);
    w.pair(62, color);
    w.pair(6, 'CONTINUOUS');
  }
  w.pair(0, 'ENDTAB');
  w.pair(0, 'ENDSEC');

  w.pair(0, 'SECTION');
  w.pair(2, 'ENTITIES');

  /** Closed polyline; vertices with `bulge` ≠ 0 open an arc towards the next vertex (group 42). */
  const polyline = (layer: string, pts: readonly { x: number; y: number; bulge?: number }[]) => {
    w.pair(0, 'POLYLINE');
    w.pair(8, layer);
    w.pair(66, 1);
    w.pair(70, 1); // chiusa
    for (const p of pts) {
      w.pair(0, 'VERTEX');
      w.pair(8, layer);
      w.pair(10, p.x * f);
      w.pair(20, Y(p.y) * f);
      if (p.bulge) w.pair(42, p.bulge);
    }
    w.pair(0, 'SEQEND');
    w.pair(8, layer);
  };
  const circle = (layer: string, x: number, y: number, r: number) => {
    w.pair(0, 'CIRCLE');
    w.pair(8, layer);
    w.pair(10, x * f);
    w.pair(20, Y(y) * f);
    w.pair(40, r * f);
  };
  const line = (layer: string, a: { x: number; y: number }, b: { x: number; y: number }) => {
    w.pair(0, 'LINE');
    w.pair(8, layer);
    w.pair(10, a.x * f);
    w.pair(20, Y(a.y) * f);
    w.pair(11, b.x * f);
    w.pair(21, Y(b.y) * f);
  };
  const text = (x: number, y: number, height: number, value: string) => {
    w.pair(0, 'TEXT');
    w.pair(8, 'TEXT');
    w.pair(10, x * f);
    w.pair(20, Y(y) * f);
    w.pair(40, height * f);
    w.pair(1, asciiLabel(value));
  };

  for (const s of list) {
    // The strip's known circles (contact areas and band heads, enlarged by half the cut) become true arcs.
    // The bulge is computed with the DXF y (upwards), so the circles and vertices are flipped too.
    const k = options.kerfMm / 2;
    const circles: Circle[] = s.nodes.flatMap((n) => [
      { cx: n.x, cy: Y(n.y), r: n.reachMm + k },
      { cx: n.x, cy: Y(n.y), r: s.bandMm / 2 + k },
    ]);
    // Round holes too (the tab one…) become true arcs: the cut narrows them by half the kerf.
    for (const hole of s.holes) {
      const fit = circleOf(hole);
      if (fit) circles.push({ cx: fit.x, cy: Y(fit.y), r: fit.r - k });
    }
    for (const ring of regionRings(offsetRegion(s, k))) {
      // first the known circles (cells, bands, holes), then the corners rounded by the kerf and the like
      const arcs = fitFreeArcs(
        ringWithArcs(
          ring.map((p) => ({ x: p.x, y: Y(p.y) })),
          circles,
        ),
      );
      polyline('CUT', arcs.map((v) => ({ x: v.x, y: Y(v.y), bulge: v.bulge })));
    }

    for (const tb of tabsOf(s)) line('MARK', tb.bend[0], tb.bend[1]);
    if (options.includeContacts) for (const n of s.nodes) circle('MARK', n.x, n.y, n.contactRadiusMm);

    const spots = options.spotsPerTerminal?.get(s.id);
    if (spots && options.spotDiameterMm && options.spotSpacingMm) {
      for (const n of s.nodes) {
        for (const p of spotPositions(n.contactRadiusMm, options.spotDiameterMm, options.spotSpacingMm, spots)) {
          circle('SPOTS', n.x + p.x, n.y + p.y, options.spotDiameterMm / 2);
        }
      }
    }

  }

  if (options.includeLabels) {
    for (const l of labelPlacements(list, options.kerfMm / 2)) text(l.x, l.y, LABEL_HEIGHT_MM, l.text);
  }

  w.pair(0, 'ENDSEC');
  w.pair(0, 'EOF');
  return w.toString();
}
