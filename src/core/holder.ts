import { findCellType } from './catalog';
import { digitPolygons } from './engrave';
import { convexHull } from './polygon';
import { circlePolygon, closeRegions, differenceRegions, offsetRegions, regionArea, unionAll, type Region } from './clip';
import type { Rect } from './geometry';
import type { Pt } from './polygon';
import type { HolderSplit } from './holderSplit';
import type { Project } from './types';
import { t } from '../i18n';
import { len, lenLabel, lenNum, temp } from '../units';

/**
 * Portacelle monolitico a due piastre (sopra e sotto). Ogni piastra è un "cappuccio":
 *  - un fondo sottile (`floorMm`) che appoggia sul bordo del polo, con un foro per il terminale;
 *  - le pareti (`lipMm`) che avvolgono le celle, con una tasca per cella (raggio + gioco).
 * Le due piastre hanno lo stesso disegno in pianta; il pacco finito è alto «altezza celle + 2 fondi».
 * La sagoma esterna segue le celle, con gli angoli concavi raccordati e il bordo esterno smussato.
 */

export type HolderShape = 'profile' | 'rounded';

export interface HolderSettings {
  /** Spessore della parete attorno alle celle, mm. */
  wallMm: number;
  /** Gioco per lato tra cella e tasca, mm. */
  clearanceMm: number;
  /** Spessore del fondo (il bordo che trattiene la cella), mm. */
  floorMm: number;
  /** Quanto le pareti avvolgono la cella, mm. */
  lipMm: number;
  /** Larghezza del bordo di ritenzione sopra il polo, mm: il foro ha raggio R − bordo. */
  ledgeMm: number;
  /** `profile`: la sagoma segue le celle; `rounded`: contorno convesso con gli angoli arrotondati. */
  shape: HolderShape;
  /** Raggio di raccordo degli angoli concavi della sagoma, mm (0 = angoli vivi). Solo con `profile`. */
  filletMm: number;
  /** Smusso del bordo esterno, mm (0 = nessuno). */
  chamferMm: number;
  /** Con il fondo che blocca le celle sul lato dei poli; spento, le pareti sono aperte da parte a parte. */
  lockCells: boolean;
  /** Piano di stampa (area utile), mm. */
  bedXMm: number;
  bedYMm: number;
}

export const DEFAULT_HOLDER_SETTINGS: HolderSettings = {
  wallMm: 1.6,
  clearanceMm: 0.15,
  floorMm: 0.6,
  lipMm: 8,
  ledgeMm: 0.8,
  shape: 'profile',
  filletMm: 3,
  chamferMm: 0.6,
  lockCells: true,
  bedXMm: 220,
  bedYMm: 220,
};

/** Spessore minimo di parete tra due tasche per stamparla bene (due passate con ugello da 0,4). */
export const MIN_PRINT_WALL_MM = 0.8;

/** Vuoti tra le celle più piccoli di così (mm²) vengono riempiti di plastica. */
export const MIN_OPEN_GAP_MM2 = 25;

/** Passo dello smusso: come lo strato di una stampa tipica, 0,2 mm. */
const CHAMFER_STEP_MM = 0.2;

/** Una fetta della piastra: forme da `z0` a `z1`, con z misurato dalla faccia esterna del fondo verso il bordo delle pareti. */
export interface HolderLayer {
  z0: number;
  z1: number;
  regions: Region[];
}

export interface HolderModel {
  settings: HolderSettings;
  /** Altezza delle celle usata per le due piastre (la più alta). */
  cellHeightMm: number;
  /** Profondità reale delle pareti (limitata a metà cella). */
  lipMm: number;
  /** Spessore reale del fondo (0 se le celle non sono bloccate). */
  floorMm: number;
  /** Spessore totale di una piastra: fondo + pareti. */
  totalMm: number;
  /** Smusso effettivo, mm. */
  chamferMm: number;
  /** Fondo: sagoma esterna con i fori dei terminali (vuoto se le celle non sono bloccate). */
  slab: Region[];
  /** Pareti: sagoma esterna con le tasche delle celle. */
  wall: Region[];
  /** Fette della piastra, dalla faccia esterna al bordo delle pareti. */
  layers: HolderLayer[];
  /**
   * Smusso a rampa continua (solo con `smooth`): le fette arretrano di `chamferMm` sulle due facce e lo smusso
   * è il raccordo inclinato tra il contorno pieno (`a`) e quello arretrato (`b`). Coppie di contorni corrispondenti.
   */
  ramp: { contours: { a: Pt[]; b: Pt[] }[] } | null;
  /** Diametro del foro del terminale sulla cella più piccola, mm (null se non c'è il fondo). */
  openingDiameterMm: number | null;
  /** Ingombro in pianta. */
  bounds: Rect;
}

