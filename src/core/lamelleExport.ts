import { offsetRegion, regionRings } from './clip';
import { fmtNum, t } from '../i18n';
import { getPrefs } from '../prefs';
import { area, len, lenDigits, lenLabel, massSmall, toLen } from '../units';
import { labelPlacements } from './dxf';
import type { Pt } from './polygon';
import type { LamellaReport } from './lamelle';
import { spotPositions } from './sizing';
import type { Face, Strip } from './strips';

/**
 * Esportazioni delle lamelle per chi non ha un CAD: SVG in scala reale (si stampa al 100 % e diventa
 * una dima da ritagliare) e lista di taglio in testo/CSV.
 */

const MARGIN_MM = 8;
const SCALE_BAR_MM = 50;
/** Con i pollici la barra di scala è lunga 2 in (50,8 mm): un numero tondo nell'unità scelta. */
const scaleBarMm = () => (getPrefs().length === 'in' ? 50.8 : SCALE_BAR_MM);
const LABEL_SIZE_MM = 3.5;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SvgOptions {
  face: Face;
  /** Compensazione del taglio, mm (0 per il taglio a mano). */
  kerfMm: number;
  includeContacts: boolean;
  spotsPerStrip?: ReadonlyMap<string, number>;
  spotDiameterMm?: number;
  spotSpacingMm?: number;
  title?: string;
}

export function buildSvg(strips: readonly Strip[], o: SvgOptions): string {
  const list = strips.filter((s) => s.face === o.face);
  const rings = list.map((s) => regionRings(offsetRegion(s, o.kerfMm / 2)));
  const pts = rings.flat(2);
  if (pts.length === 0) pts.push({ x: 0, y: 0 }, { x: 60, y: 30 });
  // etichette fuori dai pezzi, sotto ognuno: contano anche nelle dimensioni del foglio
  const labels = labelPlacements(list, o.kerfMm / 2, { heightMm: LABEL_SIZE_MM, textOf: (s) => s.label });
  for (const l of labels) pts.push({ x: l.x, y: l.y }, { x: l.x + l.width, y: l.y });
  const minX = Math.min(...pts.map((p) => p.x)) - MARGIN_MM;
  const minY = Math.min(...pts.map((p) => p.y)) - MARGIN_MM;
  const maxX = Math.max(...pts.map((p) => p.x)) + MARGIN_MM;
  const maxY = Math.max(...pts.map((p) => p.y)) + MARGIN_MM + 10; // spazio per la barra di scala
  const w = maxX - minX;
  const h = maxY - minY;
  const d = (poly: readonly Pt[]) => poly.map((p, i) => `${i ? 'L' : 'M'}${r3(p.x)} ${r3(p.y)}`).join(' ') + ' Z';

  const out: string[] = [];
  // il disegno resta in mm (unità del viewBox); la dimensione stampata è dichiarata nell'unità scelta: scala reale
  const unit = lenLabel();
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${r3(toLen(w))}${unit}" height="${r3(toLen(h))}${unit}" viewBox="${r3(minX)} ${r3(minY)} ${r3(w)} ${r3(h)}">`);
  out.push(`<title>${esc(t('export.svg.title', { title: o.title ?? t('export.svg.defaultTitle'), face: t(o.face === 'top' ? 'face.top' : 'face.bottom') }))}</title>`);
  out.push('<g fill="none" stroke-linejoin="round" font-family="sans-serif">');
  list.forEach((s, i) => {
    out.push(`<path d="${(rings[i] as Pt[][]).map(d).join(' ')}" fill-rule="evenodd" stroke="#d00" stroke-width="0.2"/>`);
    if (o.includeContacts) {
      for (const n of s.nodes) {
        out.push(`<circle cx="${r3(n.x)}" cy="${r3(n.y)}" r="${r3(n.contactRadiusMm)}" stroke="#06c" stroke-width="0.15" stroke-dasharray="1 0.8"/>`);
      }
    }
    const count = o.spotsPerStrip?.get(s.id) ?? 0;
    if (count > 0 && o.spotDiameterMm && o.spotSpacingMm) {
      for (const n of s.nodes) {
        for (const p of spotPositions(n.contactRadiusMm, o.spotDiameterMm, o.spotSpacingMm, count)) {
          out.push(`<circle cx="${r3(n.x + p.x)}" cy="${r3(n.y + p.y)}" r="${r3(o.spotDiameterMm / 2)}" stroke="#080" stroke-width="0.15"/>`);
        }
      }
    }
    const l = labels[i]!;
    out.push(`<text x="${r3(l.cx)}" y="${r3(l.y)}" font-size="${LABEL_SIZE_MM}" fill="#000" stroke="none" text-anchor="middle">${esc(l.text)}</text>`);
  });
  const by = maxY - 6;
  out.push(`<path d="M${r3(minX + MARGIN_MM)} ${r3(by)} h${scaleBarMm()} m0 -1.5 v3 m-${scaleBarMm()} 0 v-3" stroke="#000" stroke-width="0.3"/>`);
  out.push(`<text x="${r3(minX + MARGIN_MM)}" y="${r3(by + 5)}" font-size="3" fill="#000" stroke="none">${esc(t('export.svg.scale', { n: `${fmtNum(toLen(scaleBarMm()), 0)} ${unit}` }))}</text>`);
  out.push('</g></svg>');
  return out.join('\n') + '\n';
}

