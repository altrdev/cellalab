import { fmtNum as fmt, t, tn } from '../i18n';
import { findMaterial, BUSBAR_MATERIALS, resistivityAt, volumetricHeat, type BusbarMaterial } from './materials';
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
 * Busbar analysis: required thickness, checks on the welder and on cutting, alternatives.
 * Sizing is done on the worst case among all the strips, because in practice a single
 * sheet of one thickness is used.
 */

export interface BusbarSettings {
  materialId: string;
  /** Thickness of a single layer, mm; null = automatic (the thinnest that is enough). */
  thicknessMm: number | null;
  /** Strati sovrapposti (saldati insieme). */
  layers: number;
  welderId: string;
  /** Weld spots per terminal; null = automatic (as many as the current needs, in pairs). */
  spotsPerTerminal: number | null;
  /** Continuous current one spot can carry, A; null = the welder profile's value. */
  spotCurrentA: number | null;
  /** Minimum distance between spots (between the pen electrodes), mm; null = the profile's value. */
  spotSpacingMm: number | null;
  cutterId: string;
  cooling: CoolingId;
  /** Allowed steady-state temperature rise, K. */
  deltaTK: number;
  ambientC: number;
  /** How much the cells heat above ambient, K: the band ends are at that temperature. */
  cellRiseK: number;
  /** Peak = current × factor, for `peakSeconds` seconds, with allowed rise `peakDeltaTK`. */
  peakFactor: number;
  peakSeconds: number;
  peakDeltaTK: number;
  /** Diameter of the weld area on the cell, mm; null = the button. */
  contactDiameterMm: number | null;
  /** Minimum width of the connection, mm; null = automatic. */
  widthMm: number | null;
  /** Grip tabs for the BMS wires (only if a BMS is chosen). */
  tabs: boolean;
  /** Tabs for the P+ and P− power cables, independent of the balance ones (only with a BMS). */
  powerTabs: boolean;
  /** Side of the drawing they stick out towards (the wires all leave from there); `auto` picks the first free side (resolved by the UI). */
  tabSide: TabSide | 'auto';
  tabWidthMm: number;
  tabLengthMm: number;
  /** AWG gauge of the balance wire. */
  balanceAwg: number;
  /** AWG gauge of the power cables (P+ and P−). */
  powerAwg: number;
  /** How far the bend goes past the holder edge, mm. */
  tabBendMm: number;
}

