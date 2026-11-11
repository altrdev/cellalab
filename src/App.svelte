<script lang="ts">
  import { t } from './i18n';
  import { history } from './state';
  import { deleteSelected, fitView, flipSelected, selectAll, stepSeries, toggleAddTool, toggleSeriesTool } from './ui/actions';
  import Editor from './ui/Editor.svelte';
  import Sidebar from './ui/Sidebar.svelte';
  import PackBar from './ui/PackBar.svelte';
  import Toolbar from './ui/Toolbar.svelte';
  import { saveHolderSettings, saveHolderView } from './ui/holder';
  import { saveLamellaSettings } from './ui/lamelle';
  import { ui } from './ui/ui.svelte';

  // Titolo e lingua della pagina seguono la lingua scelta.
  $effect(() => {
    document.documentElement.lang = ui.locale;
    document.title = t('app.title');
  });

  // Le impostazioni delle lamelle si ricordano nel browser.
  $effect(() => {
    saveLamellaSettings($state.snapshot(ui.lamella));
  });

  $effect(() => {
    saveHolderSettings($state.snapshot(ui.holder));
    saveHolderView($state.snapshot(ui.holderView));
  });

  // Dopo un annulla/ripristina alcune celle selezionate possono non esistere più.
  $effect(() => {
    ui.prune($history.present);
  });

  /** Campi in cui si scrive: lì le scorciatoie di tastiera restano spente. Caselle e cursori no. */
  function typing(target: EventTarget | null) {
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    if (target instanceof HTMLInputElement) {
      return !['checkbox', 'radio', 'range', 'button', 'submit', 'file'].includes(target.type);
    }
    return false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (typing(e.target)) return;
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    if (mod) {
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (key === 'y') {
        e.preventDefault();
        history.redo();
      } else if (key === 'a') {
        e.preventDefault();
        selectAll();
      }
      return;
    }
    if (key === ' ') {
      // Su un pulsante o una casella lo spazio serve ad attivarli: non si usa per spostare la vista.
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      ui.spaceDown = true;
    } else if (key === 'p') flipSelected();
    else if (key === 'delete' || key === 'backspace' || key === 'f') deleteSelected();
    else if (key === 'a') toggleAddTool();
    else if (key === 's') toggleSeriesTool();
    else if (key === 'v') ui.face = ui.face === 'top' ? 'bottom' : 'top';
    else if (key === 'l') ui.showStrips = !ui.showStrips;
    else if (ui.tool === 'series' && key === 'arrowright') stepSeries(1);
    else if (ui.tool === 'series' && key === 'arrowleft') stepSeries(-1);
    else if (key === 'h') fitView();
    else if (key === '3') ui.cycleView();
    else if (key === 'escape') {
      ui.selected = new Set();
      ui.tool = 'select';
    }
  }

  function onkeyup(e: KeyboardEvent) {
    if (e.key === ' ') ui.spaceDown = false;
  }
  let mainEl: HTMLElement | undefined = $state();

  // Cambiando vista il disegno cambia dimensioni: lo reinquadra a layout concluso.
  $effect(() => {
    const mode = ui.viewMode;
    if (mode === '3d') return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => fitView()));
    return () => cancelAnimationFrame(id);
  });

  /** Trascina il divisore tra disegno e 3D (a destra su schermi larghi, in basso su quelli stretti). */
  function startDrag(e: PointerEvent) {
    const el = mainEl;
    if (!el) return;
    e.preventDefault();
    const stacked = window.matchMedia('(max-width: 800px)').matches;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const pct = stacked ? ((r.bottom - ev.clientY) / r.height) * 100 : ((r.right - ev.clientX) / r.width) * 100;
      ui.splitPct = Math.min(75, Math.max(25, pct));
    };
    const up = () => {
      fitView();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<svelte:window {onkeydown} {onkeyup} onblur={() => (ui.spaceDown = false)} />

{#key ui.locale}
<div class="app">
  <aside><Sidebar /></aside>
  <main class="m-{ui.viewMode}" bind:this={mainEl}>
    <div class="pane draw"><Editor /></div>
    {#if ui.show3d}
      <div
        class="divider"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('app.resize3d')}
        onpointerdown={startDrag}
      ></div>
      <div class="pane three" style="--pct: {ui.splitPct}%">
        <!-- three.js pesa: si scarica solo quando apri l'anteprima -->
        {#await import('./ui/Preview3D.svelte') then { default: Preview3D }}
          <Preview3D />
        {/await}
      </div>
    {/if}
  </main>
  <div class="bottom"><PackBar /><Toolbar /></div>
</div>
{/key}

<style>
  .app {
    display: grid;
    grid-template-columns: 320px 1fr;
    grid-template-rows: 1fr auto;
    grid-template-areas:
      'side main'
      'side bottom';
    height: 100vh;
    height: 100dvh;
  }
  aside {
    grid-area: side;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    background: var(--panel);
  }
  main {
    position: relative;
    grid-area: main;
    min-height: 0;
    min-width: 0;
    display: flex;
  }
  .pane {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .draw {
    flex: 1;
  }
  .three {
    flex: none;
    width: var(--pct);
    border-left: 1px solid var(--line);
  }
  main.m-3d .draw {
    display: none;
  }
  main.m-3d .three {
    width: auto;
    flex: 1;
    border-left: 0;
  }
  main.m-3d .divider {
    display: none;
  }
  .divider {
    flex: none;
    width: 7px;
    margin: 0 -4px 0 -3px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
  }
  .divider:hover {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .bottom {
    grid-area: bottom;
  }
  @media (max-width: 800px) {
    .app {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(320px, 1fr) auto;
      grid-template-areas: 'side' 'main' 'bottom';
      height: auto;
      min-height: 100dvh;
    }
    aside {
      max-height: 45vh;
      border-right: none;
      border-bottom: 1px solid var(--line);
    }
    main {
      min-height: 320px;
      flex-direction: column;
    }
    .three {
      width: auto;
      height: var(--pct);
      border-left: 0;
      border-top: 1px solid var(--line);
    }
    main.m-3d .three {
      height: auto;
    }
    .divider {
      width: auto;
      height: 7px;
      margin: -3px 0 -4px;
      cursor: row-resize;
    }
  }
</style>
