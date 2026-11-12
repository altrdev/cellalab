import * as THREE from 'three';
import type { ClipSpec } from '../core/cableClip';
import { CABLE_GAP_MM } from '../core/harness';
import { stlBinary } from '../core/stl';
import { t } from '../i18n';

/**
 * Forma del fermacavo, nel suo sistema: X lungo il cavo, Y lungo le celle (su), Z verso l'esterno del pacco, origine sulla
 * tangente del fianco nel vuoto tra le due celle. Una lama sottile scende nella fessura; il corpo ha un incavo a U dove il
 * cavo si preme dall'alto, con due labbra che lo trattengono.
 */
const JAW_T = 1.2;
const LIP_MM = 0.3;

function boxAt(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
  g.translate(cx, cy, cz);
  return g;
}

/** Blocco nel vuoto tra due celle: origine sulla tangente del fianco; il cavo sta a z = gioco + metà diametro. */
function valleyGeometry(spec: ClipSpec): THREE.BufferGeometry {
  const od = spec.cableOdMm;
  const H = od + 2 * (0.1 + JAW_T);
  const body = 4; // spessore lungo il cavo
  const zFloor = CABLE_GAP_MM; // piano su cui poggia il cavo
  const zc = zFloor + od / 2;
  const zTop = zFloor + od;
  const parts: THREE.BufferGeometry[] = [];
  const zBodyLow = -3.5;
  parts.push(boxAt(0, 0, (zBodyLow + zFloor) / 2, body, H, zFloor - zBodyLow)); // corpo sotto il cavo
  // lama nella fessura tra le due celle: sottile (entra nei decimi di millimetro tra le superfici) e lunga fin dove la fessura la regge
  const bladeLen = Math.max(1, spec.bladeDepthMm - Math.abs(zBodyLow));
  parts.push(boxAt(0, 0, zBodyLow - bladeLen / 2, spec.bladeMm, H, bladeLen));
  for (const sy of [-1, 1]) {
    const yJ = sy * (od / 2 + 0.1 + JAW_T / 2);
    parts.push(boxAt(0, yJ, (zFloor + zTop) / 2, body, JAW_T, zTop - zFloor));
    const yL = sy * (od / 2 + 0.1 - LIP_MM / 2);
    parts.push(boxAt(0, yL, zc + od * 0.35, body, LIP_MM, od * 0.3)); // labbra: trattengono il cavo
  }
  return mergeParts(parts);
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
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

export const clipGeometry = (spec: ClipSpec): THREE.BufferGeometry => valleyGeometry(spec);

/** STL di un fermacavo in posizione di stampa: in piedi, con la lama in basso. */
export function clipStl(spec: ClipSpec): Uint8Array {
  const g = clipGeometry(spec);
  const pos = g.getAttribute('position');
  const out: number[] = [];
  // stampato in piedi con la lama in basso: nessuna rotazione (Z della forma = Z di stampa)
  for (let i = 0; i < pos.count; i++) out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
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
