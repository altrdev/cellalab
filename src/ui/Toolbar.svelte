<script lang="ts">
  import { t } from '../i18n';
  import { len } from '../units';
  import { history } from '../state';
  import { deleteSelected, fitView, flipSelected, toggleAddTool, toggleSeriesTool } from './actions';
  import Icon from './Icon.svelte';
  import { ui } from './ui.svelte';

  /** Snap steps in mm: 0.5 / 1 / 5 mm, or 0.01 / 0.05 / 0.25 in with inches. */
  const snapSteps = ui.prefs.length === 'in' ? [0.254, 1.27, 6.35] : [0.5, 1, 5];
  let menuOpen = $state(false);
  const hasSelection = $derived(ui.selected.size > 0);
</script>

<svelte:window onpointerdown={(e) => { if (menuOpen && !(e.target as Element).closest('.menu')) menuOpen = false; }} />

<div class="wrap">
  <div class="toolbar">
    <span class="grp" role="group" aria-label={t('toolbar.history')}>
      <button class="t" onclick={() => history.undo()} disabled={!$history.canUndo} title={t('toolbar.undoTitle')} aria-label={t('toolbar.undo')}><Icon name="undo" /></button>
      <button class="t" onclick={() => history.redo()} disabled={!$history.canRedo} title={t('toolbar.redoTitle')} aria-label={t('toolbar.redo')}><Icon name="redo" /></button>
    </span>

    <span class="grp" role="group" aria-label={t('toolbar.tools')}>
      <button class="t" onclick={toggleAddTool} class:on={ui.tool === 'add'} aria-pressed={ui.tool === 'add'} title={t('toolbar.addTitle')}><Icon name="plus" /><span class="lbl">{t('toolbar.add')}</span></button>
      <button class="t" onclick={toggleSeriesTool} class:on={ui.tool === 'series'} aria-pressed={ui.tool === 'series'} title={t('toolbar.seriesTitle')}><Icon name="brush" /><span class="lbl">{t('toolbar.series')}</span></button>
      <button class="t" onclick={flipSelected} disabled={!hasSelection} title={t('toolbar.flipTitle')}><Icon name="swap" /><span class="lbl">{t('toolbar.flip')}</span></button>
      <button class="t" onclick={deleteSelected} disabled={!hasSelection} title={t('toolbar.deleteTitle')}><Icon name="trash" /><span class="lbl">{t('toolbar.delete')}</span></button>
    </span>

    <span class="grp" role="group" aria-label={t('toolbar.face')}>
      <button class="t" class:on={ui.face === 'top'} aria-pressed={ui.face === 'top'} onclick={() => (ui.face = 'top')} title={t('toolbar.topTitle')}>{t('toolbar.top')}</button>
      <button class="t" class:on={ui.face === 'bottom'} aria-pressed={ui.face === 'bottom'} onclick={() => (ui.face = 'bottom')} title={t('toolbar.bottomTitle')}>{t('toolbar.bottom')}</button>
    </span>

    <span class="grp" role="group" aria-label={t('toolbar.layers')}>
      <button class="t" class:on={ui.showStrips} aria-pressed={ui.showStrips} onclick={() => (ui.showStrips = !ui.showStrips)} title={t('toolbar.stripsTitle')}><Icon name={ui.showStrips ? 'eye' : 'eyeoff'} /><span class="lbl">{t('toolbar.strips')}</span></button>
      <button class="t" class:on={ui.showHolder} aria-pressed={ui.showHolder} onclick={() => (ui.showHolder = !ui.showHolder)} title={t('toolbar.holderTitle')}><Icon name={ui.showHolder ? 'eye' : 'eyeoff'} /><span class="lbl">Holder</span></button>
    </span>

    <span class="grp" role="group" aria-label={t('toolbar.drawingView')}>
      <button class="t" onclick={fitView} title={t('toolbar.fitTitle')} aria-label={t('toolbar.fit')}><Icon name="fit" /></button>
  <span class="menu">
      <button class="t" class:on={menuOpen} onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} title={t('toolbar.viewTitle')}><Icon name="sliders" /><span class="lbl">{t('toolbar.view')}</span></button>
      {#if menuOpen}
        <div class="pop" role="dialog" aria-label={t('toolbar.viewOptions')}>
          <label class="check"><input type="checkbox" bind:checked={ui.showGrid} /> {t('toolbar.grid')}</label>
          <label class="check"><input type="checkbox" bind:checked={ui.showDims} /> {t('toolbar.dims')}</label>
          <label class="check snap">
            {t('toolbar.snap')}
            <select
              value={String(ui.snap)}
              onchange={(e) => {
                const v = e.currentTarget.value;
                ui.snap = v === 'slot' ? 'slot' : Number(v);
              }}
            >
              <option value="slot">{t('toolbar.snapSlot')}</option>
              <option value="0">{t('toolbar.snapFree')}</option>
              {#each snapSteps as v (v)}<option value={String(v)}>{len(v, Number.isInteger(v) ? 0 : 1)}</option>{/each}
            </select>
          </label>
          <p class="hint"><kbd>{t('toolbar.kbdWheel')}</kbd> {t('toolbar.kbdZoom')} · <kbd>{t('toolbar.kbdSpace')}</kbd>{t('toolbar.kbdPan')} · <kbd>{t('toolbar.kbdShift')}</kbd> {t('toolbar.kbdAdd')}</p>
        </div>
      {/if}
    </span>
    </span>

    <span class="grow"></span>
    <span class="grp" role="group" aria-label={t('toolbar.showWhat')}>
      <button class="t" class:on={ui.viewMode === 'draw'} aria-pressed={ui.viewMode === 'draw'} onclick={() => (ui.viewMode = 'draw')} title={t('toolbar.drawOnlyTitle')}><Icon name="draw" /><span class="lbl2">{t('toolbar.draw')}</span></button>
      <button class="t" class:on={ui.viewMode === 'split'} aria-pressed={ui.viewMode === 'split'} onclick={() => (ui.viewMode = 'split')} title={t('toolbar.splitTitle')}><Icon name="split" /><span class="lbl2">{t('toolbar.split')}</span></button>
      <button class="t" class:on={ui.viewMode === '3d'} aria-pressed={ui.viewMode === '3d'} onclick={() => (ui.viewMode = '3d')} title={t('toolbar.only3dTitle')}><Icon name="box" /><span class="lbl2">3D</span></button>
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
