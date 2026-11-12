import { fmtNum as fmt, t, tn } from '../i18n';
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
  minRadiusForSpots,
  minThicknessConductionMm,
  minThicknessThermalMm,
  spotCapacity,
  spotsNeeded,
  type CoolingId,
} from './sizing';
import { holeForWireMm, powerAmpacityA, powerAwgFor } from './wire';
import { neckWidthMm, tabsOf, type Strip, type StripOptions, type TabSide } from './strips';
import type { Project } from './types';
import { len, tempDelta } from '../units';

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
  /** Punti di saldatura per terminale; null = automatico (quanti servono per la corrente, a coppie). */
  spotsPerTerminal: number | null;
  /** Corrente continua che regge un punto, A; null = quella del profilo della saldatrice. */
  spotCurrentA: number | null;
  /** Distanza minima tra i punti (tra gli elettrodi della penna), mm; null = quella del profilo. */
  spotSpacingMm: number | null;
  cutterId: string;
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
  /** Diametro dell'area di saldatura sulla cella, mm; null = il bottone. */
  contactDiameterMm: number | null;
  /** Larghezza minima del collegamento, mm; null = automatica. */
  widthMm: number | null;
  /** Linguette di presa per i fili del BMS (solo se è scelto un BMS). */
  tabs: boolean;
  /** Linguette per i cavi di potenza di P+ e P−, indipendenti da quelle di bilanciamento (solo con un BMS). */
  powerTabs: boolean;
  /** Lato del disegno verso cui sporgono (i fili escono tutti da lì); `auto` sceglie il primo lato libero (lo risolve l'interfaccia). */
  tabSide: TabSide | 'auto';
  tabWidthMm: number;
  tabLengthMm: number;
  /** Sezione AWG del filo di bilanciamento. */
  balanceAwg: number;
  /** Sezione AWG dei cavi di potenza (P+ e P−). */
  powerAwg: number;
  /** Di quanto la piega supera il bordo del holder, mm. */
  tabBendMm: number;
}

export const DEFAULT_LAMELLA_SETTINGS: LamellaSettings = {
  materialId: 'nichel-puro',
  thicknessMm: null,
  layers: 1,
  welderId: 'hobby',
  spotsPerTerminal: null,
  spotCurrentA: null,
  spotSpacingMm: null,
  cutterId: 'manual',
  cooling: 'free',
  deltaTK: 25,
  ambientC: 25,
  cellRiseK: 15,
  peakFactor: 1.5,
  peakSeconds: 1,
  peakDeltaTK: 100,
  contactDiameterMm: null,
  widthMm: null,
  tabs: true,
  powerTabs: true,
  tabSide: 'auto',
  tabWidthMm: 6,
  tabLengthMm: 8,
  tabBendMm: 0.3,
  balanceAwg: 26,
  powerAwg: 10,
};

