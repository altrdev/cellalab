import { t } from '../i18n';
import { len, lenDigits, lenLabel, toLen } from '../units';
import type { Harness } from './harness';
import type { Strip } from './strips';

/** Lista dei fili del cablaggio del BMS: riepilogo leggibile e CSV (separatore ';', decimali con il punto). */

const lenCsv = (mm: number, d: number) => toLen(mm).toFixed(lenDigits(d));

export function buildHarnessCsv(h: Harness, strips: readonly Strip[]): string {
  const rows = [t('export.harness.header', { l: lenLabel() })];
  for (const w of h.wires) {
    const s = strips.find((x) => x.id === w.stripId);
    rows.push([w.label, s?.label ?? '', t(w.face === 'top' ? 'face.top' : 'face.bottom'), lenCsv(w.lengthMm, 0), lenCsv(w.cutMm, 0)].join(';'));
  }
  return rows.join('\n') + '\n';
}

export function buildHarnessSummary(h: Harness, projectName: string): string {
  return [
    t('export.harness.title', { name: projectName }),
    t(h.mount.mode === 'pack' ? 'export.harness.modePack' : 'export.harness.modeExternal', { slack: len(h.mount.slackMm, 0), tail: len(h.mount.tailMm, 0) }),
    t('export.harness.total', { n: h.wires.length, total: len(h.totalCutMm, 0), step: len(5, 0) }),
    '',
  ].join('\n');
}