const fmt = (n: number | null, d = 2) => (n === null ? '' : n.toFixed(d));
/** Lunghezza nell'unità scelta (decimali con il punto, come nel resto del CSV). */
const lenCsv = (mm: number | null, d: number) => (mm === null ? '' : toLen(mm).toFixed(lenDigits(d)));
const areaCsv = (mm2: number) => (getPrefs().length === 'in' ? (mm2 / 645.16).toFixed(3) : mm2.toFixed(0));

/** Lista di taglio in CSV (separatore ';', decimali con il punto). */
export function buildCutListCsv(strips: readonly Strip[], report: LamellaReport): string {
  const rows = [t('export.csv.header', { a: getPrefs().length === 'in' ? 'in2' : 'mm2', l: lenLabel() })];
  for (const s of strips) {
    const r = report.strips.find((x) => x.stripId === s.id);
    rows.push(
      [
        t(s.face === 'top' ? 'face.top' : 'face.bottom'),
        s.label,
        s.nodes.length,
        areaCsv(s.areaMm2),
        lenCsv(r?.neckMm ?? null, 1),
        fmt(r?.neckCurrentA ?? null, 1),
        lenCsv(r?.requiredMm ?? null, 2),
        r?.spotsNeeded ?? '',
      ].join(';'),
    );
  }
  return rows.join('\n') + '\n';
}

/** Riepilogo leggibile da stampare con la dima. */
export function buildCutSummary(report: LamellaReport, projectName: string): string {
  const th = report.thicknessMm;
  const thickness =
    th === null
      ? t('export.summary.thicknessNone', { required: len(report.requiredMm, 2) })
      : t('export.summary.thicknessValue', { thickness: len(th, 2), layers: report.layers });
  const lines = [
    t('export.summary.title', { name: projectName }),
    t('export.summary.material', { material: report.material.name }),
    t('export.summary.thickness', { value: thickness }),
    t('export.summary.current', { current: fmt(report.currentA, 0) }),
    t('export.summary.parts', {
      count: report.strips.length,
      area: area(report.totalAreaCm2, 1),
      mass: report.massG !== null ? ' - ' + massSmall(report.massG, 0) : '',
    }),
    t('export.summary.tools', { welder: report.welder.name, cutter: report.cutter.name }),
    '',
    ...report.issues.map((i) => `[${i.severity}] ${i.message}`),
  ];
  return lines.join('\n') + '\n';
}
