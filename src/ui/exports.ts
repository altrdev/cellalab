import { buildDxf } from '../core/dxf';
import { buildCutListCsv, buildCutSummary, buildSvg } from '../core/lamelleExport';
import type { Project } from '../core/types';
import { buildToleranceTest } from '../core/holder';
import { holderOf } from './holder';
import { holderStl, type HolderHalf } from './holderMesh';
import { reportOf, stripsOf } from './lamelle';
import { ui } from './ui.svelte';

/** Esportazioni dei file (taglio lamelle, stampa 3D): usate dalla scheda «Esporta». */

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'pacco';

function save(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const faceName = (face: 'top' | 'bottom') => (face === 'top' ? 'sopra' : 'sotto');

export function exportDxf(project: Project, face: 'top' | 'bottom') {
  const report = reportOf(project, ui.lamella);
  const spots = new Map(report.strips.map((r) => [r.stripId, r.spotsNeeded]));
  const dxf = buildDxf(stripsOf(project, ui.lamella), {
    face,
    kerfMm: report.cutter.kerfMm,
    includeContacts: ui.dxfReferences,
    includeLabels: ui.dxfReferences,
    spotsPerTerminal: ui.dxfReferences ? spots : undefined,
    spotDiameterMm: report.welder.spotDiameterMm,
    spotSpacingMm: report.welder.spotSpacingMm,
  });
  save(dxf, `${slug(project.name)}-lamelle-${faceName(face)}.dxf`, 'application/dxf');
}

export function exportSvg(project: Project, face: 'top' | 'bottom') {
  const report = reportOf(project, ui.lamella);
  const spots = new Map(report.strips.map((r) => [r.stripId, r.spotsNeeded]));
  const svg = buildSvg(stripsOf(project, ui.lamella), {
    face,
    kerfMm: report.cutter.kerfMm,
    includeContacts: false,
    spotsPerStrip: spots,
    spotDiameterMm: report.welder.spotDiameterMm,
    spotSpacingMm: report.welder.spotSpacingMm,
    title: project.name,
  });
  save(svg, `${slug(project.name)}-dima-${faceName(face)}.svg`, 'image/svg+xml');
}

export function exportCutList(project: Project) {
  const report = reportOf(project, ui.lamella);
  const text = buildCutSummary(report, project.name) + '\n' + buildCutListCsv(stripsOf(project, ui.lamella), report);
  save(text, `${slug(project.name)}-lista-taglio.txt`, 'text/plain');
}

export function exportStl(project: Project, half: HolderHalf) {
  const model = holderOf(project, ui.holder).model;
  if (!model) return;
  save(holderStl(model, half) as BlobPart, `${slug(project.name)}-portacelle-${faceName(half)}.stl`, 'model/stl');
}

/** Piastra di prova con tasche a giochi diversi, per tarare la stampante; usa il tipo di cella del progetto. */
export function exportToleranceTest(project: Project, clearancesMm: readonly number[]) {
  const typeId = project.cells[0]?.typeId ?? '18650-3000-10a';
  const model = buildToleranceTest(project, typeId, clearancesMm, ui.holder);
  if (!model) return;
  save(holderStl(model, 'bottom') as BlobPart, `pezzo-test-tolleranze-${clearancesMm.map((c) => c.toFixed(2)).join('-')}.stl`, 'model/stl');
}
