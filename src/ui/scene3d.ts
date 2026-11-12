import * as THREE from 'three';
import { onThemeChange } from '../theme';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { findCellType } from '../core/catalog';
import type { HolderModel } from '../core/holder';
import { explodeOffsets } from '../core/explode';
import { intersectRegions, type Region } from '../core/clip';
import { boundsOfCells } from '../core/geometry';
import { SIDE_VECTOR } from '../core/polygon';
import type { Harness } from '../core/harness';
import { tabsOf, type Strip, type TabSide } from '../core/strips';
import type { Project } from '../core/types';
import { groupHue } from './colors';
import { holderHalfGeometries } from './holderMesh';

/** Direzione della linguetta nel disegno (y verso il basso). */

/**
 * Scena 3D del pacco. Coordinate: x e y del disegno 2D diventano X e Z (y verso chi guarda),
 * l'altezza della cella sale lungo Y. Le celle stanno appoggiate sul piano (Y = 0).
 */

export type ViewPreset = 'iso' | 'top' | 'front' | 'side';

export interface SceneOptions {
  /** Spostamento (mm) della cella più lontana dal centro nella vista esplosa. */
  explosionMm: number;
  showCells: boolean;
  showPlane: boolean;
  selected: ReadonlySet<string>;
  /** Lamelle da disegnare (null = nascoste) e loro spessore, mm. */
  strips?: readonly Strip[] | null;
  stripThicknessMm?: number;
  /** Colore del materiale delle lamelle (#rrggbb). */
  stripColor?: string;
  /** Portacelle da disegnare (null = nascosto). Sparisce nella vista esplosa. */
  holder?: HolderModel | null;
  /** Quali piastre mostrare e di che colore (#rrggbb). */
  holderTop?: boolean;
  holderBottom?: boolean;
  holderColor?: string;
  /** BMS e fili da disegnare (null = nascosti). Spariscono nella vista esplosa. */
  harness?: Harness | null;
}

const RING_COLOR = 0xc9382f; // anello isolante sul lato positivo
const UNGROUPED_COLOR = 0x8a8f8a;
const SELECT_COLOR = 0x2fbf71;
const FOV = 40;

interface CellNode {
  root: THREE.Group;
  /** Guaina colorata: porta il colore del gruppo e l'evidenziazione della selezione. */
  sleeve: THREE.Mesh;
  geometryKey: string;
  materialKey: string;
}

/** Geometrie condivise da tutte le celle con lo stesso diametro e la stessa altezza. */
interface CellGeometries {
  sleeve: THREE.BufferGeometry;
  steelTop: THREE.BufferGeometry;
  ring: THREE.BufferGeometry;
  button: THREE.BufferGeometry;
  steelBottom: THREE.BufferGeometry;
}

const v2 = (r: number, y: number) => new THREE.Vector2(r, y);
const lathe = (pts: THREE.Vector2[], segments = 48) => new THREE.LatheGeometry(pts, segments);

/**
 * Cella cilindrica (tipo 18650/21700) con il polo + in alto, centrata sull'origine.
 * Profili di rotazione con piccoli smussi, in millimetri.
 */
function buildCellGeometries(R: number, H: number): CellGeometries {
  const T = H / 2;
  const e = Math.min(0.5, R * 0.05); // spessore degli smussi
  // Guaina: avvolge il corpo e arriva a ridosso delle due estremità.
  const sleeve = lathe([
    v2(R - 0.55, -T + 0.15),
    v2(R - e * 0.3, -T + 0.2),
    v2(R, -T + 0.2 + e),
    v2(R, T - 0.55 - e),
    v2(R - e * 0.3, T - 0.55),
    v2(R - 0.55, T - 0.5),
  ]);
  // Spalla in acciaio sotto l'anello isolante (lato +).
  const steelTop = lathe([v2(0, T - 0.05), v2(R - 0.5, T - 0.05), v2(R - 0.5, T - 0.55), v2(0, T - 0.55)]);
  // Anello isolante rosso attorno al bottone.
  const ri = R * 0.56;
  const ro = R * 0.82;
  const ring = lathe([v2(ri, T - 0.05), v2(ri, T + 0.3), v2(ro, T + 0.3), v2(ro, T - 0.05)]);
  // Bottone positivo in rilievo, con il bordo smussato.
  const rb = R * 0.42;
  const bh = Math.min(1.1, R * 0.12);
  const button = lathe([
    v2(0, T + bh),
    v2(rb - 0.3, T + bh),
    v2(rb, T + bh - 0.3),
    v2(rb, T + 0.05),
    v2(0, T + 0.05),
  ]);
  // Fondo piatto in acciaio (polo −), con un piccolo bordo smussato.
  const steelBottom = lathe([
    v2(0, -T - 0.02),
    v2(R - 0.9, -T - 0.02),
    v2(R - 0.5, -T + 0.2),
    v2(R - 0.5, -T + 0.6),
    v2(0, -T + 0.6),
  ]);
  return { sleeve, steelTop, ring, button, steelBottom };
}

