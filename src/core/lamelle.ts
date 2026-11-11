import { findMaterial, LAMELLA_MATERIALS, resistivityAt, volumetricHeat, type LamellaMaterial } from './materials';
import { regionDistance } from './clip';
import {
  CUTTER_PROFILES,
  WELDER_PROFILES,
  findCutter,
  findWelder,
  type CutterProfile,
  type WelderProfile,
} from './profiles';
import {
  COOLING,
  conductionDeltaTK,
  minAreaPeakMm2,
  minThicknessConductionMm,
  minThicknessThermalMm,
  spotCapacity,
  spotsNeeded,
  type CoolingId,
} from './sizing';
import { neckWidthMm, type Strip, type StripOptions } from './strips';
import type { Project } from './types';

/**
 * Analisi delle lamelle: spessore necessario, verifiche sulla saldatrice e sul taglio, alternative.
 * Il dimensionamento si fa sul caso peggiore tra tutte le lamelle, perché in pratica si usa un unico
 * foglio di un solo spessore.
 */

export interface LamellaSettings {
  materialId: string;
  /** Spessore del singolo strato, mm; null = automatico (il più sottile che basta). */
  thicknessMm: number | null;
  /** Strati sovrapposti (saldati insieme). */
  layers: number;
  welderId: string;
  cutterId: string;
  /** Corrente continua di progetto, A; null = la massima del pacco. */
  currentA: number | null;
  cooling: CoolingId;
  /** Aumento di temperatura ammesso a regime, K. */
  deltaTK: number;
  ambientC: number;
  /** Di quanto si scaldano le celle sopra l'ambiente, K: le estremità delle bande stanno a quella temperatura. */
  cellRiseK: number;
  /** Picco = corrente × fattore, per `peakSeconds` secondi, con aumento ammesso `peakDeltaTK`. */
  peakFactor: number;
  peakSeconds: number;
  peakDeltaTK: number;
  /** Bordo oltre il contatto, mm. */
  stripMarginMm: number;
  /** Diametro d'appoggio sulla cella, mm; null = automatico. */
  contactDiameterMm: number | null;
  /** Larghezza minima del collegamento, mm; null = automatica. */
  widthMm: number | null;
}

export const DEFAULT_LAMELLA_SETTINGS: LamellaSettings = {
  materialId: 'nichel-puro',
  thicknessMm: null,
  layers: 1,
  welderId: 'hobby',
  cutterId: 'manual',
  currentA: null,
  cooling: 'free',
  deltaTK: 25,
  ambientC: 25,
  cellRiseK: 15,
  peakFactor: 1.5,
  peakSeconds: 1,
  peakDeltaTK: 100,
  stripMarginMm: 1,
  contactDiameterMm: null,
  widthMm: null,
};

/** Parametri di forma delle lamelle ricavati dalle impostazioni. */
export const stripOptionsOf = (s: LamellaSettings): StripOptions => ({
  marginMm: s.stripMarginMm,
  contactDiameterMm: s.contactDiameterMm,
  widthMm: s.widthMm,
});

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface LamellaIssue {
  severity: IssueSeverity;
  message: string;
  stripIds: string[];
}

export interface StripReport {
  stripId: string;
  label: string;
  face: Strip['face'];
  /** Larghezza utile, mm. */
  neckMm: number;
  areaMm2: number;
  /** Corrente che attraversa il collo, A (nei terminali si assume il cavo al centro: metà). */
  neckCurrentA: number;
  /** Spessore totale richiesto dal criterio termico e da quello di picco, mm. */
  thermalMm: number;
  peakMm: number;
  requiredMm: number;
  /** Aumento di temperatura a regime con lo spessore scelto, K (null se non c'è uno spessore). */
  deltaTK: number | null;
  cellCurrentA: number;
  spotsNeeded: number;
  spotCapacity: number;
}

export interface LamellaReport {
  status: 'empty' | 'ok' | 'warning' | 'error';
  currentA: number;
  material: LamellaMaterial;
  welder: WelderProfile;
  cutter: CutterProfile;
  /** Spessore di un singolo strato, mm; null se nessuno basta. */
  thicknessMm: number | null;
  layers: number;
  totalThicknessMm: number | null;
  auto: boolean;
  /** Spessore totale richiesto dalla lamella più critica, mm. */
  requiredMm: number;
  strips: StripReport[];
  issues: LamellaIssue[];
  alternatives: string[];
  /** Area complessiva delle lamelle e massa di materiale, per l'ordine. */
  totalAreaCm2: number;
  massG: number | null;
}

