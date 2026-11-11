<script lang="ts">
  import { history } from '../state';
  import { deleteSelected, fitView, flipSelected, toggleAddTool, toggleSeriesTool } from './actions';
  import Icon from './Icon.svelte';
  import { ui } from './ui.svelte';

  let menuOpen = $state(false);
  const hasSelection = $derived(ui.selected.size > 0);
</script>

<svelte:window onpointerdown={(e) => { if (menuOpen && !(e.target as Element).closest('.menu')) menuOpen = false; }} />

<div class="wrap">
  <div class="toolbar">
    <span class="grp" role="group" aria-label="Cronologia">
      <button class="t" onclick={() => history.undo()} disabled={!$history.canUndo} title="Annulla (Ctrl+Z)" aria-label="Annulla"><Icon name="undo" /></button>
      <button class="t" onclick={() => history.redo()} disabled={!$history.canRedo} title="Ripristina (Ctrl+Y)" aria-label="Ripristina"><Icon name="redo" /></button>
    </span>

    <span class="grp" role="group" aria-label="Strumenti">
      <button class="t" onclick={toggleAddTool} class:on={ui.tool === 'add'} aria-pressed={ui.tool === 'add'} title="Aggiungi celle (A)"><Icon name="plus" /><span class="lbl">Aggiungi</span></button>
      <button class="t" onclick={toggleSeriesTool} class:on={ui.tool === 'series'} aria-pressed={ui.tool === 'series'} title="Serie a pennello (S)"><Icon name="brush" /><span class="lbl">Serie</span></button>
      <button class="t" onclick={flipSelected} disabled={!hasSelection} title="Inverti polarità delle selezionate (P)"><Icon name="swap" /><span class="lbl">Polarità</span></button>
      <button class="t" onclick={deleteSelected} disabled={!hasSelection} title="Elimina le selezionate (Canc / F)"><Icon name="trash" /><span class="lbl">Elimina</span></button>
    </span>

    <span class="grp" role="group" aria-label="Faccia del pacco">
      <button class="t" class:on={ui.face === 'top'} aria-pressed={ui.face === 'top'} onclick={() => (ui.face = 'top')} title="Vista dal lato dei poli rivolti in alto (V)">Sopra</button>
      <button class="t" class:on={ui.face === 'bottom'} aria-pressed={ui.face === 'bottom'} onclick={() => (ui.face = 'bottom')} title="Vista dal lato opposto (V)">Sotto</button>
    </span>

    <span class="grp" role="group" aria-label="Livelli visibili">
      <button class="t" class:on={ui.showStrips} aria-pressed={ui.showStrips} onclick={() => (ui.showStrips = !ui.showStrips)} title="Mostra le lamelle di questa faccia (L)"><Icon name={ui.showStrips ? 'eye' : 'eyeoff'} /><span class="lbl">Lamelle</span></button>
      <button class="t" class:on={ui.showHolder} aria-pressed={ui.showHolder} onclick={() => (ui.showHolder = !ui.showHolder)} title="Mostra la sagoma del portacelle"><Icon name={ui.showHolder ? 'eye' : 'eyeoff'} /><span class="lbl">Holder</span></button>
    </span>

    <span class="grp" role="group" aria-label="Vista del disegno">
      <button class="t" onclick={fitView} title="Inquadra tutto (H)" aria-label="Adatta"><Icon name="fit" /></button>
  <span class="menu">
      <button class="t" class:on={menuOpen} onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} title="Griglia, quote, aggancio"><Icon name="sliders" /><span class="lbl">Vista</span></button>
      {#if menuOpen}
        <div class="pop" role="dialog" aria-label="Opzioni di vista">
          <label class="check"><input type="checkbox" bind:checked={ui.showGrid} /> Griglia</label>
          <label class="check"><input type="checkbox" bind:checked={ui.showDims} /> Quote</label>
          <label class="check snap">
            Aggancio
            <select
              value={String(ui.snap)}
              onchange={(e) => {
                const v = e.currentTarget.value;
                ui.snap = v === 'slot' ? 'slot' : Number(v);
              }}
            >
              <option value="slot">a slot (griglia celle)</option>
              <option value="0">libero</option>
              <option value="0.5">0,5 mm</option>
              <option value="1">1 mm</option>
              <option value="5">5 mm</option>
            </select>
          </label>
          <p class="hint"><kbd>Rotella</kbd> zoom · <kbd>Spazio</kbd>+trascina sposta · <kbd>Maiusc</kbd> aggiunge alla selezione</p>
        </div>
      {/if}
    </span>
    </span>

    <span class="grow"></span>
    <span class="grp" role="group" aria-label="Cosa mostrare (3 per cambiare)">
      <button class="t" class:on={ui.viewMode === 'draw'} aria-pressed={ui.viewMode === 'draw'} onclick={() => (ui.viewMode = 'draw')} title="Solo disegno (3)"><Icon name="draw" /><span class="lbl2">Disegno</span></button>
      <button class="t" class:on={ui.viewMode === 'split'} aria-pressed={ui.viewMode === 'split'} onclick={() => (ui.viewMode = 'split')} title="Disegno e 3D affiancati (3)"><Icon name="split" /><span class="lbl2">Affiancati</span></button>
      <button class="t" class:on={ui.viewMode === '3d'} aria-pressed={ui.viewMode === '3d'} onclick={() => (ui.viewMode = '3d')} title="Solo 3D (3)"><Icon name="box" /><span class="lbl2">3D</span></button>
    </span>
  </div>
</div>

<style>
  .wrap {
    container-type: inline-size;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
  }
  .grow {
    flex: 1;
  }
  .grp {
    display: inline-flex;
  }
  .t {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 34px;
    padding: 0 11px;
    border-radius: 0;
    font-size: 0.86rem;
    white-space: nowrap;
  }
  .grp > .t + .t {
    margin-left: -1px;
  }
  .grp > .t:first-child {
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
  }
  .grp > .t:last-child {
    border-top-right-radius: 8px;
    border-bottom-right-radius: 8px;
  }
  .t.on {
    position: relative;
    z-index: 1;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--panel));
    color: var(--accent);
    font-weight: 600;
  }
  .t:hover:not(:disabled) {
    position: relative;
    z-index: 1;
  }
  .menu {
    position: relative;
    display: inline-flex;
  }
  .menu > .t {
    margin-left: -1px;
    border-top-right-radius: 8px;
    border-bottom-right-radius: 8px;
  }
  .pop {
    position: absolute;
    left: 0;
    bottom: calc(100% + 10px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 280px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.2);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
  }
  .snap {
    justify-content: space-between;
  }
  .snap select {
    width: 170px;
  }
  .hint {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 0.75rem;
    line-height: 1.7;
  }
  kbd {
    font: inherit;
    font-size: 0.9em;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 4px;
  }
  @container (max-width: 940px) {
    .lbl {
      display: none;
    }
    .t {
      padding: 0 10px;
    }
  }
  @container (max-width: 1180px) {
    .lbl2 {
      display: none;
    }
  }
</style>
