<script lang="ts">
  import { fmtNum, t } from '../i18n';
  import { len, lenLabel, lenNum, massSmall } from '../units';
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import UnitInput from './UnitInput.svelte';
  import { bmsOf } from '../core/bms';
  import { DEFAULT_HOLDER_SETTINGS } from '../core/holder';
  import { ntcPlanOf } from './lamelle';
  import { history } from '../state';
  import { clampHolder, holderOf } from './holder';
  import { ui } from './ui.svelte';

  const project = $derived($history.present);
  const ntcPlan = $derived(ntcPlanOf(project, ui.lamella, ui.holder));
  const ntcSite = $derived(ntcPlan.site);
  const built = $derived(holderOf(project, ui.holder));
  const model = $derived(built.model);
  const report = $derived(built.report);
  const fmt = (n: number | null, d = 1) => (n === null ? '—' : fmtNum(n, d));
  const status = $derived(
    !report ? 'empty' : report.issues.some((i) => i.level === 'error') ? 'error' : report.issues.some((i) => i.level === 'warning') ? 'warning' : 'ok',
  );
  // Plastica PETG, 1,27 g/cm³, a riempimento pieno: è il massimo.
  const grams = $derived(report ? (report.volumeMm3 / 1000) * 1.27 : 0);

  type NumKey = Parameters<typeof clampHolder>[0];
  function setNum(key: NumKey, e: Event) {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(v)) ui.holder[key] = clampHolder(key, v);
  }
  function setNumV(key: NumKey, v: number | null) {
    if (v !== null) ui.holder[key] = clampHolder(key, v);
  }
  const reset = () => Object.assign(ui.holder, DEFAULT_HOLDER_SETTINGS);
  const noteLock = $derived(
    model && model.openingDiameterMm !== null ? t('hold.noteLock', { d: len(model.openingDiameterMm, 1), f: len(model.floorMm, 1) }) : t('hold.noteOpen'),
  );

  /** Colori tipici dei filamenti per stampa 3D. */
  const COLORS = [
    { name: t('hold.color.graphite'), hex: '#353b41' },
    { name: t('hold.color.black'), hex: '#111214' },
    { name: t('hold.color.grey'), hex: '#8a9099' },
    { name: t('hold.color.white'), hex: '#e8e8e4' },
    { name: t('hold.color.red'), hex: '#d64541' },
    { name: t('hold.color.orange'), hex: '#e8872b' },
    { name: t('hold.color.yellow'), hex: '#e8c32b' },
    { name: t('hold.color.green'), hex: '#3fa66b' },
    { name: t('hold.color.blue'), hex: '#3a7bd5' },
  ];
</script>

