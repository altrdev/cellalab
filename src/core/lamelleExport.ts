import { offsetRegion, regionRings } from './clip';
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
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${r3(w)}mm" height="${r3(h)}mm" viewBox="${r3(minX)} ${r3(minY)} ${r3(w)} ${r3(h)}">`);
  out.push(`<title>${esc(o.title ?? 'Lamelle')} - faccia ${o.face === 'top' ? 'sopra' : 'sotto'}</title>`);
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
  out.push(`<path d="M${r3(minX + MARGIN_MM)} ${r3(by)} h${SCALE_BAR_MM} m0 -1.5 v3 m-${SCALE_BAR_MM} 0 v-3" stroke="#000" stroke-width="0.3"/>`);
  out.push(`<text x="${r3(minX + MARGIN_MM)}" y="${r3(by + 5)}" font-size="3" fill="#000" stroke="none">${SCALE_BAR_MM} mm - stampa al 100% (nessun adattamento alla pagina)</text>`);
  out.push('</g></svg>');
  return out.join('\n') + '\n';
}

const fmt = (n: number | null, d = 2) => (n === null ? '' : n.toFixed(d));

/** Lista di taglio in CSV (separatore ';', decimali con il punto). */
export function buildCutListCsv(strips: readonly Strip[], report: LamellaReport): string {
  const rows = ['faccia;lamella;celle_collegate;area_mm2;collo_mm;corrente_A;spessore_min_mm;punti_per_cella'];
  for (const s of strips) {
    const r = report.strips.find((x) => x.stripId === s.id);
    rows.push(
      [
        s.face === 'top' ? 'sopra' : 'sotto',
        s.label,
        s.nodes.length,
        fmt(s.areaMm2, 0),
        fmt(r?.neckMm ?? null, 1),
        fmt(r?.neckCurrentA ?? null, 1),
        fmt(r?.requiredMm ?? null),
        r?.spotsNeeded ?? '',
      ].join(';'),
    );
  }
  return rows.join('\n') + '\n';
}

/** Riepilogo leggibile da stampare con la dima. */
export function buildCutSummary(report: LamellaReport, projectName: string): string {
  const t = report.thicknessMm;
  const lines = [
    `Lamelle - ${projectName}`,
    `Materiale: ${report.material.name}`,
    `Spessore: ${t === null ? 'nessuno basta (servono almeno ' + fmt(report.requiredMm) + ' mm)' : fmt(t) + ' mm x ' + report.layers + ' strato/i'}`,
    `Corrente di progetto: ${fmt(report.currentA, 0)} A`,
    `Pezzi: ${report.strips.length} - area ${fmt(report.totalAreaCm2, 1)} cm2${report.massG !== null ? ' - ' + fmt(report.massG, 0) + ' g' : ''}`,
    `Saldatrice: ${report.welder.name} - taglio: ${report.cutter.name}`,
    '',
    ...report.issues.map((i) => `[${i.severity}] ${i.message}`),
  ];
  return lines.join('\n') + '\n';
}
