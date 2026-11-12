import { t } from '../i18n';
import { ringWithArcs, type Circle } from './arcs';
import { offsetRegion, regionRings } from './clip';
import { spotPositions } from './sizing';
import { tabsOf, type Face, type Strip } from './strips';

/**
 * Scrittore DXF ASCII minimale (formato R12, il più compatibile: LibreCAD, LightBurn, Inkscape,
 * software CAM). Unità: millimetri. L'asse y del DXF va verso l'alto, quindi si inverte la y del disegno.
 *
 * Layer:
 *  - CUT   contorno di taglio, compensato di metà kerf verso l'esterno;
 *  - MARK  aree di contatto delle celle e linee di piega delle linguette (riferimenti, non da tagliare);
 *  - SPOTS punti di saldatura consigliati;
 *  - TEXT  etichette.
 */

export interface DxfOptions {
  /** Quale faccia esportare. */
  face: Face | 'all';
  /** Larghezza del taglio: il contorno si sposta di metà verso l'esterno. */
  kerfMm: number;
  /** Mostra le aree di contatto. */
  includeContacts: boolean;
  includeLabels: boolean;
  /** Punti per terminale da segnare, per lamella (id → numero). Vuoto = non segnare i punti. */
  spotsPerTerminal?: ReadonlyMap<string, number>;
  spotDiameterMm?: number;
  spotSpacingMm?: number;
  /** Unità in cui si scrivono le coordinate (il calcolo resta in mm): 'in' divide per 25,4 e lo dichiara nell'intestazione. */
  unit?: 'mm' | 'in';
}

const LAYERS: readonly [name: string, color: number][] = [
  ['CUT', 1],
  ['MARK', 5],
  ['SPOTS', 3],
  ['TEXT', 7],
];

/** Il DXF R12 è solo ASCII: le frecce e i segni meno tipografici delle etichette diventano caratteri semplici. */
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
/** Distanza tra il contorno di una lamella e la sua etichetta, mm. */
const LABEL_GAP_MM = 2;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

export interface LabelPlacement {
  /** Bordo sinistro del testo. */
  x: number;
  /** Centro del testo in orizzontale (per chi lo allinea al centro). */
  cx: number;
  /** Linea di base. */
  y: number;
  width: number;
  text: string;
}

/**
 * Posizione delle etichette: sotto ogni lamella, fuori dal contorno (in un file di taglio un testo dentro il pezzo
 * verrebbe inciso o tagliato, e su una dima copre i punti). Se lì c'è un'altra lamella o un'altra etichetta si scende
 * finché c'è posto. Coordinate del disegno (y verso il basso); `padMm` è il margine di taglio attorno alle lamelle.
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
      // la propria lamella sta sopra: conta solo il resto
      if (!obstacles.some((o, k) => k !== i && overlaps(o, box)) && !out.some((l) => overlaps(labelBox(l), box))) break;
      top += height * 1.6;
    }
    out.push({ x, cx, y: top + height, width, text });
  });
  return out;
}

export function buildDxf(strips: readonly Strip[], options: DxfOptions): string {
  const w = new Writer();
  const list = strips.filter((s) => options.face === 'all' || s.face === options.face);
  // y verso l'alto
  const Y = (y: number) => -y;
  // il disegno si calcola in mm; in uscita si scala nell'unità scelta
  const inches = options.unit === 'in';
  const f = inches ? 1 / 25.4 : 1;

  w.pair(0, 'SECTION');
  w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER');
  w.pair(1, 'AC1009');
  // unità del disegno (1 = pollici, 4 = millimetri) e sistema di misura (0 = imperiale, 1 = metrico)
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

  /** Polilinea chiusa; i vertici con `bulge` ≠ 0 aprono un arco verso il vertice successivo (gruppo 42). */
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
    // I cerchi noti della lamella (appoggi e teste delle bande, ingranditi di metà taglio) diventano archi veri.
    // Il bulge è calcolato con la y del DXF (verso l'alto), quindi anche i cerchi e i vertici si ribaltano.
    const k = options.kerfMm / 2;
    const circles: Circle[] = s.nodes.flatMap((n) => [
      { cx: n.x, cy: Y(n.y), r: n.reachMm + k },
      { cx: n.x, cy: Y(n.y), r: s.bandMm / 2 + k },
    ]);
    for (const ring of regionRings(offsetRegion(s, k))) {
      const arcs = ringWithArcs(
        ring.map((p) => ({ x: p.x, y: Y(p.y) })),
        circles,
      );
      polyline('CUT', arcs.map((v) => ({ x: v.x, y: Y(v.y), bulge: v.bulge })));
    }

    for (const tab of tabsOf(s)) line('MARK', tab.bend[0], tab.bend[1]);
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