export type HolderIssueLevel = 'error' | 'warning' | 'info';
export interface HolderIssue {
  level: HolderIssueLevel;
  text: string;
}

export interface HolderReport {
  widthMm: number;
  depthMm: number;
  /** Altezza totale del pacco col portacelle: celle + due fondi. */
  totalHeightMm: number;
  /** Parete più sottile tra due tasche vicine, mm (null con una sola cella). */
  minWallBetweenMm: number | null;
  /** Volume di plastica di una piastra, mm³. */
  volumeMm3: number;
  /** Pezzi in cui si divide ogni piastra (1 se entra nel piano). */
  pieces: number;
  issues: HolderIssue[];
}

const regionsArea = (rs: readonly Region[]) => rs.reduce((s, r) => s + regionArea(r), 0);

function boundsOf(regions: readonly Region[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of regions) {
    for (const p of r.outline) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Costruisce le sagome delle due piastre. Null se non ci sono celle. */
const centroidOf = (pts: readonly Pt[]): Pt => ({
  x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
  y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
});

/** Accoppia i contorni di `A` con quelli di `B` per vicinanza dei baricentri; null se non sono quanti i primi. */
function matchContours(A: readonly Pt[][], B: readonly Pt[][]): { a: Pt[]; b: Pt[] }[] | null {
  if (A.length !== B.length) return null;
  const free = new Set(B.map((_, i) => i));
  const out: { a: Pt[]; b: Pt[] }[] = [];
  for (const a of A) {
    const ca = centroidOf(a);
    let best = -1;
    let bestD = Infinity;
    for (const i of free) {
      const cb = centroidOf(B[i]!);
      const d = (ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    free.delete(best);
    out.push({ a, b: B[best]! });
  }
  return out;
}

/** Contorni pieni e arretrati accoppiati (contorno esterno e buchi di ogni regione); null se l'arretramento cambia la topologia. */
function rampContours(outer: readonly Region[], inner: readonly Region[]): { a: Pt[]; b: Pt[] }[] | null {
  const regions = matchContours(outer.map((r) => r.outline), inner.map((r) => r.outline));
  if (!regions) return null;
  const out = [...regions];
  for (const m of regions) {
    const ro = outer.find((r) => r.outline === m.a)!;
    const ri = inner.find((r) => r.outline === m.b)!;
    const holes = matchContours(ro.holes, ri.holes);
    if (!holes) return null;
    out.push(...holes);
  }
  return out;
}


/** Opzioni per i pezzi speciali (pezzo test); il portacelle normale non ne usa. */
export interface BuildOptions {
  /** Gioco per cella (stesso ordine di `project.cells`) al posto di `settings.clearanceMm`. */
  clearances?: readonly number[];
  /** Forme piene da unire alla sagoma esterna (per esempio una striscia per le scritte). */
  addOuter?: readonly (readonly Pt[])[];
  /** Forme da incidere sul bordo delle pareti, per `engraveMm` di profondità. */
  engrave?: readonly (readonly Pt[])[];
  engraveMm?: number;
  /** Tacche da togliere alla sagoma esterna (scanalature per i fili): su tutto lo spessore della piastra. */
  notches?: readonly (readonly Pt[])[];
}

/**
 * Con `smooth` lo smusso non è una scala di gradini (che serve solo se vuoi vederli come strati di stampa) ma una
 * rampa inclinata continua: le fette restano poche e in `ramp` ci sono i contorni da raccordare.
 */
export function buildHolder(
  project: Project,
  settings: HolderSettings = DEFAULT_HOLDER_SETTINGS,
  smooth = false,
  opts: BuildOptions = {},
): HolderModel | null {
  const { clearances } = opts;
  const cells = project.cells.flatMap((c, i) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ c, r: t.diameterMm / 2, h: t.heightMm, cl: clearances?.[i] ?? settings.clearanceMm }] : [];
  });
  if (cells.length === 0) return null;
  const s = settings;
  const cellHeightMm = Math.max(...cells.map((x) => x.h));
  const floorMm = s.lockCells ? s.floorMm : 0;
  const lipMm = Math.max(1, Math.min(s.lipMm, cellHeightMm / 2 - 1 - floorMm));
  const totalMm = floorMm + lipMm;
  // lo smusso non può mangiare tutta la parete né più di metà piastra
  const chamferMm = Math.max(0, Math.min(s.chamferMm, s.wallMm * 0.75, totalMm / 2 - 0.05));

  const merged = unionAll([...cells.map(({ c, r, cl }) => circlePolygon(c.x, c.y, r + cl + s.wallMm)), ...(opts.addOuter ?? [])]);
  let outer: Region[];
  if (s.shape === 'rounded') {
    // Contorno convesso di ogni gruppo di celle: i bordi tondi sono gli archi delle celle d'angolo.
    outer = unionAll(merged.map((reg) => convexHull(reg.outline)));
  } else {
    // Raccordo degli angoli concavi; le fessure minuscole che restano non si stampano: si riempiono.
    outer = closeRegions(merged, s.filletMm).map((reg) => ({
      outline: reg.outline,
      holes: reg.holes.filter((hole) => regionArea({ outline: hole, holes: [] }) >= MIN_OPEN_GAP_MM2),
    }));
  }
  if (opts.notches && opts.notches.length > 0) outer = differenceRegions(outer, opts.notches);
  const pockets = cells.map(({ c, r, cl }) => circlePolygon(c.x, c.y, r + cl));
  const openings = cells.map(({ c, r }) => circlePolygon(c.x, c.y, Math.max(r - s.ledgeMm, 1)));
  const wall = differenceRegions(outer, pockets);
  const slab = s.lockCells ? differenceRegions(outer, openings) : [];

  // Smusso a rampa: contorno arretrato e coppie di contorni da raccordare (se la topologia regge).
  let ramp: HolderModel['ramp'] = null;
  if (smooth && chamferMm > 0) {
    const contours = rampContours(outer, offsetRegions(outer, -chamferMm));
    if (contours) ramp = { contours };
  }

  // Fette: ai bordi dello smusso la sagoma esterna si ritira a gradini; sotto `floorMm` si taglia con i fori, sopra con le tasche.
  const engrave = opts.engrave && opts.engrave.length > 0 ? opts.engrave : null;
  const engraveFromZ = totalMm - Math.max(0, Math.min(opts.engraveMm ?? 0, totalMm - floorMm - 0.4));
  const cuts = new Set<number>([0, floorMm, totalMm]);
  if (engrave) cuts.add(engraveFromZ);
  if (ramp) {
    cuts.add(chamferMm);
    cuts.add(totalMm - chamferMm);
  } else if (chamferMm > 0) {
    const n = Math.max(1, Math.ceil(chamferMm / CHAMFER_STEP_MM - 1e-9));
    for (let i = 0; i <= n; i++) {
      cuts.add((chamferMm * i) / n);
      cuts.add(totalMm - (chamferMm * i) / n);
    }
  }
  const zs = [...cuts].map((z) => Math.round(z * 1e6) / 1e6).sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1]! > 1e-6);
  const cache = new Map<string, Region[]>();
  const layers: HolderLayer[] = [];
  let lastKey = '';
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i]!;
    const z1 = zs[i + 1]!;
    const mid = (z0 + z1) / 2;
    const inset = ramp
      ? mid < chamferMm || mid > totalMm - chamferMm
        ? chamferMm
        : 0
      : chamferMm > 0
        ? Math.max(0, chamferMm - mid, mid - (totalMm - chamferMm))
        : 0;
    const useSlab = s.lockCells && mid < floorMm;
    const engraved = !!engrave && mid > engraveFromZ && !useSlab;
    const key = `${inset.toFixed(4)}|${useSlab ? 's' : 'w'}${engraved ? 'e' : ''}`;
    let regions = cache.get(key);
    if (!regions) {
      regions = differenceRegions(inset > 1e-9 ? offsetRegions(outer, -inset) : outer, useSlab ? openings : pockets);
      if (engraved) regions = differenceRegions(regions, engrave!);
      cache.set(key, regions);
    }
    const prev = layers[layers.length - 1];
    if (prev && key === lastKey) prev.z1 = z1;
    else layers.push({ z0, z1, regions });
    lastKey = key;
  }

  const minR = Math.min(...cells.map((x) => x.r));
  return {
    settings: s,
    cellHeightMm,
    lipMm,
    floorMm,
    totalMm,
    chamferMm,
    slab,
    wall,
    layers,
    ramp,
    openingDiameterMm: s.lockCells ? 2 * Math.max(minR - s.ledgeMm, 1) : null,
    bounds: boundsOf(outer),
  };
}

