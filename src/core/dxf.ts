import { offsetRegion, regionRings } from './clip';
import { spotPositions } from './sizing';
import type { Face, Strip } from './strips';

/**
 * Scrittore DXF ASCII minimale (formato R12, il più compatibile: LibreCAD, LightBurn, Inkscape,
 * software CAM). Unità: millimetri. L'asse y del DXF va verso l'alto, quindi si inverte la y del disegno.
 *
 * Layer:
 *  - CUT   contorno di taglio, compensato di metà kerf verso l'esterno;
 *  - MARK  aree di contatto delle celle (da usare come riferimento, non da tagliare);
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
}

const LAYERS: readonly [name: string, color: number][] = [
  ['CUT', 1],
  ['MARK', 5],
  ['SPOTS', 3],
  ['TEXT', 7],
];

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

export function buildDxf(strips: readonly Strip[], options: DxfOptions): string {
  const w = new Writer();
  const list = strips.filter((s) => options.face === 'all' || s.face === options.face);
  // y verso l'alto
  const Y = (y: number) => -y;

  w.pair(0, 'SECTION');
  w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER');
  w.pair(1, 'AC1009');
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

  const polyline = (layer: string, pts: readonly { x: number; y: number }[]) => {
    w.pair(0, 'POLYLINE');
    w.pair(8, layer);
    w.pair(66, 1);
    w.pair(70, 1); // chiusa
    for (const p of pts) {
      w.pair(0, 'VERTEX');
      w.pair(8, layer);
      w.pair(10, p.x);
      w.pair(20, Y(p.y));
    }
    w.pair(0, 'SEQEND');
    w.pair(8, layer);
  };
  const circle = (layer: string, x: number, y: number, r: number) => {
    w.pair(0, 'CIRCLE');
    w.pair(8, layer);
    w.pair(10, x);
    w.pair(20, Y(y));
    w.pair(40, r);
  };
  const text = (x: number, y: number, height: number, value: string) => {
    w.pair(0, 'TEXT');
    w.pair(8, 'TEXT');
    w.pair(10, x);
    w.pair(20, Y(y));
    w.pair(40, height);
    w.pair(1, value);
  };

  for (const s of list) {
    for (const ring of regionRings(offsetRegion(s, options.kerfMm / 2))) polyline('CUT', ring);

    if (options.includeContacts) for (const n of s.nodes) circle('MARK', n.x, n.y, n.contactRadiusMm);

    const spots = options.spotsPerTerminal?.get(s.id);
    if (spots && options.spotDiameterMm && options.spotSpacingMm) {
      for (const n of s.nodes) {
        for (const p of spotPositions(n.contactRadiusMm, options.spotDiameterMm, options.spotSpacingMm, spots)) {
          circle('SPOTS', n.x + p.x, n.y + p.y, options.spotDiameterMm / 2);
        }
      }
    }

    if (options.includeLabels) {
      const cx = s.outline.reduce((a, p) => a + p.x, 0) / s.outline.length;
      const cy = s.outline.reduce((a, p) => a + p.y, 0) / s.outline.length;
      text(cx, cy, 2.5, `${s.label} ${s.face === 'top' ? 'sopra' : 'sotto'}`);
    }
  }

  w.pair(0, 'ENDSEC');
  w.pair(0, 'EOF');
  return w.toString();
}
