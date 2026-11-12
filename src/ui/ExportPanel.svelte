<script lang="ts">
  import { t } from '../i18n';
  import { len } from '../units';
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import UnitInput from './UnitInput.svelte';
  import { history } from '../state';
  import { exportCutList, exportDxf, exportHarness, exportHolderPiece, exportHolderZip, exportStl, exportSvg, exportToleranceTest } from './exports';
  import { DEFAULT_TEST_CLEARANCES_MM } from '../core/holder';
  import { holderOf } from './holder';
  import { harnessOf, reportOf, stripsOf } from './busbar';
  import { ui } from './ui.svelte';

  let { onSave, onOpen }: { onSave: () => void; onOpen: (e: Event) => void } = $props();

  const project = $derived($history.present);
  const empty = $derived(project.cells.length === 0);

  const harness = $derived(harnessOf(project, ui.busbar));
  const labelOf = $derived(new Map(stripsOf(project, ui.busbar).map((s) => [s.id, s.label] as const)));
  const stripStatus = $derived(empty ? 'empty' : reportOf(project, ui.busbar).status);
  const holderReport = $derived(holderOf(project, ui.holder).report);
  /** Plate too big for the bed: pieces to print and glue. */
  const split = $derived(holderOf(project, ui.holder).split);
  const holderStatus = $derived(
    !holderReport ? 'empty' : holderReport.issues.some((i) => i.level === 'error') ? 'error' : holderReport.issues.some((i) => i.level === 'warning') ? 'warning' : 'ok',
  );

  let testClearances = $state([...DEFAULT_TEST_CLEARANCES_MM]);
  const testValid = $derived(testClearances.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));

  const text: Record<string, string> = {
    empty: t('exp.status.empty'),
    ok: t('exp.status.ok'),
    warning: t('exp.status.warning'),
    error: t('exp.status.error'),
  };
</script>