/** Volume dei due cunei dello smusso a rampa: corona tra contorno pieno e arretrato, per metà dello smusso, su ciascuna faccia. */
function rampVolume(model: HolderModel): number {
  if (!model.ramp) return 0;
  const area = (pts: Pt[]) => regionArea({ outline: pts, holes: [] });
  return model.ramp.contours.reduce((v, c) => v + Math.abs(area(c.a) - area(c.b)), 0) * model.chamferMm;
}

/** Entra nel piano di stampa, anche ruotando di 90°. */
export const fitsBed = (w: number, d: number, s: Pick<HolderSettings, 'bedXMm' | 'bedYMm'>) =>
  (w <= s.bedXMm && d <= s.bedYMm) || (w <= s.bedYMm && d <= s.bedXMm);

export function analyzeHolder(project: Project, model: HolderModel, split: HolderSplit | null = null): HolderReport {
  const s = model.settings;
  const widthMm = model.bounds.maxX - model.bounds.minX;
  const depthMm = model.bounds.maxY - model.bounds.minY;
  const issues: HolderIssue[] = [];

  let minWall: number | null = null;
  const list = project.cells.flatMap((c) => {
    const t = findCellType(project, c.typeId);
    return t ? [{ x: c.x, y: c.y, r: t.diameterMm / 2 }] : [];
  });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > a.r + b.r + 8) continue;
      const wall = d - a.r - b.r - 2 * s.clearanceMm;
      if (minWall === null || wall < minWall) minWall = wall;
    }
  }
  if (minWall !== null) {
    if (minWall <= 0) {
      issues.push({
        level: 'error',
        text: t('holder.issue.overlap'),
      });
    } else if (minWall < MIN_PRINT_WALL_MM) {
      issues.push({
        level: 'warning',
        text: t('holder.issue.thinWall', { wall: len(minWall, 2), min: len(MIN_PRINT_WALL_MM, 1) }),
      });
    }
  }

  const bedArgs = { w: lenNum(widthMm, 0), d: lenNum(depthMm, 0), bx: lenNum(s.bedXMm, 0), by: lenNum(s.bedYMm, 0), u: lenLabel() };
  if (split) {
    // troppo grande per il piano: divisa in pezzi (e, se qualcuno non entra nemmeno così, avviso)
    issues.push({ level: 'info', text: t('holder.issue.split', { ...bedArgs, n: split.pieces.length, ids: split.pieces.map((p) => p.id).join(', ') }) });
    if (!split.allFit) {
      issues.push({ level: 'warning', text: t('holder.issue.pieceBed', { ids: split.pieces.filter((p) => !p.fits).map((p) => p.id).join(', ') }) });
    }
  } else if (!fitsBed(widthMm, depthMm, s)) {
    issues.push({ level: 'warning', text: t('holder.issue.bed', bedArgs) });
  }
  if (model.lipMm < s.lipMm - 1e-9) {
    issues.push({ level: 'info', text: t('holder.issue.lip', { lip: len(model.lipMm, 1) }) });
  }
  if (model.chamferMm < s.chamferMm - 1e-9) {
    issues.push({ level: 'info', text: t('holder.issue.chamfer', { chamfer: len(model.chamferMm, 2) }) });
  }
  if (!s.lockCells) {
    issues.push({ level: 'info', text: t('holder.issue.noFloor') });
  }
  issues.push({
    level: 'info',
    text: t('holder.issue.material', { temp: temp(60, 0) }),
  });

  return {
    widthMm,
    depthMm,
    totalHeightMm: model.cellHeightMm + 2 * model.floorMm,
    minWallBetweenMm: minWall,
    volumeMm3: model.layers.reduce((v, l) => v + regionsArea(l.regions) * (l.z1 - l.z0), 0) + rampVolume(model),
    pieces: split?.pieces.length ?? 1,
    issues,
  };
}

