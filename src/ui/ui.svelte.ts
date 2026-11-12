import { boundsOfCells } from '../core/geometry';
import { loadLocale, saveLocale, setLocale, type Locale } from '../i18n';
import { getPrefs, setPrefs, type Prefs } from '../prefs';
import { getTheme, setTheme, type Theme } from '../theme';
import type { HolderSettings } from '../core/holder';
import type { LamellaSettings } from '../core/busbar';
import type { LatticeKind } from '../core/lattice';
import type { Face } from '../core/strips';
import type { Project } from '../core/types';
import { bindHolderCuts, loadHolderSettings, loadHolderView, type HolderView } from './holder';
import { bindHolderSettings, holderCutsOf } from './busbar';
import { loadLamellaSettings } from './busbarSettings';

export type ViewMode = 'draw' | 'split' | '3d';
export type Tool = 'select' | 'add' | 'series';
/** 'slot' = snap to the cell grid positions; a number = step in mm (0 = free). */
export type Snap = 'slot' | number;

/** Starting language: the saved one or the browser's. Set immediately, before anything is drawn. */
function initialLocale(): Locale {
  const l = loadLocale();
  setLocale(l);
  return l;
}

/** Interface state (selection, tool, view). The project lives in `history`. */
class UiState {
  /** Lingua dell'interfaccia; cambiandola App.svelte rimonta tutto. */
  locale = $state<Locale>(initialLocale());
  /** Settings popup open: it lives here because changing a choice remounts the interface. */
  settingsOpen = $state(false);
  /** Units and currency (remembered in the browser); changing them makes App.svelte remount everything. */
  prefs = $state<Prefs>({ ...getPrefs() });
  /** Light/dark/automatic theme: it does not remount the interface, the attribute on <html> is enough. */
  theme = $state<Theme>(getTheme());
  setTheme(theme: Theme) {
    setTheme(theme);
    this.theme = getTheme();
  }
  setPref(patch: Partial<Prefs>) {
    // snap steps depend on the unit: changing it goes back to slot snapping
    if (patch.length && patch.length !== getPrefs().length) this.snap = 'slot';
    setPrefs(patch);
    this.prefs = { ...getPrefs() };
  }
  /** Changes with the language and the preferences: key App.svelte uses to remount the interface. */
  get viewKey() {
    return this.locale + JSON.stringify(this.prefs);
  }
  setLanguage(l: Locale) {
    if (l === this.locale) return;
    setLocale(l);
    saveLocale(l);
    this.locale = l;
  }
  selected = $state<ReadonlySet<string>>(new Set());
  tool = $state<Tool>('select');
  snap = $state<Snap>('slot');
  /** Layout and space between cells: they define the slot grid, used by generator and editor. */
  layoutKind = $state<LatticeKind>('hex');
  gapMm = $state(1.5);
  /** Series (0-based index) assigned by the brush. */
  activeSeries = $state(0);
  /** With the brush it also sets the polarity by the parity of the series. */
  alternateOnPaint = $state(true);
  showGrid = $state(true);
  /** Shows the outline with the dimension marks. */
  showDims = $state(true);
  /** Face of the pack being looked at: "Top" or "Bottom" (the poles of that face are seen). */
  face = $state<Face>('top');
  /** Draws the strips on the visible face. */
  showStrips = $state(false);
  /** Marks the recommended weld spots. */
  showSpots = $state(true);
  /** In the strips DXF it also includes the weld references (MARK and SPOTS layers); off, the file is cut-only. */
  dxfReferences = $state(false);
  /** Opacity of the strips drawing in 2D (0.2–1). */
  stripOpacity = $state(0.85);
  lamella = $state<LamellaSettings>(loadLamellaSettings());
  /** Draws the holder (dark outline around the cells). */
  showHolder = $state(true);
  holder = $state<HolderSettings>(loadHolderSettings());
  holderView = $state<HolderView>(loadHolderView());
  /** How to start with an empty pack: null = still to choose. */
  startMode = $state<'auto' | 'manual' | null>(null);
  /** Tab open in the sidebar. */
  sideTab = $state<'pack' | 'strips' | 'holder' | 'file'>('pack');
  /** What the work area shows: drawing only, drawing and 3D side by side, 3D only. */
  viewMode = $state<ViewMode>('draw');
  /** Share (in %) of the work area taken by the 3D when side by side. */
  splitPct = $state(45);
  get show3d() {
    return this.viewMode !== 'draw';
  }
  set show3d(v: boolean) {
    this.viewMode = v ? 'split' : 'draw';
  }
  /** Switches from one view to the next: drawing → side by side → 3D. */
  cycleView() {
    this.viewMode = this.viewMode === 'draw' ? 'split' : this.viewMode === 'split' ? '3d' : 'draw';
  }
  spaceDown = $state(false);
  /** Cell type inserted with the "add" tool. */
  addTypeId = $state('21700-5000-10a');
  /** Visible window in mm: origin and width (the height follows the editor's proportions). */
  view = $state({ x: -20, y: -20, w: 200 });
  /** SVG element of the editor, to measure its proportions. */
  stage: SVGSVGElement | null = null;

  /** Removes from the selection the cells that no longer exist (e.g. after an undo). */
  prune(project: Project) {
    if (this.selected.size === 0) return;
    const alive = new Set(project.cells.map((c) => c.id));
    const kept = [...this.selected].filter((id) => alive.has(id));
    if (kept.length !== this.selected.size) this.selected = new Set(kept);
  }

  /** Frames all the cells, leaving a margin in pixels around them for the dimension marks. */
  fit(project: Project) {
    const rect = this.stage?.getBoundingClientRect();
    const pw = rect && rect.width > 0 ? rect.width : 800;
    const ph = rect && rect.height > 0 ? rect.height : 600;
    const b = boundsOfCells(project);
    if (!b) {
      this.view = { x: -20, y: -20, w: 200 };
      return;
    }
    const pad = 72;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const mmPerPx = Math.max(bw / Math.max(pw - 2 * pad, 50), bh / Math.max(ph - 2 * pad, 50), 0.01);
    const w = mmPerPx * pw;
    const h = mmPerPx * ph;
    this.view = { x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w };
  }
}

export const ui = new UiState();
bindHolderSettings(() => ui.holder);
bindHolderCuts((project, settings) => holderCutsOf(project, ui.lamella, settings));
