/**
 * Maker tool profiles: spot welder and cutting method.
 * The default values are cautious and EDITABLE: every welder is different.
 */

import { t } from '../i18n';

export interface WelderProfile {
  id: string;
  name: string;
  /** Maximum total thickness it welds reliably (sum of the layers), mm. */
  maxThicknessMm: number;
  maxLayers: number;
  /** Current a single weld spot can carry continuously, A. */
  spotCurrentA: number;
  /** Minimum distance between the centres of two spots, mm. */
  spotSpacingMm: number;
  /** Diameter of a spot, mm. */
  spotDiameterMm: number;
  /** Minimum spots per terminal, for redundancy. */
  minSpotsPerTerminal: number;
}

export const WELDER_PROFILES: readonly WelderProfile[] = [
  {
    id: 'hobby',
    get name() {
      return t('welder.hobby.name');
    },
    maxThicknessMm: 0.2,
    maxLayers: 2,
    spotCurrentA: 5,
    spotSpacingMm: 3,
    spotDiameterMm: 2,
    minSpotsPerTerminal: 2,
  },
  {
    id: 'hobby-potente',
    get name() {
      return t('welder.hobby-potente.name');
    },
    maxThicknessMm: 0.3,
    maxLayers: 2,
    spotCurrentA: 8,
    spotSpacingMm: 3,
    spotDiameterMm: 2.5,
    minSpotsPerTerminal: 2,
  },
  {
    id: 'professionale',
    get name() {
      return t('welder.professionale.name');
    },
    maxThicknessMm: 0.5,
    maxLayers: 3,
    spotCurrentA: 15,
    spotSpacingMm: 4,
    spotDiameterMm: 3,
    minSpotsPerTerminal: 2,
  },
];

export type CutterKind = 'manual' | 'laser' | 'cnc' | 'service';

export interface CutterProfile {
  id: string;
  kind: CutterKind;
  name: string;
  /** Cut width (kerf), mm: the export compensates the outline by half of it. */
  kerfMm: number;
  /** Minimum distance between two pieces (or minimum detail) for a clean cut, mm. */
  minGapMm: number;
}

export const CUTTER_PROFILES: readonly CutterProfile[] = [
  { id: 'manual', kind: 'manual', get name() { return t('cutter.manual.name'); }, kerfMm: 0, minGapMm: 1 },
  { id: 'laser', kind: 'laser', get name() { return t('cutter.laser.name'); }, kerfMm: 0.15, minGapMm: 0.5 },
  { id: 'cnc', kind: 'cnc', get name() { return t('cutter.cnc.name'); }, kerfMm: 1, minGapMm: 2 },
  { id: 'service', kind: 'service', get name() { return t('cutter.service.name'); }, kerfMm: 0.2, minGapMm: 1 },
];

export const findWelder = (id: string) => WELDER_PROFILES.find((w) => w.id === id);
export const findCutter = (id: string) => CUTTER_PROFILES.find((c) => c.id === id);
