/**
 * Profili degli strumenti del maker: saldatrice a punti e metodo di taglio.
 * I valori di default sono prudenti e MODIFICABILI: ogni saldatrice è diversa.
 */

import { t } from '../i18n';

export interface WelderProfile {
  id: string;
  name: string;
  /** Spessore complessivo massimo che salda in modo affidabile (somma degli strati), mm. */
  maxThicknessMm: number;
  maxLayers: number;
  /** Corrente che un singolo punto di saldatura può portare in modo continuo, A. */
  spotCurrentA: number;
  /** Distanza minima tra i centri di due punti, mm. */
  spotSpacingMm: number;
  /** Diametro di un punto, mm. */
  spotDiameterMm: number;
  /** Punti minimi per ogni terminale, per ridondanza. */
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
  /** Larghezza del taglio (kerf), mm: l'esportazione compensa il contorno di metà. */
  kerfMm: number;
  /** Distanza minima tra due pezzi (o dettaglio minimo) per un taglio pulito, mm. */
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