<div class="stack">
  <section class="sec">
    <h3><Icon name="file" /> {t('exp.project')}</h3>
    <div class="row">
      <button onclick={onSave}>{t('exp.saveJson')}</button>
      <label class="button">{t('exp.open')}<input type="file" accept=".json,application/json" onchange={onOpen} hidden /></label>
    </div>
    <p class="note">{t('exp.autosave')}</p>
  </section>

  <section class="sec">
    <h3><Icon name="layers" /> {t('exp.strips')} <span class="pill {stripStatus}">{stripStatus === 'ok' ? t('exp.badge.ok') : stripStatus === 'warning' ? t('exp.badge.warning') : stripStatus === 'error' ? t('exp.badge.error') : ''}</span></h3>
    <p class="status {stripStatus}">{text[stripStatus]}</p>
    <div class="exp">
      <button disabled={stripStatus === 'empty'} onclick={() => exportDxf(project, 'top')} title={t('exp.dxfTitle')}>{t('exp.dxfTop')}</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportDxf(project, 'bottom')}>{t('exp.dxfBottom')}</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportSvg(project, 'top')} title={t('exp.templateTitle')}>{t('exp.templateTop')}</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportSvg(project, 'bottom')}>{t('exp.templateBottom')}</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportCutList(project)}>{t('exp.cutList')}</button>
    </div>
    <div class="opt">
      <label class="inline"><input type="checkbox" bind:checked={ui.dxfReferences} /> {t('exp.refs')}</label>
      <span class="hint">{t('exp.refsHint')}</span>
    </div>
    <Help label={t('exp.filesLabel')}>{t('exp.filesHelp')}</Help>
    {#if stripStatus === 'warning' || stripStatus === 'error'}
      <button type="button" class="goto" onclick={() => (ui.sideTab = 'strips')}>{t('exp.gotoStrips')}</button>
    {/if}
  </section>

  {#if project.bmsId !== undefined}
    <section class="sec">
      <h3><Icon name="bolt" /> {t('exp.harness')}</h3>
      {#if harness}
        <table class="wires">
          <thead><tr><th>{t('exp.harnessCol.node')}</th><th>{t('exp.harnessCol.from')}</th><th>{t('exp.harnessCol.path')}</th><th>{t('exp.harnessCol.cut')}</th></tr></thead>
          <tbody>
            {#each harness.wires as w (w.node)}
              <tr><td><b>{w.label}</b></td><td>{labelOf.get(w.stripId) ?? ''} · {w.face === 'top' ? t('face.top') : t('face.bottom')}</td><td>{len(w.lengthMm, 0)}</td><td>{len(w.cutMm, 0)}</td></tr>
            {/each}
          </tbody>
        </table>
        <div class="exp"><button onclick={() => exportHarness(project)}>{t('exp.harnessList')}</button></div>
        <Help label={t('exp.filesLabel')}>{t('exp.harnessHelp')}</Help>
      {:else}
        <p class="note">{t('exp.harnessEmpty')}</p>
      {/if}
    </section>
  {/if}

  <section class="sec">
    <h3><Icon name="box" /> {t('exp.holder')} <span class="pill {holderStatus}">{holderStatus === 'ok' ? t('exp.badge.ok') : holderStatus === 'warning' ? t('exp.badge.warning') : holderStatus === 'error' ? t('exp.badge.error') : ''}</span></h3>
    <p class="status {holderStatus}">{text[holderStatus]}</p>
    {#if split}
      <p class="note">{t('exp.splitInfo', { n: split.pieces.length })}</p>
      <div class="pieces">
        {#each split.pieces as piece (piece.id)}
          <div class="piece">
            <b>{piece.id}</b>
            <button onclick={() => exportHolderPiece(project, piece.id, 'top')} title={t('exp.pieceTopTitle', { id: piece.id })}>{t('exp.pieceTop')}</button>
            <button onclick={() => exportHolderPiece(project, piece.id, 'bottom')} title={t('exp.pieceBottomTitle', { id: piece.id })}>{t('exp.pieceBottom')}</button>
          </div>
        {/each}
      </div>
      <div class="exp"><button onclick={() => exportHolderZip(project)}>{t('exp.zipAll')}</button></div>
      <Help label={t('exp.glueLabel')}>{t('exp.glueHelp')}</Help>
    {:else}
      <div class="exp">
        <button disabled={holderStatus === 'empty'} onclick={() => exportStl(project, 'top')} title={t('exp.stlTopTitle')}>{t('exp.stlTop')}</button>
        <button disabled={holderStatus === 'empty'} onclick={() => exportStl(project, 'bottom')} title={t('exp.stlBottomTitle')}>{t('exp.stlBottom')}</button>
      </div>
    {/if}
    <Help label={t('exp.printLabel')}>{t('exp.printHelp')}</Help>
    {#if holderStatus === 'warning' || holderStatus === 'error'}
      <button type="button" class="goto" onclick={() => (ui.sideTab = 'holder')}>{t('exp.gotoHolder')}</button>
    {/if}
    <div class="test">
      <span class="lbl">{t('exp.testTitle')}</span>
      <div class="gaps">
        {#each testClearances as _, i (i)}
<UnitInput kind="len" min={0} max={1} step={0.05} value={testClearances[i]} label={t('exp.pocketClearance', { n: i + 1 })} onchange={(v) => { if (v !== null) testClearances[i] = v; }} />
        {/each}
      </div>
      <div class="exp">
        <button disabled={!testValid} onclick={() => exportToleranceTest(project, testClearances)} title={t('exp.testBtnTitle')}>{t('exp.testBtn')}</button>
      </div>
      <Help label={t('exp.testHelpLabel')}>{t('exp.testHelp')}</Help>
    </div>
  </section>
</div>

<style>
  .wires {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }
  .wires th {
    text-align: left;
    color: var(--muted);
    font-weight: 500;
    padding: 2px 6px 4px 0;
  }
  .wires td {
    padding: 3px 6px 3px 0;
    border-top: 1px solid var(--line);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sec {
    padding: 11px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .sec > h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.86rem;
    font-weight: 650;
    color: var(--fg);
  }
  .sec > h3 :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .row > * {
    flex: 1;
  }
  .button {
    color: var(--fg);
    font-size: 0.9rem;
  }
  .note {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .opt {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  label.inline {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--fg);
  }
  .hint {
    padding-left: 38px; /* under the text, not under the switch */
    font-size: 0.74rem;
    line-height: 1.35;
    color: var(--muted);
  }
  .pieces {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .piece {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    border: 1px solid var(--line);
    border-radius: 8px;
    font-size: 0.8rem;
  }
  .piece button {
    padding: 2px 8px;
    font-size: 0.76rem;
  }
  .exp {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .exp button {
    padding: 4px 10px;
    font-size: 0.8rem;
  }
  .test {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
  .lbl {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .gaps {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .gaps :global(input) {
    flex: 1;
    min-width: 0;
  }
  .pill {
    margin-left: auto;
    padding: 0 7px;
    border-radius: 10px;
    font-size: 0.66rem;
    font-weight: 600;
    color: #fff;
  }
  .pill.ok {
    background: var(--ok);
  }
  .pill.warning {
    background: var(--warn);
  }
  .pill.error {
    background: var(--danger);
  }
  .pill.empty {
    display: none;
  }
  .status {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .status.warning {
    color: var(--warn);
  }
  .status.error {
    color: var(--danger);
  }
  .goto {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    font-size: 0.8rem;
    color: var(--accent);
  }
</style>
