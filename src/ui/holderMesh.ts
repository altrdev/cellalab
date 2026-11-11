import * as THREE from 'three';
import { t } from '../i18n';
import type { Region } from '../core/clip';
import type { HolderModel } from '../core/holder';
import type { Pt } from '../core/polygon';
import { stlBinary } from '../core/stl';

/**
 * Mesh del portacelle. Coordinate come nella scena 3D: x,y del disegno → X,Z; l'altezza sale lungo Y,
 * con le celle appoggiate sul piano (da Y = 0 a Y = altezza).
 */

export type HolderHalf = 'top' | 'bottom';

function shapeOf(r: Region): THREE.Shape {
  const shape = new THREE.Shape(r.outline.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const h of r.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
  return shape;
}

/** Estrude le forme da `topY` verso il basso per `depth` mm. */
function extrudeDown(regions: readonly Region[], depth: number, topY: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(regions.map(shapeOf), { depth, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(Math.PI / 2); // (x, y, z) → (x, −z, y): il disegno va su X/Z e l'estrusione scende lungo −Y
  g.translate(0, topY, 0);
  return g;
}

type V3 = [number, number, number];

const signedArea = (pts: readonly Pt[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

/**
 * Striscia di triangoli tra due contorni chiusi (P a quota zp, Q a quota zq), avanzando sempre dal lato che
 * dà la diagonale più corta: va bene per contorni paralleli come un contorno e il suo arretramento.
 * I lati su P sono percorsi in avanti, quelli su Q all'indietro: più strisce in sequenza chiudono un solido coerente.
 */
function strip(P: readonly Pt[], zp: number, Qin: readonly Pt[], zq: number, tris: V3[][]) {
  const Q = signedArea(P) * signedArea(Qin) < 0 ? [...Qin].reverse() : Qin;
  const nP = P.length;
  const nQ = Q.length;
  let j0 = 0;
  let best = Infinity;
  for (let j = 0; j < nQ; j++) {
    const d = (P[0]!.x - Q[j]!.x) ** 2 + (P[0]!.y - Q[j]!.y) ** 2;
    if (d < best) {
      best = d;
      j0 = j;
    }
  }
  const p = (i: number): V3 => [P[i % nP]!.x, P[i % nP]!.y, zp];
  const q = (j: number): V3 => [Q[(j0 + j) % nQ]!.x, Q[(j0 + j) % nQ]!.y, zq];
  const dist = (a: V3, b: V3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  let i = 0;
  let j = 0;
  while (i < nP || j < nQ) {
    if (i < nP && (j >= nQ || dist(p(i + 1), q(j)) <= dist(p(i), q(j + 1)))) {
      tris.push([p(i), p(i + 1), q(j)]);
      i++;
    } else {
      tris.push([p(i), q(j + 1), q(j)]);
      j++;
    }
  }
}

/**
 * Cuneo dello smusso su una faccia: sezione triangolare tra il contorno pieno `a` (a quota `zc`) e quello
 * arretrato `b` (a quota `zFace` e `zc`). Tre strisce: rampa, parete interna, bordo piano.
 */
function wedge(a: readonly Pt[], b: readonly Pt[], zFace: number, zc: number): V3[][] {
  const tris: V3[][] = [];
  strip(b, zFace, a, zc, tris);
  strip(a, zc, b, zc, tris);
  strip(b, zc, b, zFace, tris);
  return tris;
}

/** Geometria da triangoli in coordinate locali (x, y, z dalla faccia esterna); `map` le porta nella scena. */
function trisGeometry(tris: V3[][], map: (v: V3) => V3): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const t of tris) for (const v of t) pos.push(...map(v));
  // orientamento: volume con segno positivo = normali verso l'esterno (si corregge in blocco, la mappa può specchiare)
  let vol = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = pos.slice(i, i + 9) as [number, number, number, number, number, number, number, number, number];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    for (let i = 0; i < pos.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k]!;
        pos[i + 3 + k] = pos[i + 6 + k]!;
        pos[i + 6 + k] = t;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Le fette di una piastra, nel sistema della scena. La faccia esterna del fondo sta dalla parte
 * opposta alle celle: in alto per la piastra sopra, in basso per quella sotto.
 */
export function holderHalfGeometries(model: HolderModel, half: HolderHalf): THREE.BufferGeometry[] {
  const f = model.floorMm;
  const H = model.cellHeightMm;
  const geos = model.layers.map((l) =>
    half === 'top'
      ? extrudeDown(l.regions, l.z1 - l.z0, H + f - l.z0)
      : extrudeDown(l.regions, l.z1 - l.z0, l.z1 - f),
  );
  if (model.ramp) {
    // z locale dalla faccia esterna: top → Y = H + f − z, bottom → Y = z − f; il disegno va su X/Z
    const map = (v: V3): V3 => (half === 'top' ? [v[0], H + f - v[2], v[1]] : [v[0], v[2] - f, v[1]]);
    const c = model.chamferMm;
    for (const { a, b } of model.ramp.contours) {
      geos.push(trisGeometry(wedge(a, b, 0, c), map));
      geos.push(trisGeometry(wedge(a, b, model.totalMm, model.totalMm - c), map));
    }
  }
  return geos;
}

/**
 * STL di una piastra, nella posizione di stampa: fondo piatto sul piano (Z = 0), pareti verso l'alto,
 * angolo minimo in (0, 0). Le due piastre sono una lo specchio dell'altra; con `rotate` il pezzo è girato di 90° (per un piano più stretto).
 */
export function holderStl(model: HolderModel, half: HolderHalf, rotate = false): Uint8Array {
  const f = model.floorMm;
  const H = model.cellHeightMm;
  const geos = holderHalfGeometries(model, half);
  const out: number[] = [];
  for (const g of geos) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const X = pos.getX(i);
      const Y = pos.getY(i);
      const Z = pos.getZ(i);
      // rotazioni proprie (niente specchio): i triangoli restano rivolti verso l'esterno
      if (half === 'bottom') out.push(X, -Z, Y + f);
      else out.push(X, Z, H + f - Y);
    }
    g.dispose();
  }
  // rotazione di 90° (x, y) → (y, −x): non specchia, i triangoli restano rivolti verso l'esterno
  if (rotate) {
    for (let i = 0; i < out.length; i += 3) {
      const x = out[i]!;
      out[i] = out[i + 1]!;
      out[i + 1] = -x;
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  for (let i = 0; i < out.length; i += 3) {
    minX = Math.min(minX, out[i]!);
    minY = Math.min(minY, out[i + 1]!);
  }
  for (let i = 0; i < out.length; i += 3) {
    out[i] = out[i]! - minX;
    out[i + 1] = out[i + 1]! - minY;
  }
  return stlBinary(out, t('export.stl.header', { half: t(half === 'top' ? 'face.top' : 'face.bottom') }));
}