const fmt = (n: number, d = 2) => n.toFixed(d).replace('.', ',');

interface Requirement {
  neckMm: number;
  neckCurrentA: number;
  thermalMm: number;
  peakMm: number;
  requiredMm: number;
}

function requirementFor(strip: Strip, material: LamellaMaterial, s: LamellaSettings, currentA: number): Requirement {
  const neck = neckWidthMm(strip);
  const neckCurrent =
    strip.kind === 'series' ? currentA / strip.parallelCount : currentA / 2;
  const h = COOLING[s.cooling].h;
  const rhoHot = resistivityAt(material, s.ambientC + s.deltaTK);
  const thermalInput = { currentA: neckCurrent, resistivityOhmM: rhoHot, deltaTK: s.deltaTK, hWm2K: h };
  // Una banda corta, saldata alle celle, scarica il calore verso di loro: conta la lunghezza libera.
  const thermal = minThicknessConductionMm(neck, {
    ...thermalInput,
    lengthMm: strip.bandLengthMm,
    conductivityWmK: material.conductivityWmK,
    endDeltaK: s.cellRiseK,
  });
  const rhoPeak = resistivityAt(material, s.ambientC + s.peakDeltaTK / 2);
  const area = minAreaPeakMm2({
    peakCurrentA: neckCurrent * s.peakFactor,
    resistivityOhmM: rhoPeak,
    volumetricHeatJm3K: volumetricHeat(material),
    durationS: s.peakSeconds,
    deltaTK: s.peakDeltaTK,
  });
  const peak = neck > 0 ? area / neck : 0;
  return { neckMm: neck, neckCurrentA: neckCurrent, thermalMm: thermal, peakMm: peak, requiredMm: Math.max(thermal, peak) };
}

/** Spessore totale richiesto dal caso peggiore con un dato materiale. */
export function worstRequiredMm(strips: readonly Strip[], material: LamellaMaterial, s: LamellaSettings, currentA: number): number {
  let worst = 0;
  for (const strip of strips) worst = Math.max(worst, requirementFor(strip, material, s, currentA).requiredMm);
  return worst;
}

/** Il più sottile spessore commerciale tale che strati·spessore ≥ richiesto. */
function smallestThickness(material: LamellaMaterial, layers: number, requiredMm: number): number | null {
  for (const t of material.thicknessesMm) if (t * layers >= requiredMm - 1e-9) return t;
  return null;
}

