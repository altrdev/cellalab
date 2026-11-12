import * as THREE from 'three';
import { CLIP_FIT_MM, type ClipSpec } from '../core/cableClip';
import { stlBinary } from '../core/stl';
import { t } from '../i18n';

/**
 * Forma del fermacavo a scatto, nel suo sistema: X lungo il cavo, Y lungo la cella (su), Z verso l'esterno del pacco,
 * origine sull'asse della cella a metà fascia. Fascia a C con la bocca verso l'esterno; ai bordi della bocca due
 * piantoni con un'incavo a U dove il cavo si preme dall'alto (due labbra lo trattengono).
 */
const POST_T = 3; // spessore dei piantoni lungo il cavo, mm
const JAW_T = 1.2;
const LIP_MM = 0.3;

function boxAt(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  g.translate(cx, cy, cz);
  return g;
}

export function clipGeometry(spec: ClipSpec): THREE.BufferGeometry {
  const r = spec.cellDiameterMm / 2;
  const rin = r + CLIP_FIT_MM;
  const rout = rin + spec.thicknessMm;
  const H = spec.heightMm;
  const od = spec.cableOdMm;
  const theta = Math.asin(Math.min(0.95, spec.mouthMm / 2 / rin));

  // Fascia: settore d'anello da θ a 2π−θ (misurati dalla bocca, verso +Z), estrusa per H.
  const pts: THREE.Vector2[] = [];
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const phi = theta + ((2 * Math.PI - 2 * theta) * i) / steps;
    pts.push(new THREE.Vector2(rout * Math.sin(phi), rout * Math.cos(phi)));
  }
  for (let i = steps; i >= 0; i--) {
    const phi = theta + ((2 * Math.PI - 2 * theta) * i) / steps;
    pts.push(new THREE.Vector2(rin * Math.sin(phi), rin * Math.cos(phi)));
  }
  const band = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: H, bevelEnabled: false });
  band.rotateX(Math.PI / 2); // la forma sta su (X, Z); l'estrusione scende lungo −Y
  band.translate(0, H / 2, 0);
  const parts: THREE.BufferGeometry[] = [band.toNonIndexed()];

  // Piantoni: dalla testa delle braccia fino al piano su cui poggia il cavo; sopra, i due ganci con le labbra.
  const zFloor = r + 0.25; // il cavo poggia a poco dalla cella
  const zc = zFloor + od / 2;
  const xe = (rin + spec.thicknessMm / 2) * Math.sin(theta);
  const ze = (rin + spec.thicknessMm / 2) * Math.cos(theta) - 0.2;
  for (const sg of [-1, 1]) {
    const x = sg * xe;
    parts.push(boxAt(x, 0, (ze + zFloor) / 2, POST_T, H, zFloor - ze));
    for (const sy of [-1, 1]) {
      const yJ = sy * (od / 2 + 0.1 + JAW_T / 2);
      const zTop = zc + od * 0.5;
      parts.push(boxAt(x, yJ, (zFloor + zTop) / 2, POST_T, JAW_T, zTop - zFloor));
      // labbra verso l'interno, a metà altezza del cavo e poco sopra: lo trattengono
      const yL = sy * (od / 2 + 0.1 - LIP_MM / 2);
      parts.push(boxAt(x, yL, zc + od * 0.35, POST_T, LIP_MM, od * 0.3));
    }
  }
  const total = parts.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, off);
    off += g.getAttribute('position').count * 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

/** STL di un fermacavo in posizione di stampa: la cella (asse Y della forma) in verticale, la bocca verso −Y. */
export function clipStl(spec: ClipSpec): Uint8Array {
  const g = clipGeometry(spec);
  const pos = g.getAttribute('position');
  const out: number[] = [];
  // rotazione propria (X, Y, Z) → (X, −Z, Y): niente specchio, i triangoli restano rivolti verso l'esterno
  for (let i = 0; i < pos.count; i++) out.push(pos.getX(i), -pos.getZ(i), pos.getY(i));
  g.dispose();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  for (let i = 0; i < out.length; i += 3) {
    minX = Math.min(minX, out[i]!);
    minY = Math.min(minY, out[i + 1]!);
    minZ = Math.min(minZ, out[i + 2]!);
  }
  for (let i = 0; i < out.length; i += 3) {
    out[i] = out[i]! - minX;
    out[i + 1] = out[i + 1]! - minY;
    out[i + 2] = out[i + 2]! - minZ;
  }
  return stlBinary(out, t('export.stl.headerClip'));
}
