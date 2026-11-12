import { boundsOfCells } from '../core/geometry';
import { loadLocale, saveLocale, setLocale, type Locale } from '../i18n';
import { getPrefs, setPrefs, type Prefs } from '../prefs';
import { getTheme, setTheme, type Theme } from '../theme';
import type { HolderSettings } from '../core/holder';
import type { LamellaSettings } from '../core/lamelle';
import type { LatticeKind } from '../core/lattice';
import type { Face } from '../core/strips';
import type { Project } from '../core/types';
import { bindHolderCuts, loadHolderSettings, loadHolderView, type HolderView } from './holder';
import { bindHolderSettings, holderCutsOf, loadLamellaSettings } from './lamelle';

export type ViewMode = 'draw' | 'split' | '3d';
export type Tool = 'select' | 'add' | 'series';
/** 'slot' = aggancio alle posizioni della griglia di celle; un numero = passo in mm (0 = libero). */
export type Snap = 'slot' | number;

/** Lingua di partenza: quella salvata o quella del browser. Si imposta subito, prima che si disegni qualcosa. */
function initialLocale(): Locale {
  const l = loadLocale();
  setLocale(l);
  return l;
}

/** Stato dell'interfaccia (selezione, strumento, vista). Il progetto sta in `history`. */
class UiState {
  /** Lingua dell'interfaccia; cambiandola App.svelte rimonta tutto. */
  locale = $state<Locale>(initialLocale());
  /** Popup delle impostazioni aperto: sta qui perché cambiando una scelta l'interfaccia si rimonta. */
  settingsOpen = $state(false);
  /** Unità e valuta (si ricordano nel browser); cambiandole App.svelte rimonta tutto. */
  prefs = $state<Prefs>({ ...getPrefs() });
  /** Tema chiaro/scuro/automatico: non rimonta l'interfaccia, basta l'attributo su <html>. */
  theme = $state<Theme>(getTheme());
  setTheme(theme: Theme) {
    setTheme(theme);
    this.theme = getTheme();
  }
  setPref(patch: Partial<Prefs>) {
    // i passi di aggancio dipendono dall'unità: cambiandola si torna all'aggancio a slot
    if (patch.length && patch.length !== getPrefs().length) this.snap = 'slot';
    setPrefs(patch);
    this.prefs = { ...getPrefs() };
  }
  /** Cambia con la lingua e con le preferenze: chiave con cui App.svelte rimonta l'interfaccia. */
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
  /** Disposizione e spazio tra le celle: definiscono la griglia a slot, usata da generatore ed editor. */
  layoutKind = $state<LatticeKind>('hex');
  gapMm = $state(1.5);
  /** Serie (indice 0-based) assegnata dal pennello. */
  activeSeries = $state(0);
  /** Con il pennello imposta anche la polarità secondo la parità della serie. */
  alternateOnPaint = $state(true);
  showGrid = $state(true);
  /** Mostra il contorno con le quote dell'ingombro. */
  showDims = $state(true);
  /** Faccia del pacco che si sta guardando: "Sopra" o "Sotto" (si vedono i poli di quella faccia). */
  face = $state<Face>('top');
  /** Disegna le lamelle sulla faccia visibile. */
  showStrips = $state(false);
  /** Segna i punti di saldatura consigliati. */
  showSpots = $state(true);
  /** Nel DXF delle lamelle include anche i riferimenti di saldatura (layer MARK e SPOTS); spento il file è solo da tagliare. */
  dxfReferences = $state(false);
  /** Opacità del disegno delle lamelle nel 2D (0.2–1). */
  stripOpacity = $state(0.85);
  lamella = $state<LamellaSettings>(loadLamellaSettings());
  /** Disegna il portacelle (sagoma scura attorno alle celle). */
  showHolder = $state(true);
  holder = $state<HolderSettings>(loadHolderSettings());
  holderView = $state<HolderView>(loadHolderView());
  /** Come si parte con un pacco vuoto: null = ancora da scegliere. */
  startMode = $state<'auto' | 'manual' | null>(null);
  /** Scheda aperta nella barra laterale. */
  sideTab = $state<'pack' | 'strips' | 'holder' | 'file'>('pack');
  /** Cosa mostra l'area di lavoro: solo disegno, disegno e 3D affiancati, solo 3D. */
  viewMode = $state<ViewMode>('draw');
  /** Quota (in %) dell'area di lavoro occupata dal 3D quando è affiancato. */
  splitPct = $state(45);
  get show3d() {
    return this.viewMode !== 'draw';
  }
  set show3d(v: boolean) {
    this.viewMode = v ? 'split' : 'draw';
  }
  /** Passa da una vista all'altra: disegno → affiancati → 3D. */
  cycleView() {
    this.viewMode = this.viewMode === 'draw' ? 'split' : this.viewMode === 'split' ? '3d' : 'draw';
  }
  spaceDown = $state(false);
  /** Tipo di cella inserito con lo strumento "aggiungi". */
  addTypeId = $state('21700-5000-10a');
  /** Finestra visibile in mm: origine e larghezza (l'altezza segue le proporzioni dell'editor). */
  view = $state({ x: -20, y: -20, w: 200 });
  /** Elemento SVG dell'editor, per misurarne le proporzioni. */
  stage: SVGSVGElement | null = null;

  /** Toglie dalla selezione le celle che non esistono più (es. dopo un annulla). */
  prune(project: Project) {
    if (this.selected.size === 0) return;
    const alive = new Set(project.cells.map((c) => c.id));
    const kept = [...this.selected].filter((id) => alive.has(id));
    if (kept.length !== this.selected.size) this.selected = new Set(kept);
  }

  /** Inquadra tutte le celle, lasciando attorno un margine in pixel per le quote. */
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