export function analyzeLamelle(
  project: Project,
  strips: readonly Strip[],
  settings: LamellaSettings,
  packCurrentA: number,
): LamellaReport {
  const material = findMaterial(settings.materialId) ?? LAMELLA_MATERIALS[0]!;
  const welder = findWelder(settings.welderId) ?? WELDER_PROFILES[0]!;
  const cutter = findCutter(settings.cutterId) ?? CUTTER_PROFILES[0]!;
  const currentA = settings.currentA ?? packCurrentA;
  const layers = Math.max(1, Math.floor(settings.layers));
  const issues: LamellaIssue[] = [];
  const alternatives: string[] = [];

  const base = {
    currentA,
    material,
    welder,
    cutter,
    layers,
    auto: settings.thicknessMm === null,
  };

  if (strips.length === 0) {
    return {
      ...base,
      status: 'empty',
      thicknessMm: null,
      totalThicknessMm: null,
      requiredMm: 0,
      strips: [],
      issues: [{ severity: 'info', message: 'Assegna le celle ai gruppi in serie per generare le lamelle.', stripIds: [] }],
      alternatives,
      totalAreaCm2: 0,
      massG: null,
    };
  }
  if (!(currentA > 0)) {
    issues.push({ severity: 'error', message: 'La corrente di progetto deve essere maggiore di zero.', stripIds: [] });
  }

  // --- Requisiti per ogni lamella
  const groupSize = new Map<number, number>();
  for (const c of project.cells) if (c.group !== null) groupSize.set(c.group, (groupSize.get(c.group) ?? 0) + 1);
  const reqs = strips.map((s) => requirementFor(s, material, settings, currentA));
  const requiredMm = Math.max(0, ...reqs.map((r) => r.requiredMm));

  // --- Spessore scelto
  let thicknessMm: number | null;
  if (settings.thicknessMm !== null) thicknessMm = settings.thicknessMm;
  else thicknessMm = smallestThickness(material, layers, requiredMm);
  const totalThicknessMm = thicknessMm === null ? null : thicknessMm * layers;
  const h = COOLING[settings.cooling].h;
  const rhoHot = resistivityAt(material, settings.ambientC + settings.deltaTK);

  // --- Rapporto per lamella
  const reports: StripReport[] = strips.map((s, i) => {
    const r = reqs[i]!;
    let maxCellCurrent = 0;
    for (const g of s.groups) maxCellCurrent = Math.max(maxCellCurrent, currentA / (groupSize.get(g) ?? 1));
    const need = spotsNeeded(maxCellCurrent, welder.spotCurrentA, welder.minSpotsPerTerminal);
    let cap = Infinity;
    for (const n of s.nodes) cap = Math.min(cap, spotCapacity(n.contactRadiusMm, welder.spotDiameterMm, welder.spotSpacingMm));
    return {
      stripId: s.id,
      label: s.label,
      face: s.face,
      neckMm: r.neckMm,
      areaMm2: s.areaMm2,
      neckCurrentA: r.neckCurrentA,
      thermalMm: r.thermalMm,
      peakMm: r.peakMm,
      requiredMm: r.requiredMm,
      deltaTK:
        totalThicknessMm === null
          ? null
          : conductionDeltaTK(r.neckMm, totalThicknessMm, {
              currentA: r.neckCurrentA,
              resistivityOhmM: rhoHot,
              deltaTK: settings.deltaTK,
              hWm2K: h,
              lengthMm: s.bandLengthMm,
              conductivityWmK: material.conductivityWmK,
              endDeltaK: Math.min(settings.cellRiseK, 0.8 * settings.deltaTK),
            }),
      cellCurrentA: maxCellCurrent,
      spotsNeeded: need,
      spotCapacity: Number.isFinite(cap) ? cap : 0,
    };
  });

  // --- Verifiche sullo spessore
  const critical = reports.reduce((a, b) => (b.requiredMm > a.requiredMm ? b : a));
  const faceName = (f: Strip['face']) => (f === 'top' ? 'sopra' : 'sotto');
  let thicknessProblem = false;
  if (thicknessMm === null) {
    thicknessProblem = true;
    issues.push({
      severity: 'error',
      message:
        `Con ${material.name} e ${layers} ${layers === 1 ? 'strato' : 'strati'} nessuno spessore commerciale basta: ` +
        `servono ${fmt(requiredMm)} mm in totale per ${fmt(currentA, 0)} A (lamella più critica: ${critical.label} ${faceName(critical.face)}, collo ${fmt(critical.neckMm, 1)} mm).`,
      stripIds: [critical.stripId],
    });
  } else if (totalThicknessMm! < requiredMm - 1e-9) {
    thicknessProblem = true;
    const hot = reports.filter((r) => (r.deltaTK ?? 0) > settings.deltaTK + 1e-9);
    issues.push({
      severity: 'error',
      message:
        `Spessore ${fmt(totalThicknessMm!)} mm insufficiente per ${fmt(currentA, 0)} A: ne servono ${fmt(requiredMm)} mm. ` +
        (hot.length ? `Scalderebbe di circa ${fmt(Math.max(...hot.map((r) => r.deltaTK ?? 0)), 0)} K invece di ${settings.deltaTK} K.` : 'Il picco di corrente supera la sezione.'),
      stripIds: hot.length ? hot.map((r) => r.stripId) : [critical.stripId],
    });
  }

  // --- Verifiche sulla saldatrice
  if (layers > welder.maxLayers) {
    issues.push({
      severity: 'warning',
      message: `${layers} strati: la saldatrice «${welder.name}» ne salda al massimo ${welder.maxLayers}.`,
      stripIds: [],
    });
  }
  if (totalThicknessMm !== null && totalThicknessMm > welder.maxThicknessMm + 1e-9) {
    thicknessProblem = true;
    issues.push({
      severity: 'warning',
      message: `Spessore totale ${fmt(totalThicknessMm)} mm: oltre i ${fmt(welder.maxThicknessMm)} mm che la saldatrice «${welder.name}» salda in modo affidabile.`,
      stripIds: [],
    });
  }
  if (material.weldability === 'poor') {
    issues.push({
      severity: 'warning',
      message: `${material.name} si salda male con una saldatrice a punti hobby: ${material.note}`,
      stripIds: [],
    });
  } else if (material.weldability === 'fair') {
    issues.push({
      severity: 'info',
      message: `${material.name}: richiede più energia di saldatura del nichel; prova su un campione.`,
      stripIds: [],
    });
  }
  for (const r of reports) {
    const where = `Lamella ${r.label} (${faceName(r.face)})`;
    if (r.spotCapacity < r.spotsNeeded) {
      issues.push({
        severity: 'error',
        message:
          `Lamella ${r.label} (${faceName(r.face)}): servono ${r.spotsNeeded} punti per terminale (${fmt(r.cellCurrentA, 1)} A per cella, ${fmt(welder.spotCurrentA, 0)} A a punto) ` +
          `ma sul contatto più piccolo ne entrano ${r.spotCapacity}.`,
        stripIds: [r.stripId],
      });
    }
  }

  // --- Verifiche su forma e taglio
  for (const s of strips) {
    if (s.partial) {
      issues.push({
        severity: 'warning',
        message: `Lamella ${s.label} (${faceName(s.face)}): collega solo un lato. Controlla le polarità del gruppo: forse ci sono celle con polarità miste.`,
        stripIds: [s.id],
      });
    }
  }
  for (const face of ['top', 'bottom'] as const) {
    const list = strips.filter((s) => s.face === face);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = regionDistance(list[i]!, list[j]!);
        const pair = [list[i]!.id, list[j]!.id];
        const names = `${list[i]!.label} e ${list[j]!.label} (${faceName(face)})`;
        if (d <= 0) {
          issues.push({ severity: 'error', message: `Le lamelle ${names} si toccano: sarebbe un cortocircuito.`, stripIds: pair });
        } else if (d < cutter.minGapMm) {
          issues.push({
            severity: 'warning',
            message: `Le lamelle ${names} distano ${fmt(d, 1)} mm: meno dei ${fmt(cutter.minGapMm, 1)} mm minimi per il taglio «${cutter.name}».`,
            stripIds: pair,
          });
        }
      }
    }
  }

  // --- Alternative, se lo spessore è un problema
  if (thicknessProblem && requiredMm > 0) {
    for (let l = Math.max(2, layers + 1); l <= welder.maxLayers; l++) {
      const t = smallestThickness(material, l, requiredMm);
      if (t !== null && t * l <= welder.maxThicknessMm + 1e-9) {
        alternatives.push(`${l} strati di ${material.name} da ${fmt(t)} mm sovrapposti e saldati insieme.`);
        break;
      }
    }
    for (const m of LAMELLA_MATERIALS) {
      if (m.id === material.id) continue;
      const need = worstRequiredMm(strips, m, settings, currentA);
      const t = smallestThickness(m, 1, need);
      if (t !== null && t <= welder.maxThicknessMm + 1e-9) {
        const note = m.weldability === 'poor' ? ' (si salda male a punti: serve stagno o altra giunzione)' : m.weldability === 'fair' ? ' (richiede più energia di saldatura)' : '';
        alternatives.push(`${m.name} da ${fmt(t)} mm${note}.`);
      }
    }
    alternatives.push('Struttura a due livelli: linguette di nichel sulle celle + barra di rame (in arrivo).');
    alternatives.push(`Abbassare la corrente di progetto o aumentare l'aumento di temperatura ammesso (ora ${settings.deltaTK} K).`);
  }

  const totalAreaMm2 = strips.reduce((a, s) => a + s.areaMm2, 0);
  const massG =
    totalThicknessMm === null ? null : (totalAreaMm2 * totalThicknessMm * 1e-9 * material.densityKgM3) * 1000;
  const status = issues.some((i) => i.severity === 'error')
    ? 'error'
    : issues.some((i) => i.severity === 'warning')
      ? 'warning'
      : 'ok';

  return {
    ...base,
    status,
    thicknessMm,
    totalThicknessMm,
    requiredMm,
    strips: reports,
    issues,
    alternatives,
    totalAreaCm2: totalAreaMm2 / 100,
    massG,
  };
}
