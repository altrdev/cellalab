/**
 * Scrittura STL binario. `positions` è una lista di triangoli non indicizzati
 * (9 numeri per triangolo: x,y,z dei tre vertici), in millimetri.
 */
export function stlBinary(positions: ArrayLike<number>, name = 'CellaLab'): Uint8Array {
  const triangles = Math.floor(positions.length / 9);
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triangles, true);
  let o = 84;
  for (let t = 0; t < triangles; t++) {
    const p = (i: number) => positions[t * 9 + i]!;
    const ux = p(3) - p(0);
    const uy = p(4) - p(1);
    const uz = p(5) - p(2);
    const vx = p(6) - p(0);
    const vy = p(7) - p(1);
    const vz = p(8) - p(2);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const n of [nx, ny, nz]) {
      view.setFloat32(o, n, true);
      o += 4;
    }
    for (let i = 0; i < 9; i++) {
      view.setFloat32(o, p(i), true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buffer);
}