export class PackScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
  private controls: OrbitControls;
  private cellsRoot = new THREE.Group();
  private plane!: THREE.Mesh;
  private grid!: THREE.GridHelper;
  private planeMaterial = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  private gridColor = new THREE.Color(0xdddddd);
  private groundKey = '';
  private groundStep = 10;
  private nodes = new Map<string, CellNode>();
  private geometries = new Map<string, CellGeometries>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private steelMat = new THREE.MeshStandardMaterial({ color: 0xc8cdd2, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
  private buttonMat = new THREE.MeshStandardMaterial({ color: 0xe2e5e8, roughness: 0.22, metalness: 0.95, side: THREE.DoubleSide });
  private ringMat = new THREE.MeshStandardMaterial({ color: RING_COLOR, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private envTexture: THREE.Texture | null = null;
  private observer: ResizeObserver;
  private media = window.matchMedia('(prefers-color-scheme: dark)');
  private offTheme: () => void = () => {};
  private frame = 0;
  private disposed = false;
  private busRoot = new THREE.Group();
  private harnessRoot = new THREE.Group();
  private harnessShown: Harness | null = null;
  private harnessMats: THREE.Material[] = [];
  private holderRoot = new THREE.Group();
  private holderShown: HolderModel | null = null;
  private holderMat = new THREE.MeshStandardMaterial({ color: 0x353b41, roughness: 0.62, metalness: 0.05 });
  private busKey: { strips: readonly Strip[]; thickness: number; height: number; lift: number } | null = null;
  private busMat = new THREE.MeshStandardMaterial({ color: 0xb4bac0, roughness: 0.35, metalness: 0.85 });
  private lastFitRadius = 0;
  private preset: ViewPreset = 'iso';

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    // Mappa d'ambiente: senza, l'acciaio riflette il nulla e appare nero.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.38;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 0.18));
    this.sun.position.set(200, 400, 300);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.sun.shadow.radius = 3;
    this.sun.shadow.intensity = 0.85;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.cellsRoot);
    this.scene.add(this.busRoot);
    this.scene.add(this.harnessRoot);
    this.scene.add(this.holderRoot);

    this.buildGround(300, 10);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', this.requestRender);

    this.applyTheme();
    this.media.addEventListener('change', this.onTheme);
    this.offTheme = onThemeChange(this.onTheme);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private onTheme = () => {
    this.applyTheme();
    this.requestRender();
  };

  /** Prende i colori dal tema dell'app (variabili CSS), così il 3D segue chiaro/scuro. */
  private applyTheme() {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    this.scene.background = new THREE.Color(read('--canvas', '#fbfbf9'));
    this.planeMaterial.color.set(read('--bg', '#f6f6f3'));
    this.gridColor.set(read('--line', '#dcdcd6'));
    this.paintGrid();
  }

  private paintGrid() {
    const mats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const m of mats) (m as THREE.LineBasicMaterial).color.copy(this.gridColor);
  }

  /**
   * Piano e griglia grandi quanto serve al pacco: una griglia enorme, vista di taglio, produce
   * un effetto moiré. Si ricostruiscono solo se la dimensione cambia.
   */
  private buildGround(size: number, step: number) {
    const key = `${size}/${step}`;
    if (key === this.groundKey) return;
    this.groundKey = key;
    this.groundStep = step;
    const visible = this.plane ? this.plane.visible : true;
    const at = this.plane ? this.plane.position.clone() : new THREE.Vector3();
    if (this.plane) {
      this.scene.remove(this.plane, this.grid);
      this.plane.geometry.dispose();
      this.grid.geometry.dispose();
      for (const m of Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) m.dispose();
    }
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.planeMaterial);
    this.plane.receiveShadow = true;
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.set(at.x, -0.2, at.z);
    this.grid = new THREE.GridHelper(size, size / step);
    this.grid.position.set(at.x, -0.1, at.z);
    this.plane.visible = this.grid.visible = visible;
    this.paintGrid();
    this.scene.add(this.plane, this.grid);
  }

  private resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender = () => {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  };

  private geometryFor(radius: number, height: number, key: string) {
    let g = this.geometries.get(key);
    if (!g) {
      g = buildCellGeometries(radius, height);
      this.geometries.set(key, g);
    }
    return g;
  }

  private materialFor(group: number | null, selected: boolean) {
    const key = `${group ?? 'n'}-${selected ? 1 : 0}`;
    let m = this.materials.get(key);
    if (!m) {
      const color =
        group === null
          ? new THREE.Color(UNGROUPED_COLOR)
          : new THREE.Color().setHSL(groupHue(group) / 360, 0.7, 0.45);
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.38, // guaina in PVC lucido
        metalness: 0,
        side: THREE.DoubleSide,
        emissive: selected ? new THREE.Color(SELECT_COLOR) : new THREE.Color(0x000000),
        emissiveIntensity: selected ? 0.55 : 0,
      });
      this.materials.set(key, m);
    }
    return { key, material: m };
  }

  private removeNode(id: string) {
    const node = this.nodes.get(id);
    if (!node) return;
    this.cellsRoot.remove(node.root); // le geometrie e i materiali sono condivisi: si liberano in dispose()
    this.nodes.delete(id);
  }

  update(project: Project, options: SceneOptions): void {
    if (this.disposed) return;
    const offsets = explodeOffsets(project, options.explosionMm);
    const seen = new Set<string>();

    for (const c of project.cells) {
      const type = findCellType(project, c.typeId);
      if (!type) continue;
      seen.add(c.id);
      const geometryKey = `${type.diameterMm}x${type.heightMm}`;
      let node = this.nodes.get(c.id);
      if (node && node.geometryKey !== geometryKey) {
        this.removeNode(c.id);
        node = undefined;
      }
      if (!node) {
        const g = this.geometryFor(type.diameterMm / 2, type.heightMm, geometryKey);
        const sleeve = new THREE.Mesh(g.sleeve);
        sleeve.castShadow = true;
        sleeve.receiveShadow = true;
        const parts = [
          new THREE.Mesh(g.steelTop, this.steelMat),
          new THREE.Mesh(g.ring, this.ringMat),
          new THREE.Mesh(g.button, this.buttonMat),
          new THREE.Mesh(g.steelBottom, this.steelMat),
        ];
        const root = new THREE.Group();
        root.add(sleeve, ...parts);
        node = { root, sleeve, geometryKey, materialKey: '' };
        this.nodes.set(c.id, node);
        this.cellsRoot.add(root);
      }
      const { key, material } = this.materialFor(c.group, options.selected.has(c.id));
      if (node.materialKey !== key) {
        node.sleeve.material = material;
        node.materialKey = key;
      }
      const off = offsets.get(c.id);
      node.root.position.set(c.x + (off?.dx ?? 0), type.heightMm / 2, c.y + (off?.dy ?? 0));
      node.root.rotation.x = c.plusUp ? 0 : Math.PI; // polo + verso il basso: cella capovolta
    }
    for (const id of [...this.nodes.keys()]) if (!seen.has(id)) this.removeNode(id);

    this.updateBus(project, options);
    this.updateHarness(options);
    this.updateHolder(options);
    this.cellsRoot.visible = options.showCells;
    this.plane.visible = options.showPlane;
    this.grid.visible = options.showPlane;

    // Il piano segue il pacco (agganciato a 10 mm per tenere allineate le linee della griglia).
    const b = boundsOfCells(project);
    if (b) {
      const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 2 * options.explosionMm;
      const size = Math.max(300, Math.ceil((extent * 2.5) / 100) * 100);
      this.buildGround(size, size > 600 ? 50 : 10);
      const st = this.groundStep;
      const sx = Math.round((b.minX + b.maxX) / 2 / st) * st;
      const sz = Math.round((b.minY + b.maxY) / 2 / st) * st;
      const down = this.holderRoot.visible && this.holderShown ? this.holderShown.floorMm : 0;
      this.plane.position.y = -0.2 - down;
      this.grid.position.y = -0.1 - down;
      this.plane.position.x = this.grid.position.x = sx;
      this.plane.position.z = this.grid.position.z = sz;
      this.aimSun((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, extent);
      // Se il pacco è cambiato molto di dimensione, reinquadra con la vista corrente.
      const radius = this.packRadius(project);
      if (this.lastFitRadius === 0 || radius > this.lastFitRadius * 1.3 || radius < this.lastFitRadius * 0.6) {
        this.setView(this.preset, project);
      }
    }
    this.requestRender();
  }

  /** Lamelle: ogni contorno diventa un foglio sottile sopra (a quota cella) o sotto (a quota 0). */
  private updateHolder(options: SceneOptions) {
    const model = options.holder ?? null;
    this.holderRoot.visible = !!model && options.explosionMm === 0;
    this.holderMat.color.set(options.holderColor ?? '#353b41');
    for (const m of this.holderRoot.children) m.visible = m.userData.half === 'top' ? options.holderTop !== false : options.holderBottom !== false;
    if (model === this.holderShown) return;
    for (const m of [...this.holderRoot.children] as THREE.Mesh[]) {
      m.geometry.dispose();
      this.holderRoot.remove(m);
    }
    this.holderShown = model;
    if (!model) return;
    for (const half of ['top', 'bottom'] as const) {
      for (const raw of holderHalfGeometries(model, half)) {
        // i cerchi sono poligoni: normali "a spigolo" solo oltre 35°, così pareti e rampe sembrano lisce e i bordi veri restano netti
        const g = toCreasedNormals(raw, (35 * Math.PI) / 180);
        raw.dispose();
        const mesh = new THREE.Mesh(g, this.holderMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.half = half;
        mesh.visible = half === 'top' ? options.holderTop !== false : options.holderBottom !== false;
        this.holderRoot.add(mesh);
      }
    }
  }

  private updateBus(project: Project, options: SceneOptions) {
    const strips = options.strips ?? null;
    // Nella vista esplosa le celle si spostano ma le lamelle no: meglio nasconderle.
    this.busRoot.visible = !!strips && options.explosionMm === 0;
    if (!strips) return;
    this.busMat.color.set(options.stripColor ?? '#b4bac0');
    const thickness = Math.max(0.3, options.stripThicknessMm ?? 0.3);
    let height = 0;
    let lift = 0; // il bottone sporge dal bordo della cella: la lamella si appoggia sopra
    for (const c of project.cells) {
      const type = findCellType(project, c.typeId);
      if (!type) continue;
      height = Math.max(height, type.heightMm);
      lift = Math.max(lift, Math.min(1.1, (type.diameterMm / 2) * 0.12));
    }
    const k = this.busKey;
    if (k && k.strips === strips && k.thickness === thickness && k.height === height && k.lift === lift) return;
    for (const m of [...this.busRoot.children] as THREE.Mesh[]) {
      m.geometry.dispose();
      this.busRoot.remove(m);
    }
    for (const s of strips) {
      const top = s.face === 'top';
      const sheetY = top ? height + lift + thickness : -lift;
      const add = (geo: THREE.BufferGeometry, mesh?: (m: THREE.Mesh) => void) => {
        const m = new THREE.Mesh(geo, this.busMat);
        mesh?.(m);
        m.castShadow = true;
        m.receiveShadow = true;
        this.busRoot.add(m);
      };
      const extrude = (r: Region) => {
        const shape = new THREE.Shape(r.outline.map((p) => new THREE.Vector2(p.x, p.y)));
        for (const h of r.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
        return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
      };
      const region: Region = { outline: s.outline, holes: s.holes };
      const folds = tabsOf(s);
      if (folds.length === 0) {
        const geo = extrude(region);
        geo.rotateX(Math.PI / 2); // y del disegno -> Z, l'estrusione scende lungo -Y
        add(geo, (m) => (m.position.y = sheetY));
        continue;
      }
      // Ogni linguetta si piega a 90° sulla sua linea di piega: verso il basso (faccia sopra) o verso l'alto (faccia sotto).
      const BIG = 1000;
      const frame = (tab: (typeof folds)[number]) => {
        const d = SIDE_VECTOR[tab.side];
        const perp = { x: -d.y, y: d.x };
        const mid = { x: (tab.bend[0].x + tab.bend[1].x) / 2, y: (tab.bend[0].y + tab.bend[1].y) / 2 };
        const quad = (u0: number, u1: number): { x: number; y: number }[] =>
          [[u0, -BIG], [u1, -BIG], [u1, BIG], [u0, BIG]].map(([u, v]) => ({ x: mid.x + d.x * u! + perp.x * v!, y: mid.y + d.y * u! + perp.y * v! }));
        return { d, perp, mid, quad };
      };
      // Parte piana: quella che sta prima di tutte le linee di piega.
      let flat: Region[] = [region];
      for (const tab of folds) {
        const { quad } = frame(tab);
        flat = flat.flatMap((r) => intersectRegions(r, [quad(-BIG, 0)]));
      }
      for (const r of flat) {
        const geo = extrude(r);
        geo.rotateX(Math.PI / 2);
        add(geo, (m) => (m.position.y = sheetY));
      }
      // Pezzi piegati: disegnati in (u lungo la linguetta, v di lato) e poi messi in piedi sul bordo della lamella.
      const sy = top ? -1 : 1;
      const xAxis = new THREE.Vector3(0, sy, 0);
      for (const tab of folds) {
        const { d, perp, mid, quad } = frame(tab);
        const yAxis = new THREE.Vector3(perp.x, 0, perp.y);
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
        const outward = new THREE.Vector3(d.x, 0, d.y);
        for (const r of intersectRegions(region, [quad(0, BIG)])) {
          const local = (p: { x: number; y: number }) => {
            const dx = p.x - mid.x;
            const dy = p.y - mid.y;
            return new THREE.Vector2(dx * d.x + dy * d.y, dx * perp.x + dy * perp.y);
          };
          const shape = new THREE.Shape(r.outline.map(local));
          for (const h of r.holes) shape.holes.push(new THREE.Path(h.map(local)));
          const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
          if (zAxis.dot(outward) < 0) geo.translate(0, 0, -thickness); // lo spessore resta verso l'esterno
          add(geo, (m) => {
            m.matrixAutoUpdate = false;
            m.matrix.makeBasis(xAxis, yAxis, zAxis).setPosition(mid.x, top ? sheetY : sheetY - thickness, mid.y);
            m.matrixWorldNeedsUpdate = true;
          });
        }
      }
    }
    this.busKey = { strips, thickness, height, lift };
  }

  /** BMS come scatola contro il fianco e fili come tubi sottili dalle linguette al connettore. */
  private updateHarness(options: SceneOptions) {
    const h = options.harness ?? null;
    this.harnessRoot.visible = !!h && options.explosionMm === 0;
    if (h === this.harnessShown) return;
    for (const m of [...this.harnessRoot.children] as THREE.Mesh[]) {
      m.geometry.dispose();
      this.harnessRoot.remove(m);
    }
    for (const m of this.harnessMats) m.dispose();
    this.harnessMats = [];
    this.harnessShown = h;
    if (!h) return;
    const mat = (color: number, rough = 0.5) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
      this.harnessMats.push(m);
      return m;
    };
    if (h.box) {
      const geo = new THREE.BoxGeometry(h.box.size.x, h.box.size.y, h.box.size.z);
      // Un po' trasparente, così si vedono i fili dietro la scheda (le linguette) e quelli che arrivano al connettore.
      const boxMat = mat(0x1f7a4a, 0.6) as THREE.MeshStandardMaterial;
      boxMat.transparent = true;
      boxMat.opacity = 0.55;
      boxMat.depthWrite = false;
      const mesh = new THREE.Mesh(geo, boxMat);
      mesh.position.set(h.box.center.x, h.box.center.y, h.box.center.z);
      mesh.renderOrder = 2;
      this.harnessRoot.add(mesh);
    }
    for (const w of h.wires) {
      const path = new THREE.CurvePath<THREE.Vector3>();
      const pts = w.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      for (let i = 0; i + 1 < pts.length; i++) path.add(new THREE.LineCurve3(pts[i]!, pts[i + 1]!));
      const geo = new THREE.TubeGeometry(path, 24 * path.curves.length, 0.45, 6, false);
      // Colori come in un pacco vero: B0 (meno) nero, BS (più) rosso, gli intermedi bianchi.
      const last = Math.max(...h.wires.map((x) => x.node));
      const color = w.node === 0 ? 0x1b1b1b : w.node === last ? 0xd32f2f : 0xf2f2f2;
      const mesh = new THREE.Mesh(geo, mat(color, 0.55));
      mesh.castShadow = true;
      this.harnessRoot.add(mesh);
    }
  }

  /** Il sole segue il pacco e la sua ombra copre esattamente l'area utile (più nitida). */
  private aimSun(cx: number, cz: number, extent: number) {
    const reach = Math.max(extent, 60) * 0.85;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - reach * 1.5, reach * 1.6, cz + reach * 0.5);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -reach * 1.1;
    cam.right = cam.top = reach * 1.1;
    cam.near = 1;
    cam.far = reach * 8;
    cam.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
  }

  private packRadius(project: Project): number {
    const b = boundsOfCells(project);
    if (!b) return 50;
    let h = 0;
    for (const c of project.cells) h = Math.max(h, findCellType(project, c.typeId)?.heightMm ?? 0);
    return 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY, h);
  }

  /** Porta la camera su una delle viste predefinite, inquadrando tutto il pacco. */
  setView(preset: ViewPreset, project: Project): void {
    if (this.disposed) return;
    this.preset = preset;
    const b = boundsOfCells(project);
    let height = 70;
    for (const c of project.cells) height = Math.max(height, findCellType(project, c.typeId)?.heightMm ?? 0);
    const center = b
      ? new THREE.Vector3((b.minX + b.maxX) / 2, height / 2, (b.minY + b.maxY) / 2)
      : new THREE.Vector3(0, height / 2, 0);
    const radius = Math.max(this.packRadius(project), 20);
    const dist = (radius / Math.sin((FOV * Math.PI) / 360)) * 1.1;
    const dirs: Record<ViewPreset, [number, number, number]> = {
      iso: [1, 0.85, 1],
      top: [0, 1, 0.02], // dall'alto: x verso destra e y verso il basso, come nel disegno 2D
      front: [0, 0.12, 1],
      side: [1, 0.12, 0],
    };
    const dir = new THREE.Vector3(...dirs[preset]).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.5, dist / 100);
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.lastFitRadius = this.packRadius(project);
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.media.removeEventListener('change', this.onTheme);
    this.offTheme();
    this.controls.removeEventListener('change', this.requestRender);
    this.controls.dispose();
    for (const g of this.geometries.values()) {
      g.sleeve.dispose();
      g.steelTop.dispose();
      g.ring.dispose();
      g.button.dispose();
      g.steelBottom.dispose();
    }
    for (const m of this.materials.values()) m.dispose();
    this.steelMat.dispose();
    this.buttonMat.dispose();
    this.ringMat.dispose();
    for (const m of this.busRoot.children as THREE.Mesh[]) m.geometry.dispose();
    for (const m of this.holderRoot.children as THREE.Mesh[]) m.geometry.dispose();
    for (const m of this.harnessRoot.children as THREE.Mesh[]) m.geometry.dispose();
    for (const m of this.harnessMats) m.dispose();
    this.holderMat.dispose();
    this.busMat.dispose();
    this.envTexture?.dispose();
    this.sun.shadow.map?.dispose();
    this.plane.geometry.dispose();
    this.planeMaterial.dispose();
    this.grid.geometry.dispose();
    for (const m of Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