export const DEFAULT_BUSBAR_SETTINGS: BusbarSettings = {
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

/** Strip shape parameters derived from the settings. */
export const stripOptionsOf = (s: BusbarSettings, wireHoles = false): StripOptions => ({
  contactDiameterMm: s.contactDiameterMm,
  widthMm: s.widthMm,
  tabs: { side: s.tabSide === 'auto' ? 'top' : s.tabSide, widthMm: s.tabWidthMm, lengthMm: s.tabLengthMm, holeMm: holeForWireMm(s.balanceAwg), style: s.tabs ? 'tab' : 'none', bendMm: s.tabBendMm, power: s.powerTabs ? { widthMm: Math.max(s.tabWidthMm, holeForWireMm(s.powerAwg) + 4), holeMm: holeForWireMm(s.powerAwg) } : null },
});

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface BusbarIssue {
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
  /** Current through the neck, A (in the terminals the cable is assumed in the middle: half). */
  neckCurrentA: number;
  /** Total thickness required by the thermal and peak criteria, mm. */
  thermalMm: number;
  peakMm: number;
  requiredMm: number;
  /** Steady-state temperature rise with the chosen thickness, K (null if there is no thickness). */
  deltaTK: number | null;
  cellCurrentA: number;
  /** Spots to put on each terminal: the chosen ones, or automatically those for the current (in pairs). */
  spotsNeeded: number;
  /** Spots needed at minimum for the cell current. */
  spotsForCurrent: number;
  /** Current the chosen spots can carry, A. */
  spotsCarryA: number;
  /** Spots that fit on the smallest contact. */
  spotCapacity: number;
  /** Radius of the smallest weld area, mm. */
  contactRadiusMm: number;
}

export interface BusbarReport {
  status: 'empty' | 'ok' | 'warning' | 'error';
  currentA: number;
  material: BusbarMaterial;
  welder: WelderProfile;
  cutter: CutterProfile;
  /** Thickness of a single layer, mm; null if none is enough. */
  thicknessMm: number | null;
  layers: number;
  totalThicknessMm: number | null;
  auto: boolean;
  /** Total thickness required by the most critical strip, mm. */
  requiredMm: number;
  strips: StripReport[];
  issues: BusbarIssue[];
  alternatives: string[];
  /** Total area of the strips and mass of material, for the order. */
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

function requirementFor(strip: Strip, material: BusbarMaterial, s: BusbarSettings, currentA: number): Requirement {
  const neck = neckWidthMm(strip);
  const neckCurrent =
    strip.kind === 'series' ? currentA / strip.parallelCount : currentA / 2;
  const h = COOLING[s.cooling].h;
  const rhoHot = resistivityAt(material, s.ambientC + s.deltaTK);
  const thermalInput = { currentA: neckCurrent, resistivityOhmM: rhoHot, deltaTK: s.deltaTK, hWm2K: h };
  // A short band, welded to the cells, sheds heat towards them: the free length counts.
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

/** Total thickness required by the worst case with a given material. */
export function worstRequiredMm(strips: readonly Strip[], material: BusbarMaterial, s: BusbarSettings, currentA: number): number {
  let worst = 0;
  for (const strip of strips) worst = Math.max(worst, requirementFor(strip, material, s, currentA).requiredMm);
  return worst;
}

/** The thinnest commercial thickness such that layers·thickness ≥ required. */
function smallestThickness(material: BusbarMaterial, layers: number, requiredMm: number): number | null {
  for (const t of material.thicknessesMm) if (t * layers >= requiredMm - 1e-9) return t;
  return null;
}

export function analyzeBusbars(
  project: Project,
  strips: readonly Strip[],
  settings: BusbarSettings,
  packCurrentA: number,
): BusbarReport {
  const material = findMaterial(settings.materialId) ?? BUSBAR_MATERIALS[0]!;
  const profile = findWelder(settings.welderId) ?? WELDER_PROFILES[0]!;
  const welder: WelderProfile = {
    ...profile,
    spotCurrentA: settings.spotCurrentA ?? profile.spotCurrentA,
    spotSpacingMm: settings.spotSpacingMm ?? profile.spotSpacingMm,
  };
  const cutter = findCutter(settings.cutterId) ?? CUTTER_PROFILES[0]!;
  const currentA = packCurrentA;
  const layers = Math.max(1, Math.floor(settings.layers));
  const issues: BusbarIssue[] = [];
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
      issues: [{ severity: 'info', message: t('busbar.issue.assign'), stripIds: [] }],
      alternatives,
      totalAreaCm2: 0,
      massG: null,
    };
  }
  if (!(currentA > 0)) {
    issues.push({ severity: 'error', message: t('busbar.issue.currentZero'), stripIds: [] });
  } else if (powerAmpacityA(settings.powerAwg) < currentA) {
    const need = powerAwgFor(currentA);
    issues.push({
      severity: 'warning',
      message: t('busbar.issue.powerCable', {
        awg: settings.powerAwg,
        cap: powerAmpacityA(settings.powerAwg),
        current: fmt(currentA, 0),
        hint: need === null ? t('busbar.issue.powerCableMore') : t('busbar.issue.powerCableAwg', { need }),
      }),
      stripIds: [],
    });
  }

  // --- Requirements for each strip
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

  // --- Report per strip
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
    // The pen welds two spots at a time: automatically it goes up in pairs, unless the contact holds only one less.
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
      message: t('busbar.issue.noThickness', {
        material: material.name,
        layers: tn('busbar.layers', layers),
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
      message: t('busbar.issue.tooThin', {
        thickness: len(totalThicknessMm!, 2),
        current: fmt(currentA, 0),
        required: len(requiredMm, 2),
        why: hot.length
          ? t('busbar.issue.tooThinHot', { rise: tempDelta(Math.max(...hot.map((r) => r.deltaTK ?? 0)), 0), allowed: tempDelta(settings.deltaTK, 0) })
          : t('busbar.issue.tooThinPeak'),
      }),
      stripIds: hot.length ? hot.map((r) => r.stripId) : [critical.stripId],
    });
  }

  // --- Welder checks
  if (layers > welder.maxLayers) {
    issues.push({
      severity: 'warning',
      message: t('busbar.issue.welderLayers', { layers, welder: welder.name, max: welder.maxLayers }),
      stripIds: [],
    });
  }
  if (totalThicknessMm !== null && totalThicknessMm > welder.maxThicknessMm + 1e-9) {
    thicknessProblem = true;
    issues.push({
      severity: 'warning',
      message: t('busbar.issue.welderThickness', { total: len(totalThicknessMm, 2), max: len(welder.maxThicknessMm, 2), welder: welder.name }),
      stripIds: [],
    });
  }
  if (material.weldability === 'poor') {
    issues.push({
      severity: 'warning',
      message: t('busbar.issue.weldPoor', { material: material.name, note: material.note }),
      stripIds: [],
    });
  } else if (material.weldability === 'fair') {
    issues.push({
      severity: 'info',
      message: t('busbar.issue.weldFair', { material: material.name }),
      stripIds: [],
    });
  }
  const fixedSpots = settings.spotsPerTerminal !== null;
  for (const r of reports) {
    const where = t('busbar.where', { strip: r.label, face: faceName(r.face) });
    if (r.spotCapacity < r.spotsNeeded) {
      // says why: what the weld area is like and how much is needed for the wanted spots
      const need = minRadiusForSpots(r.spotsNeeded, welder.spotDiameterMm, welder.spotSpacingMm);
      const needR = Math.ceil(need * 10) / 10;
      const how = Number.isFinite(need)
        ? t('busbar.issue.spotsHow', {
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
          ? t('busbar.issue.spotsChosen', { where, count: r.spotsNeeded, capacity: r.spotCapacity, how })
          : t('busbar.issue.spotsNeeded', {
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
        message: t('busbar.issue.spotsWeak', {
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
        message: t('busbar.issue.partial', { strip: s.label, face: faceName(s.face) }),
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
        const names = t('busbar.names', { a: list[i]!.label, b: list[j]!.label, face: faceName(face) });
        if (d <= 0) {
          issues.push({ severity: 'error', message: t('busbar.issue.touch', { names }), stripIds: pair });
        } else if (d < cutter.minGapMm) {
          issues.push({
            severity: 'warning',
            message: t('busbar.issue.gap', { names, gap: len(d, 1), min: len(cutter.minGapMm, 1), cutter: cutter.name }),
            stripIds: pair,
          });
        }
      }
    }
  }

  // A tab over a cell of another joint would short it (if it touches another strip the check above already says so).
  for (const s of strips) {
    if (tabsOf(s).some((tb) => tb.blockedBy === 'cell')) {
      issues.push({ severity: 'warning', message: t('busbar.issue.tabCell', { strip: s.label, face: faceName(s.face) }), stripIds: [s.id] });
    }
  }

  // --- Alternatives, if the thickness is a problem
  if (thicknessProblem && requiredMm > 0) {
    for (let l = Math.max(2, layers + 1); l <= welder.maxLayers; l++) {
      const th = smallestThickness(material, l, requiredMm);
      if (th !== null && th * l <= welder.maxThicknessMm + 1e-9) {
        alternatives.push(t('busbar.alt.layers', { layers: l, material: material.name, thickness: len(th, 2) }));
        break;
      }
    }
    for (const m of BUSBAR_MATERIALS) {
      if (m.id === material.id) continue;
      const need = worstRequiredMm(strips, m, settings, currentA);
      const th = smallestThickness(m, 1, need);
      if (th !== null && th <= welder.maxThicknessMm + 1e-9) {
        const note = m.weldability === 'poor' ? t('busbar.alt.noteWeldPoor') : m.weldability === 'fair' ? t('busbar.alt.noteWeldFair') : '';
        alternatives.push(t('busbar.alt.material', { material: m.name, thickness: len(th, 2), note }));
      }
    }
    alternatives.push(t('busbar.alt.twoLevel'));
    alternatives.push(t('busbar.alt.lowerCurrent', { delta: tempDelta(settings.deltaTK, 0) }));
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
