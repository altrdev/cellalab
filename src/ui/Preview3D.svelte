<script lang="ts">
  import { rangeFill } from './rangeFill';
  import { onMount } from 'svelte';
  import { history } from '../state';
  import { holderOf } from './holder';
  import { reportOf, stripsOf } from './lamelle';
  import { PackScene, type ViewPreset } from './scene3d';
  import { ui } from './ui.svelte';

  let host: HTMLDivElement | undefined = $state();
  let scene = $state.raw<PackScene | null>(null);
  let failed = $state<string | null>(null);

  let explosion = $state(0);
  let showCells = $state(true);
  let showPlane = $state(true);
  let showBus = $state(true);
  let preset = $state<ViewPreset>('iso');

  onMount(() => {
    let created: PackScene | null = null;
    try {
      created = new PackScene(host!);
      created.setView(preset, history.get().present);
      scene = created;
    } catch (err) {
      failed = err instanceof Error ? err.message : 'WebGL non disponibile';
    }
    return () => {
      created?.dispose();
      scene = null;
    };
  });

  // Ridisegna a ogni modifica del pacco, della selezione o dei comandi del pannello.
  $effect(() => {
    const project = $history.present;
    const strips = showBus ? stripsOf(project, ui.lamella) : null;
    const report = showBus ? reportOf(project, ui.lamella) : null;
    scene?.update(project, {
      explosionMm: explosion,
      showCells,
      showPlane,
      selected: ui.selected,
      strips,
      stripThicknessMm: report?.totalThicknessMm ?? report?.requiredMm ?? 0.3,
      stripColor: report?.material.colorHex,
      holder: ui.showHolder ? holderOf(project, ui.holder).model : null,
      holderTop: ui.holderView.showTop,
      holderBottom: ui.holderView.showBottom,
      holderColor: ui.holderView.color,
    });
  });

  // Cambio vista: reinquadra (la lettura del progetto non deve far rieseguire questo effetto).
  $effect(() => {
    const p = preset;
    scene?.setView(p, history.get().present);
  });
</script>

<div class="panel" role="region" aria-label="Anteprima 3D">
  <header>
    <label class="slider">
      Esplosione
      <input use:rangeFill={explosion} type="range" min="0" max="60" step="1" bind:value={explosion} />
      <span>{explosion} mm</span>
    </label>
    <label class="check"><input type="checkbox" bind:checked={showCells} /> Celle</label>
    <label class="check" title="Portacelle (nascosto nella vista esplosa)"><input type="checkbox" bind:checked={ui.showHolder} /> Holder</label>
    <label class="check" title="Lamelle sopra e sotto (nascoste nella vista esplosa)"><input type="checkbox" bind:checked={showBus} /> Lamelle</label>
    <label class="check"><input type="checkbox" bind:checked={showPlane} /> Piano</label>
    <label class="check">
      Vista
      <select bind:value={preset}>
        <option value="iso">Isometrica</option>
        <option value="top">Dall'alto</option>
        <option value="front">Frontale</option>
        <option value="side">Laterale</option>
      </select>
    </label>
    <span class="spacer"></span>
  </header>
  <div class="host" bind:this={host}></div>
  {#if failed}
    <p class="fail">Impossibile avviare il 3D: {failed}. Il browser potrebbe avere WebGL disattivato.</p>
  {:else}
    <p class="legend"><i class="plus"></i> bottone + con anello rosso <i class="minus"></i> fondo piatto −  · trascina per ruotare, rotella per lo zoom, tasto destro per spostare</p>
  {/if}
</div>

<style>
  .panel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    overflow: hidden;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    font-size: 0.8rem;
  }
  .spacer {
    flex: 1;
  }
  .slider,
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
  }
  .slider input {
    width: 90px;
  }
  .slider span {
    min-width: 3.2em;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .check select {
    width: auto;
    padding: 2px 6px;
  }
  .host {
    flex: 1;
    min-height: 0;
  }
  .legend,
  .fail {
    margin: 0;
    padding: 6px 10px;
    font-size: 0.72rem;
    color: var(--muted);
    border-top: 1px solid var(--line);
  }
  .fail {
    color: var(--danger);
  }
  .legend i {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin: 0 2px 0 4px;
  }
  .legend .plus {
    background: #c9382f;
  }
  .legend .minus {
    background: linear-gradient(135deg, #e6e9ec, #98a0a8);
  }
</style>