<div class="stack">
  {#if !report || !model}
    <section class="sec"><h3><Icon name="box" /> {t('hold.title')}</h3><p class="note">{t('hold.empty')}</p></section>
  {:else}
    <div class="result {status}">
      <div class="rhead"><Icon name="box" size={15} /> {t('hold.title')} <span class="badge {status}">{status === 'ok' ? t('hold.badge.ok') : status === 'warning' ? t('hold.badge.warning') : t('hold.badge.error')}</span></div>
      <div class="big">{t(report.pieces > 1 ? 'hold.platesSplit' : 'hold.plates', { w: lenNum(report.widthMm, 0), d: lenNum(report.depthMm, 0), u: lenLabel(), n: report.pieces })}</div>
      <div class="small">
        {t('hold.summary', { h: len(report.totalHeightMm, 1), g: massSmall(grams, 0) })}
      </div>
    </div>


    <section class="sec">
      <h3><Icon name="lock" /> {t('hold.warnings')}</h3>
    <ul class="issues">
      {#each report.issues as issue (issue.text)}
        <li class={issue.level}><span class="dot"></span><span>{issue.text}</span></li>
      {/each}
    </ul>

    <button type="button" class="gotoexp" onclick={() => (ui.sideTab = 'file')}><Icon name="download" /> {t('hold.gotoExport')}</button>
    </section>
  {/if}

  <section class="sec">
    <h3><Icon name="eye" /> {t('hold.display')}</h3>
  <div class="toggles">
    <label class="inline"><input type="checkbox" bind:checked={ui.showHolder} /> {t('hold.showHolder')}</label>
    <label class="inline"><input type="checkbox" bind:checked={ui.holderView.showTop} /> {t('hold.upper')}</label>
    <label class="inline"><input type="checkbox" bind:checked={ui.holderView.showBottom} /> {t('hold.lower')}</label>
  </div>
  <div class="field">
    <span class="lbl">{t('hold.colour')}</span>
    <div class="swatches" role="radiogroup" aria-label={t('hold.colourOf')}>
      {#each COLORS as c (c.hex)}
        <button
          type="button"
          role="radio"
          aria-checked={ui.holderView.color.toLowerCase() === c.hex}
          aria-label={c.name}
          title={c.name}
          class="sw"
          class:on={ui.holderView.color.toLowerCase() === c.hex}
          style:background={c.hex}
          onclick={() => (ui.holderView.color = c.hex)}
        ></button>
      {/each}
      <label class="sw custom" class:on={!COLORS.some((c) => c.hex === ui.holderView.color.toLowerCase())} title={t('hold.colourCustom')}>
        <input type="color" aria-label={t('hold.colourCustom')} bind:value={ui.holderView.color} />
      </label>
    </div>
  </div>

  </section>

  <section class="sec">
    <h3><Icon name="ruler" /> {t('hold.shape')}</h3>
  <div class="row">
    <label>{t('hold.wall')}
      <UnitInput kind="len" min={0.8} max={6} step={0.1} value={ui.holder.wallMm} onchange={(v) => setNumV('wallMm', v)} />
    </label>
    <label>{t('hold.clearance')}
      <UnitInput kind="len" min={0} max={1} step={0.05} value={ui.holder.clearanceMm} onchange={(v) => setNumV('clearanceMm', v)} />
    </label>
  </div>
  <Help label={t('hold.clearanceLabel')}>{t('hold.clearanceHelp', { a: len(0.1, 1), b: len(0.2, 1), c: len(0.3, 1) })}</Help>

  <div class="field">
    <span class="lbl">{t('hold.geometry')}</span>
    <div class="seg2">
      <button class:on={ui.holder.shape === 'rounded'} onclick={() => (ui.holder.shape = 'rounded')} title={t('hold.roundedTitle')}>{t('hold.rounded')}</button>
      <button class:on={ui.holder.shape === 'profile'} onclick={() => (ui.holder.shape = 'profile')} title={t('hold.profileTitle')}>{t('hold.profile')}</button>
    </div>
  </div>

  <div class="row">
    <label>{t('hold.fillet')}
      <UnitInput kind="len" min={0} max={10} step={0.5} disabled={ui.holder.shape === 'rounded'} value={ui.holder.filletMm} onchange={(v) => setNumV('filletMm', v)} />
    </label>
    <label>{t('hold.chamfer')}
      <UnitInput kind="len" min={0} max={2} step={0.1} value={ui.holder.chamferMm} onchange={(v) => setNumV('chamferMm', v)} />
    </label>
  </div>
  <Help label={t('hold.what')}>
    {#if ui.holder.shape === 'rounded'}{t('hold.roundedHelp')}{:else}{t('hold.profileHelp')}{/if}
  </Help>

  </section>

  <section class="sec">
    <h3><Icon name="lock" /> {t('hold.lockSection')}</h3>
  <label class="inline"><input type="checkbox" bind:checked={ui.holder.lockCells} /> {t('hold.lock')}</label>
  <Help label={t('hold.lockLabel')}>{noteLock}</Help>

  </section>

  {#if bmsOf(project)?.ntc}
  <section class="sec">
    <h3><Icon name="ruler" /> {t('hold.ntcSection')}</h3>
    <label><span><input type="checkbox" bind:checked={ui.holder.ntc} /> {t('hold.ntc')}</span></label>
    {#if ui.holder.ntc}
      <label>{t('hold.ntcSize')}<UnitInput kind="len" min={2} max={12} step={0.5} value={ui.holder.ntcMm} onchange={(v) => { if (v !== null) ui.holder.ntcMm = v; }} /></label>
      {#if !ntcSite}<p class="note">{t('hold.ntcNone')}</p>{:else if ntcSite.covered}<p class="note">{t('hold.ntcCovered')}</p>{/if}
      <Help label={t('hold.what')}>{t('hold.ntcHelp')}</Help>
    {/if}
  </section>
  {/if}

  <details class="adv">
    <summary>{t('hold.advanced')}</summary>
    <div class="row">
      <label>{t('hold.floor')}
        <UnitInput kind="len" min={0.6} max={4} step={0.2} disabled={!ui.holder.lockCells} value={ui.holder.floorMm} onchange={(v) => setNumV('floorMm', v)} />
      </label>
      <label>{t('hold.lip')}
        <UnitInput kind="len" min={2} max={30} step={1} value={ui.holder.lipMm} onchange={(v) => setNumV('lipMm', v)} />
      </label>
    </div>
    <label>{t('hold.ledge')}
      <UnitInput kind="len" min={0.5} max={4} step={0.25} disabled={!ui.holder.lockCells} value={ui.holder.ledgeMm} onchange={(v) => setNumV('ledgeMm', v)} />
    </label>
    <Help label={t('hold.explain')}>{t('hold.floorHelp')}</Help>
    <div class="row">
      <label>{t('hold.bedX')}
        <UnitInput kind="len" min={50} max={1000} step={10} value={ui.holder.bedXMm} onchange={(v) => setNumV('bedXMm', v)} />
      </label>
      <label>{t('hold.bedY')}
        <UnitInput kind="len" min={50} max={1000} step={10} value={ui.holder.bedYMm} onchange={(v) => setNumV('bedYMm', v)} />
      </label>
    </div>
    <div class="exp"><button onclick={reset}>{t('hold.defaults')}</button></div>
  </details>
</div>

<style>
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
  summary {
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .adv > summary::before {
    content: '▸';
    display: inline-block;
    width: 1.1em;
  }
  .adv[open] > summary::before {
    content: '▾';
  }
  .adv > summary {
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.78rem;
    padding: 0;
  }
  .adv {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .adv > :global(:not(summary)) {
    margin-top: 2px;
  }
  label {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 5px;
    font-size: 0.78rem;
    color: var(--muted);
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  label.inline {
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    flex: none;
    gap: 6px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lbl {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .seg2 {
    display: flex;
  }
  .seg2 button {
    flex: 1;
    padding: 4px 6px;
    font-size: 0.78rem;
    border-radius: 0;
    margin-left: -1px;
  }
  .seg2 button:first-child {
    border-radius: 6px 0 0 6px;
    margin-left: 0;
  }
  .seg2 button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .seg2 button.on {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
    position: relative;
  }
  .toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .sw {
    position: relative;
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid rgba(128, 128, 128, 0.45);
    box-shadow: inset 0 0 0 2px var(--panel);
    cursor: pointer;
  }
  .sw.on {
    border: 2px solid var(--accent);
    box-shadow: inset 0 0 0 2px var(--panel);
  }
  .sw.custom {
    flex: none;
    background: conic-gradient(#e74c3c, #f1c40f, #2ecc71, #3498db, #9b59b6, #e74c3c);
    overflow: hidden;
  }
  .sw.custom input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
  }
  .note {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .rhead {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    color: var(--muted);
    margin-bottom: 3px;
  }
  .badge {
    margin-left: auto;
    padding: 0 7px;
    border-radius: 10px;
    font-size: 0.66rem;
    letter-spacing: 0;
    text-transform: none;
    background: var(--line);
    color: var(--fg);
  }
  .badge.ok {
    background: var(--ok);
    color: #fff;
  }
  .badge.warning {
    background: var(--warn);
    color: #fff;
  }
  .badge.error {
    background: var(--danger);
    color: #fff;
  }
  .result {
    border: 1px solid var(--line);
    border-left-width: 4px;
    border-radius: 8px;
    padding: 8px 10px;
  }
  .result.ok {
    border-left-color: var(--ok);
  }
  .result.warning {
    border-left-color: var(--warn);
  }
  .result.error {
    border-left-color: var(--danger);
  }
  .big {
    font-weight: 700;
    font-size: 0.92rem;
    line-height: 1.35;
  }
  .small {
    font-size: 0.76rem;
    color: var(--muted);
    margin-top: 2px;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .issues li {
    display: flex;
    gap: 8px;
    font-size: 0.8rem;
    line-height: 1.35;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    margin-top: 4px;
    border-radius: 50%;
    background: var(--muted);
  }
  .issues .error .dot {
    background: var(--danger);
  }
  .issues .warning .dot {
    background: var(--warn);
  }
  .exp {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .gotoexp {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 0.82rem;
  }
  .exp button {
    padding: 3px 9px;
    font-size: 0.78rem;
  }
</style>