/** Profondità delle pareti del pezzo test, mm: basta a sentire il gioco senza sprecare plastica. */
const TOLERANCE_TEST_LIP_MM = 4;
/** Cifre incise: altezza, tratto (due passate con ugello da 0,4) e profondità, mm. */
const TEST_DIGIT_MM = 5;
const TEST_STROKE_MM = 0.8;
const TEST_ENGRAVE_MM = 1;

export const DEFAULT_TEST_CLEARANCES_MM = [0.1, 0.2, 0.3];

/** Il gioco scritto sul pezzo: centesimi di mm, quindi 0,15 mm → «15». */
export const clearanceLabel = (clearanceMm: number) => String(Math.round(clearanceMm * 100));

/**
 * Pezzo test per tarare il gioco: una piastra bassa con una fila di tasche, ognuna con un gioco diverso
 * (dalla più stretta a sinistra alla più larga a destra). Sotto ogni tasca una striscia con il gioco inciso
 * in centesimi di mm («10» = 0,10 mm). Ha le stesse impostazioni del portacelle vero, così la prova vale
 * per quello che poi si stampa. Null se il tipo di cella non esiste o non ci sono giochi.
 */
export function buildToleranceTest(
  project: Pick<Project, 'customCellTypes'>,
  typeId: string,
  clearancesMm: readonly number[] = DEFAULT_TEST_CLEARANCES_MM,
  settings: HolderSettings = DEFAULT_HOLDER_SETTINGS,
): HolderModel | null {
  const t = findCellType(project, typeId);
  if (!t || clearancesMm.length === 0) return null;
  const clearances = [...clearancesMm].sort((a, b) => a - b);
  const r = t.diameterMm / 2;
  const clMax = clearances[clearances.length - 1]!;
  const pitch = t.diameterMm + 2 * clMax + settings.wallMm;
  const cells = clearances.map((_, i) => ({
    id: `test${i}`,
    typeId,
    x: i * pitch,
    y: 0,
    plusUp: true,
    group: null,
  }));
  const test: Project = { version: 1, name: 'test', customCellTypes: project.customCellTypes, cells };

  // striscia sotto la fila: parte dentro le tasche (che la bucano) e arriva sotto il raggio esterno
  const edge = r + clMax + settings.wallMm;
  const textY = edge + 1.2 + TEST_DIGIT_MM / 2;
  const strip: Pt[] = [
    { x: -edge, y: 0 },
    { x: (clearances.length - 1) * pitch + edge, y: 0 },
    { x: (clearances.length - 1) * pitch + edge, y: textY + TEST_DIGIT_MM / 2 + 1.2 },
    { x: -edge, y: textY + TEST_DIGIT_MM / 2 + 1.2 },
  ];
  const engrave = clearances.flatMap((cl, i) => digitPolygons(clearanceLabel(cl), i * pitch, textY + i * 0.021, TEST_DIGIT_MM, TEST_STROKE_MM));
  return buildHolder(test, { ...settings, lipMm: Math.min(settings.lipMm, TOLERANCE_TEST_LIP_MM) }, true, {
    clearances,
    addOuter: [strip],
    engrave,
    engraveMm: TEST_ENGRAVE_MM,
  });
}
