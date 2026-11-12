<script lang="ts">
  import { t } from '../i18n';
  import { len } from '../units';
  import { rangeFill } from './rangeFill';
  import { onMount } from 'svelte';
  import { history } from '../state';
  import { holderOf } from './holder';
  import { harnessOf, reportOf, stripsOf } from './busbar';
  import { PackScene, type ViewPreset } from './scene3d';
  import { ui } from './ui.svelte';

  let host: HTMLDivElement | undefined = $state();
  let scene = $state.raw<PackScene | null>(null);
  let failed = $state<string | null>(null);

  let explosion = $state(0);
  let showCells = $state(true);
  let showPlane = $state(true);
  let showBus = $state(true);
  let showHarness = $state(true);
  let preset = $state<ViewPreset>('iso');

  onMount(() => {
    let created: PackScene | null = null;
    try {
      created = new PackScene(host!);
      created.setView(preset, history.get().present);
      scene = created;
    } catch (err) {
      failed = err instanceof Error ? err.message : t('preview.noWebgl');
    }
    return () => {
      created?.dispose();
      scene = null;
    };
  });

  // Redraws at every change of the pack, the selection or the panel controls.
  $effect(() => {
    const project = $history.present;
    const strips = showBus ? stripsOf(project, ui.busbar) : null;
    const report = showBus ? reportOf(project, ui.busbar) : null;
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
      harness: showHarness && showBus ? harnessOf(project, ui.busbar) : null,
    });
  });

  // View change: re-fit (reading the project must not re-run this effect).
  $effect(() => {
    const p = preset;
    scene?.setView(p, history.get().present);
  });
</script>

<div class="panel" role="region" aria-label={t('preview.aria')}>
  <header>
    <label class="slider">
      {t('preview.explosion')}
      <input use:rangeFill={explosion} type="range" min="0" max="60" step="1" bind:value={explosion} />
      <span>{len(explosion, 0)}</span>
    </label>
    <label class="check"><input type="checkbox" bind:checked={showCells} /> {t('preview.cells')}</label>
    <label class="check" title={t('preview.holderTitle')}><input type="checkbox" bind:checked={ui.showHolder} /> Holder</label>
    <label class="check" title={t('preview.busbarsTitle')}><input type="checkbox" bind:checked={showBus} /> {t('preview.busbars')}</label>
    {#if $history.present.bmsId !== undefined}
      <label class="check" title={t('preview.harnessTitle')}><input type="checkbox" bind:checked={showHarness} /> {t('preview.harness')}</label>
    {/if}
    <label class="check"><input type="checkbox" bind:checked={showPlane} /> {t('preview.plane')}</label>
    <label class="check">
      {t('preview.view')}
      <select bind:value={preset}>
        <option value="iso">{t('preview.iso')}</option>
        <option value="top">{t('preview.viewTop')}</option>
        <option value="front">{t('preview.front')}</option>
        <option value="side">{t('preview.side')}</option>
      </select>
    </label>
    <span class="spacer"></span>
  </header>
  <div class="host" bind:this={host}></div>
  {#if failed}
    <p class="fail">{t('preview.fail', { reason: failed })}</p>
  {:else}
    <p class="legend"><i class="plus"></i> {t('preview.legendPlus')} <i class="minus"></i> {t('preview.legendMinus')} · {t('preview.legendHelp')}</p>
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