/** Parametri di forma delle lamelle ricavati dalle impostazioni. */
export const stripOptionsOf = (s: LamellaSettings, wireHoles = false): StripOptions => ({
  contactDiameterMm: s.contactDiameterMm,
  widthMm: s.widthMm,
  tabs: s.tabs || s.powerTabs || wireHoles ? { side: s.tabSide === 'auto' ? 'top' : s.tabSide, widthMm: s.tabWidthMm, lengthMm: s.tabLengthMm, holeMm: holeForWireMm(s.balanceAwg), style: s.tabs ? 'tab' : 'none', bendMm: s.tabBendMm, power: s.powerTabs ? { widthMm: Math.max(s.tabWidthMm, holeForWireMm(s.powerAwg) + 4), holeMm: holeForWireMm(s.powerAwg) } : null } : null,
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
  /** Punti da mettere su ogni terminale: quelli scelti, o in automatico quelli per la corrente (a coppie). */
  spotsNeeded: number;
  /** Punti che servirebbero come minimo per la corrente della cella. */
  spotsForCurrent: number;
  /** Corrente che reggono i punti scelti, A. */
  spotsCarryA: number;
  /** Punti che entrano sul contatto più piccolo. */
  spotCapacity: number;
  /** Raggio dell'area di saldatura più piccola, mm. */
  contactRadiusMm: number;
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
  const profile = findWelder(settings.welderId) ?? WELDER_PROFILES[0]!;
  const welder: WelderProfile = {
    ...profile,
    spotCurrentA: settings.spotCurrentA ?? profile.spotCurrentA,
    spotSpacingMm: settings.spotSpacingMm ?? profile.spotSpacingMm,
  };
  const cutter = findCutter(settings.cutterId) ?? CUTTER_PROFILES[0]!;
  const currentA = packCurrentA;
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
      issues: [{ severity: 'info', message: t('lamelle.issue.assign'), stripIds: [] }],
      alternatives,
      totalAreaCm2: 0,
      massG: null,
    };
  }
  if (!(currentA > 0)) {
    issues.push({ severity: 'error', message: t('lamelle.issue.currentZero'), stripIds: [] });
  } else if (powerAmpacityA(settings.powerAwg) < currentA) {
    const need = powerAwgFor(currentA);
    issues.push({
      severity: 'warning',
      message: t('lamelle.issue.powerCable', {
        awg: settings.powerAwg,
        cap: powerAmpacityA(settings.powerAwg),
        current: fmt(currentA, 0),
        hint: need === null ? t('lamelle.issue.powerCableMore') : t('lamelle.issue.powerCableAwg', { need }),
      }),
      stripIds: [],
    });
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
    const forCurrent = spotsNeeded(maxCellCurrent, welder.spotCurrentA, welder.minSpotsPerTerminal);
    let cap = Infinity;
    let contactR = Infinity;
    for (const n of s.nodes) {
      cap = Math.min(cap, spotCapacity(n.contactRadiusMm, welder.spotDiameterMm, welder.spotSpacingMm));
      contactR = Math.min(contactR, n.contactRadiusMm);
    }
    const capacity = Number.isFinite(cap) ? cap : 0;
    // La penna salda due punti per volta: in automatico si sale a coppie, salvo che il contatto ne tenga uno solo in meno.
    let chosen = settings.spotsPerTerminal ?? (forCurrent % 2 === 0 ? forCurrent : forCurrent + 1);
    if (settings.spotsPerTerminal === null && chosen > capacity && forCurrent <= capacity) chosen = forCurrent;
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
      spotsNeeded: chosen,
      spotsForCurrent: forCurrent,
      spotsCarryA: chosen * welder.spotCurrentA,
      spotCapacity: capacity,
      contactRadiusMm: Number.isFinite(contactR) ? contactR : 0,
    };
  });

  // --- Verifiche sullo spessore
  const critical = reports.reduce((a, b) => (b.requiredMm > a.requiredMm ? b : a));
  const faceName = (f: Strip['face']) => t(f === 'top' ? 'face.top' : 'face.bottom');
  let thicknessProblem = false;
  if (thicknessMm === null) {
    thicknessProblem = true;
    issues.push({
      severity: 'error',
      message: t('lamelle.issue.noThickness', {
        material: material.name,
        layers: tn('lamelle.layers', layers),
        required: len(requiredMm, 2),
        current: fmt(currentA, 0),
        strip: critical.label,
        face: faceName(critical.face),
        neck: len(critical.neckMm, 1),
      }),
      stripIds: [critical.stripId],
    });
  } else if (totalThicknessMm! < requiredMm - 1e-9) {
    thicknessProblem = true;
    const hot = reports.filter((r) => (r.deltaTK ?? 0) > settings.deltaTK + 1e-9);
    issues.push({
      severity: 'error',
      message: t('lamelle.issue.tooThin', {
        thickness: len(totalThicknessMm!, 2),
        current: fmt(currentA, 0),
        required: len(requiredMm, 2),
        why: hot.length
          ? t('lamelle.issue.tooThinHot', { rise: tempDelta(Math.max(...hot.map((r) => r.deltaTK ?? 0)), 0), allowed: tempDelta(settings.deltaTK, 0) })
          : t('lamelle.issue.tooThinPeak'),
      }),
      stripIds: hot.length ? hot.map((r) => r.stripId) : [critical.stripId],
    });
  }

  // --- Verifiche sulla saldatrice
  if (layers > welder.maxLayers) {
    issues.push({
      severity: 'warning',
      message: t('lamelle.issue.welderLayers', { layers, welder: welder.name, max: welder.maxLayers }),
      stripIds: [],
    });
  }
  if (totalThicknessMm !== null && totalThicknessMm > welder.maxThicknessMm + 1e-9) {
    thicknessProblem = true;
    issues.push({
      severity: 'warning',
      message: t('lamelle.issue.welderThickness', { total: len(totalThicknessMm, 2), max: len(welder.maxThicknessMm, 2), welder: welder.name }),
      stripIds: [],
    });
  }
  if (material.weldability === 'poor') {
    issues.push({
      severity: 'warning',
      message: t('lamelle.issue.weldPoor', { material: material.name, note: material.note }),
      stripIds: [],
    });
  } else if (material.weldability === 'fair') {
    issues.push({
      severity: 'info',
      message: t('lamelle.issue.weldFair', { material: material.name }),
      stripIds: [],
    });
  }
  const fixedSpots = settings.spotsPerTerminal !== null;
  for (const r of reports) {
    const where = t('lamelle.where', { strip: r.label, face: faceName(r.face) });
    if (r.spotCapacity < r.spotsNeeded) {
      // dice perché: com'è l'area di saldatura e quanto serve per i punti voluti
      const need = minRadiusForSpots(r.spotsNeeded, welder.spotDiameterMm, welder.spotSpacingMm);
      const needR = Math.ceil(need * 10) / 10;
      const how = Number.isFinite(need)
        ? t('lamelle.issue.spotsHow', {
            radius: len(r.contactRadiusMm, 1),
            diameter: len(2 * r.contactRadiusMm, 1),
            count: r.spotsNeeded,
            spot: len(welder.spotDiameterMm, 0),
            pitch: len(welder.spotSpacingMm, 1),
            need: len(needR, 1),
            needDiameter: len(2 * needR, 1),
          })
        : '';
      issues.push({
        severity: 'error',
        message: fixedSpots
          ? t('lamelle.issue.spotsChosen', { where, count: r.spotsNeeded, capacity: r.spotCapacity, how })
          : t('lamelle.issue.spotsNeeded', {
              where,
              count: r.spotsForCurrent,
              cell: fmt(r.cellCurrentA, 1),
              perSpot: fmt(welder.spotCurrentA, 0),
              capacity: r.spotCapacity,
              how,
            }),
        stripIds: [r.stripId],
      });
    } else if (fixedSpots && r.spotsNeeded < r.spotsForCurrent) {
      issues.push({
        severity: 'error',
        message: t('lamelle.issue.spotsWeak', {
          where,
          count: r.spotsNeeded,
          carry: fmt(r.spotsCarryA, 0),
          cell: fmt(r.cellCurrentA, 1),
          perSpot: fmt(welder.spotCurrentA, 0),
          min: r.spotsForCurrent,
        }),
        stripIds: [r.stripId],
      });
    }
  }

  // --- Verifiche su forma e taglio
  for (const s of strips) {
    if (s.partial) {
      issues.push({
        severity: 'warning',
        message: t('lamelle.issue.partial', { strip: s.label, face: faceName(s.face) }),
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
        const names = t('lamelle.names', { a: list[i]!.label, b: list[j]!.label, face: faceName(face) });
        if (d <= 0) {
          issues.push({ severity: 'error', message: t('lamelle.issue.touch', { names }), stripIds: pair });
        } else if (d < cutter.minGapMm) {
          issues.push({
            severity: 'warning',
            message: t('lamelle.issue.gap', { names, gap: len(d, 1), min: len(cutter.minGapMm, 1), cutter: cutter.name }),
            stripIds: pair,
          });
        }
      }
    }
  }

  // Una linguetta sopra una cella di un'altra giunzione la metterebbe in corto (se tocca un'altra lamella lo dice già il controllo sopra).
  for (const s of strips) {
    if (tabsOf(s).some((tb) => tb.blockedBy === 'cell')) {
      issues.push({ severity: 'warning', message: t('lamelle.issue.tabCell', { strip: s.label, face: faceName(s.face) }), stripIds: [s.id] });
    }
  }

  // --- Alternative, se lo spessore è un problema
  if (thicknessProblem && requiredMm > 0) {
    for (let l = Math.max(2, layers + 1); l <= welder.maxLayers; l++) {
      const th = smallestThickness(material, l, requiredMm);
      if (th !== null && th * l <= welder.maxThicknessMm + 1e-9) {
        alternatives.push(t('lamelle.alt.layers', { layers: l, material: material.name, thickness: len(th, 2) }));
        break;
      }
    }
    for (const m of LAMELLA_MATERIALS) {
      if (m.id === material.id) continue;
      const need = worstRequiredMm(strips, m, settings, currentA);
      const th = smallestThickness(m, 1, need);
      if (th !== null && th <= welder.maxThicknessMm + 1e-9) {
        const note = m.weldability === 'poor' ? t('lamelle.alt.noteWeldPoor') : m.weldability === 'fair' ? t('lamelle.alt.noteWeldFair') : '';
        alternatives.push(t('lamelle.alt.material', { material: m.name, thickness: len(th, 2), note }));
      }
    }
    alternatives.push(t('lamelle.alt.twoLevel'));
    alternatives.push(t('lamelle.alt.lowerCurrent', { delta: tempDelta(settings.deltaTK, 0) }));
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
