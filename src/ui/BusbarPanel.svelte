<script lang="ts">
  import { fmtNum, t } from '../i18n';
  import { area, len, lenLabel, lenNum, massSmall, tempDelta } from '../units';
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import UnitInput from './UnitInput.svelte';
  import { rangeFill } from './rangeFill';
  import { COOLING, type CoolingId } from '../core/sizing';
  import { CUTTER_PROFILES, WELDER_PROFILES } from '../core/profiles';
  import { BUSBAR_MATERIALS } from '../core/materials';
  import { bmsOf } from '../core/bms';
  import { MIN_PRINT_WALL_MM } from '../core/holder';
  import { BALANCE_AWGS, POWER_AWGS, powerAmpacityA } from '../core/wire';
  import { history } from '../state';
  import { freeTabSides, reportOf, tabSideOf } from './busbar';
  import { ui } from './ui.svelte';

  const project = $derived($history.present);
  const report = $derived(reportOf(project, ui.busbar));
  const sides = $derived(freeTabSides(project, ui.busbar));
  const sideName = { top: t('busbarPanel.tabSide.top'), bottom: t('busbarPanel.tabSide.bottom'), left: t('busbarPanel.tabSide.left'), right: t('busbarPanel.tabSide.right') } as const;
  const tabSide = $derived(tabSideOf(project, ui.busbar));
  const material = $derived(report.material);
  const weldLabel = { good: t('busbarPanel.weld.good'), fair: t('busbarPanel.weld.fair'), poor: t('busbarPanel.weld.poor') } as const;
  const fmt = (n: number | null, d = 2) => (n === null ? '—' : fmtNum(n, d));

  function num(e: Event, min: number, max: number): number | null {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  }

  const PRESETS = [
    { k: 15, label: t('busbarPanel.preset.careful'), hint: t('busbarPanel.preset.carefulHint', { d: tempDelta(15) }) },
    { k: 25, label: t('busbarPanel.preset.normal'), hint: t('busbarPanel.preset.normalHint', { d: tempDelta(25) }) },
    { k: 40, label: t('busbarPanel.preset.pushed'), hint: t('busbarPanel.preset.pushedHint', { d: tempDelta(40) }) },
  ] as const;
  const COOLING_TEXT: Record<CoolingId, string> = {
    free: t('busbarPanel.cool.free'),
    ventilated: t('busbarPanel.cool.ventilated'),
    enclosed: t('busbarPanel.cool.enclosed'),
  };
  const isPreset = $derived(PRESETS.some((p) => p.k === ui.busbar.deltaTK));

  /** The outcome in one sentence, no jargon. */
  const verdict = $derived.by(() => {
    const r = report;
    const name = r.material.name.replace(/\s*\(.*\)$/, '');
    if (r.status === 'empty') return '';
    if (r.thicknessMm === null) {
      return t('busbarPanel.verdict.none', { name: name.toLowerCase(), required: len(r.requiredMm, 2) });
    }
    const spess = `${len(r.thicknessMm, 2)}${r.layers > 1 ? t('busbarPanel.verdict.layers', { n: r.layers }) : ''}`;
    if (r.status === 'error') return t('busbarPanel.verdict.error', { name, spec: spess });
    if (r.status === 'warning') return t('busbarPanel.verdict.warning', { name, spec: spess, current: fmt(r.currentA, 0) });
    return t('busbarPanel.verdict.ok', { name, spec: spess, current: fmt(r.currentA, 0) });
  });
</script>

<div class="stack">
  {#if report.status === 'empty'}
    <section class="sec"><h3><Icon name="layers" /> {t('busbarPanel.title')}</h3><p class="note">{t('busbarPanel.empty')}</p></section>
  {:else}
    <div class="result {report.status}" role="status">
      <div class="rhead"><Icon name="layers" size={15} /> {t('busbarPanel.title')} <span class="badge {report.status}">{report.status === 'ok' ? t('busbarPanel.badge.ok') : report.status === 'warning' ? t('busbarPanel.badge.warning') : t('busbarPanel.badge.error')}</span></div>
      <div class="big">{verdict}</div>
      <div class="small">
        {t('busbarPanel.area', { area: area(report.totalAreaCm2, 1) })}{report.massG !== null ? ` · ${massSmall(report.massG, 0)}` : ''}
      </div>
    </div>
  {/if}

  <section class="sec">
    <h3><Icon name="sliders" /> {t('busbarPanel.matSection')}</h3>
  <label>{t('busbarPanel.material')}
    <select bind:value={ui.busbar.materialId}>
      {#each BUSBAR_MATERIALS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
    </select>
  </label>
  <Help label={t('busbarPanel.materialHelp')}>{weldLabel[material.weldability]}. {material.note}</Help>

  <div class="row">
    <label>{t('busbarPanel.thickness')}
      <select
        value={ui.busbar.thicknessMm === null ? 'auto' : String(ui.busbar.thicknessMm)}
        onchange={(e) => (ui.busbar.thicknessMm = e.currentTarget.value === 'auto' ? null : Number(e.currentTarget.value))}
      >
        <option value="auto">{t('busbarPanel.thicknessAuto')}</option>
        {#each material.thicknessesMm as th (th)}<option value={String(th)}>{len(th, 2)}</option>{/each}
      </select>
    </label>
    <label>{t('busbarPanel.linkWidth')}
      <UnitInput
        kind="len"
        min={1}
        max={60}
        step={0.5}
        nullable
        placeholder={report.strips[0] ? report.strips[0].neckMm : 'auto'}
        value={ui.busbar.widthMm}
        onchange={(v) => (ui.busbar.widthMm = v)}
      />
    </label>
  </div>
  </section>

  <section class="sec">
    <h3><Icon name="ruler" /> {t('busbarPanel.shape')}</h3>
  <label>
    <span class="top"><span>{t('busbarPanel.widen')}</span><b>{ui.busbar.widthMm ? len(ui.busbar.widthMm, 1) : 'auto'}</b></span>
    <input
      use:rangeFill={ui.busbar.widthMm}
      type="range"
      min="0"
      max="26"
      step="0.5"
      value={ui.busbar.widthMm ?? 0}
      oninput={(e) => (ui.busbar.widthMm = e.currentTarget.valueAsNumber > 0 ? e.currentTarget.valueAsNumber : null)}
    />
  </label>
  <Help label={t('busbarPanel.what')}>{t('busbarPanel.widenHelp')}</Help>

  <label>{t('busbarPanel.weldArea')}
    <UnitInput kind="len" min={1} max={30} step={0.5} nullable placeholder="auto" value={ui.busbar.contactDiameterMm} onchange={(v) => (ui.busbar.contactDiameterMm = v)} />
  </label>
  <Help label={t('busbarPanel.what')}>{t('busbarPanel.weldAreaHelp', { edge: len(1, 0) })}</Help>

  {#if bmsOf(project)}
    <label><span><input type="checkbox" bind:checked={ui.busbar.tabs} onchange={() => { if (ui.busbar.tabs) ui.holder.wireHoles = false; }} /> {t('busbarPanel.tabs')}</span></label>
    {#if ui.busbar.tabs}
      <label>{t('busbarPanel.tabSide')}
        <select value={ui.busbar.tabSide} onchange={(e) => (ui.busbar.tabSide = e.currentTarget.value as typeof ui.busbar.tabSide)}>
          <option value="auto">{t('busbarPanel.tabSide.auto', { side: sideName[tabSide] })}</option>
          {#each ['top', 'bottom', 'left', 'right'] as const as side (side)}
            {#if sides[side] || ui.busbar.tabSide === side}
              <option value={side}>{sideName[side]}{sides[side] ? '' : ` ${t('busbarPanel.tabSide.blocked')}`}</option>
            {/if}
          {/each}
        </select>
      </label>
      <div class="row">
        <label>{t('busbarPanel.tabWidth')}<UnitInput kind="len" min={2} max={30} step={0.5} value={ui.busbar.tabWidthMm} onchange={(v) => { if (v !== null) ui.busbar.tabWidthMm = v; }} /></label>
        <label>{t('busbarPanel.tabLength')}<UnitInput kind="len" min={2} max={60} step={0.5} value={ui.busbar.tabLengthMm} onchange={(v) => { if (v !== null) ui.busbar.tabLengthMm = v; }} /></label>
      </div>
      <div class="row">
        <label>{t('busbarPanel.balanceAwg')}
          <select value={String(ui.busbar.balanceAwg)} onchange={(e) => (ui.busbar.balanceAwg = Number(e.currentTarget.value))}>
            {#each BALANCE_AWGS as a (a)}<option value={String(a)}>AWG {a}</option>{/each}
          </select>
        </label>
      </div>
      <label>{t('busbarPanel.tabBend')}<UnitInput kind="len" min={0} max={20} step={0.1} value={ui.busbar.tabBendMm} onchange={(v) => { if (v !== null) ui.busbar.tabBendMm = v; }} /></label>
      <Help label={t('busbarPanel.what')}>{t('busbarPanel.tabsHelp', { min: len(MIN_PRINT_WALL_MM, 1) })}</Help>
    {:else}
      <p class="note">{ui.holder.wireHoles ? t('busbarPanel.noTabsHoles') : t('busbarPanel.noTabsAround')}</p>
      <label>{t('busbarPanel.tabSide')}
        <select value={ui.busbar.tabSide} onchange={(e) => (ui.busbar.tabSide = e.currentTarget.value as typeof ui.busbar.tabSide)}>
          <option value="auto">{t('busbarPanel.tabSide.auto', { side: sideName[tabSide] })}</option>
          {#each ['top', 'bottom', 'left', 'right'] as const as side (side)}<option value={side}>{sideName[side]}</option>{/each}
        </select>
      </label>
      <label>{t('busbarPanel.balanceAwg')}
        <select value={String(ui.busbar.balanceAwg)} onchange={(e) => (ui.busbar.balanceAwg = Number(e.currentTarget.value))}>
          {#each BALANCE_AWGS as a (a)}<option value={String(a)}>AWG {a}</option>{/each}
        </select>
      </label>
    {/if}
  {/if}

  <label>{t('busbarPanel.spotsPer')}
    <select
      value={ui.busbar.spotsPerTerminal ?? 'auto'}
      onchange={(e) => (ui.busbar.spotsPerTerminal = e.currentTarget.value === 'auto' ? null : Number(e.currentTarget.value))}
    >
      <option value="auto">{t('busbarPanel.spotsAuto')}</option>
      {#each [2, 4, 6, 8] as n (n)}<option value={n}>{t('busbarPanel.spotsN', { n })}</option>{/each}
    </select>
  </label>
  <Help label={t('busbarPanel.spotsHelpLabel')}>{t('busbarPanel.spotsHelp')}</Help>

  <label>
    <span class="top"><span>{t('busbarPanel.opacity')}</span><b>{Math.round((1 - ui.stripOpacity) * 100)}%</b></span>
    <input use:rangeFill={ui.stripOpacity} type="range" min="0.2" max="1" step="0.05" bind:value={ui.stripOpacity} style="direction: rtl" />
  </label>

  </section>

  <section class="sec">
    <h3><Icon name="bolt" /> {t('busbarPanel.powerTitle')}</h3>
    <label>{t('busbarPanel.powerAwg')}
      <select value={String(ui.busbar.powerAwg)} onchange={(e) => (ui.busbar.powerAwg = Number(e.currentTarget.value))}>
        {#each POWER_AWGS as a (a)}<option value={String(a)}>AWG {a} · ~{powerAmpacityA(a)} A</option>{/each}
      </select>
    </label>
    {#if report.currentA > 0}
      <p class="note" class:warn={powerAmpacityA(ui.busbar.powerAwg) < report.currentA}>{t('busbarPanel.powerCap', { cap: powerAmpacityA(ui.busbar.powerAwg), current: fmt(report.currentA, 0) })}</p>
    {:else}
      <p class="note">{t('busbarPanel.powerNone')}</p>
    {/if}
    {#if bmsOf(project)}
      <label><span><input type="checkbox" bind:checked={ui.busbar.powerTabs} /> {t('busbarPanel.powerTabs')}</span></label>
      {#if !ui.busbar.powerTabs}<p class="note">{t('busbarPanel.powerTabsOff')}</p>{/if}
    {/if}
    <Help label={t('busbarPanel.what')}>{t('busbarPanel.powerHelp')}</Help>
  </section>

  {#if report.status !== 'empty'}
  <button type="button" class="gotoexp" onclick={() => (ui.sideTab = 'file')}><Icon name="download" /> {t('busbarPanel.gotoExport')}</button>

    <details class="adv">
      <summary>{t('busbarPanel.details')}</summary>
      {#if report.issues.length}
        <ul class="issues">
          {#each report.issues as issue (issue.message)}
            <li class={issue.severity}><span class="dot"></span><span>{issue.message}</span></li>
          {/each}
        </ul>
      {/if}
      {#if report.alternatives.length}
        <p class="alt-title">{t('busbarPanel.alternatives')}</p>
        <ul class="alts">
          {#each report.alternatives as a (a)}<li>{a}</li>{/each}
        </ul>
      {/if}
      {#if report.strips.length}
        <p class="alt-title">{t('busbarPanel.perStrip')}</p>
        <table>
          <thead><tr><th>{t('busbarPanel.th.strip')}</th><th>{t('busbarPanel.th.band')}</th><th>{t('busbarPanel.th.current')}</th><th>{t('busbarPanel.th.thickness')}</th><th>{t('busbarPanel.th.spots')}</th></tr></thead>
          <tbody>
            {#each report.strips as s (s.stripId)}
              <tr>
                <td>{s.face === 'top' ? '↑' : '↓'} {s.label}</td>
                <td>{lenNum(s.neckMm, 1)}</td>
                <td>{fmt(s.neckCurrentA, 0)}</td>
                <td>{lenNum(s.requiredMm, 2)}</td>
                <td class:low={s.spotCapacity < s.spotsNeeded || s.spotsCarryA < s.cellCurrentA} title={t('busbarPanel.spotsTitle', { n: s.spotsNeeded, carry: fmt(s.spotsCarryA, 0), cell: fmt(s.cellCurrentA, 1) })}>{s.spotsNeeded}/{s.spotCapacity} <small>({fmt(s.spotsCarryA, 0)} A)</small></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <Help label={t('busbarPanel.tableHelpLabel')}>{t('busbarPanel.tableHelp', { u: lenLabel() })}</Help>
      {/if}
    </details>
  {/if}

  <details class="adv">
    <summary>{t('busbarPanel.advanced')}</summary>

    <label>{t('busbarPanel.welder')}
      <select bind:value={ui.busbar.welderId}>
        {#each WELDER_PROFILES as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
      </select>
    </label>
    <Help label={t('busbarPanel.explain')}>{t('busbarPanel.welderHelp')}</Help>

    <div class="row">
      <label>{t('busbarPanel.spotCurrent')}
        <input
          type="number"
          min="1"
          step="0.5"
          placeholder={fmt(report.welder.spotCurrentA, 0)}
          value={ui.busbar.spotCurrentA ?? ''}
          onchange={(e) => (ui.busbar.spotCurrentA = e.currentTarget.value === '' ? null : num(e, 1, 100))}
        />
      </label>
      <label>{t('busbarPanel.spotSpacing')}
        <UnitInput kind="len" min={1} max={20} step={0.5} nullable placeholder={report.welder.spotSpacingMm} value={ui.busbar.spotSpacingMm} onchange={(v) => (ui.busbar.spotSpacingMm = v)} />
      </label>
    </div>
    <Help label={t('busbarPanel.explain')}>{t('busbarPanel.spotsNote')}</Help>

    <label>{t('busbarPanel.cutter')}
      <select bind:value={ui.busbar.cutterId}>
        {#each CUTTER_PROFILES as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>

    <div class="field">
      <span class="lbl">{t('busbarPanel.where')}</span>
      <div class="seg3">
        {#each Object.keys(COOLING) as id (id)}
          <button class:on={ui.busbar.cooling === id} onclick={() => (ui.busbar.cooling = id as CoolingId)}>{COOLING_TEXT[id as CoolingId]}</button>
        {/each}
      </div>
      <span class="hint">{t('busbarPanel.whereHint')}</span>
    </div>

    <div class="field">
      <span class="lbl">{t('busbarPanel.howHot')}</span>
      <div class="seg3">
        {#each PRESETS as p (p.k)}
          <button class:on={ui.busbar.deltaTK === p.k} title={p.hint} onclick={() => (ui.busbar.deltaTK = p.k)}>{p.label}</button>
        {/each}
      </div>
      <span class="hint">
        {#if isPreset}{t('busbarPanel.steady', { hint: PRESETS.find((p) => p.k === ui.busbar.deltaTK)?.hint ?? '' })}{:else}{t('busbarPanel.custom', { delta: tempDelta(ui.busbar.deltaTK) })}{/if}
      </span>
    </div>

    <label>{t('busbarPanel.layers')}
      <input type="number" min="1" max="4" step="1" value={ui.busbar.layers} onchange={(e) => (ui.busbar.layers = Math.round(num(e, 1, 4) ?? 1))} />
    </label>
    <Help label={t('busbarPanel.explain')}>{t('busbarPanel.layersHelp')}</Help>

    <div class="row">
      <label>{t('busbarPanel.ambient')}
        <UnitInput kind="tempAbs" min={-20} max={60} step={1} value={ui.busbar.ambientC} onchange={(v) => (ui.busbar.ambientC = v ?? 25)} />
      </label>
      <label>{t('busbarPanel.cellRise')}
        <UnitInput kind="tempDelta" min={0} max={40} step={1} value={ui.busbar.cellRiseK} onchange={(v) => (ui.busbar.cellRiseK = v ?? 15)} />
      </label>
    </div>
    <Help label={t('busbarPanel.cellRiseLabel')}>{t('busbarPanel.cellRiseHelp')}</Help>

    <div class="row">
      <label>{t('busbarPanel.peak')}
        <input type="number" step="0.1" min="1" value={ui.busbar.peakFactor} onchange={(e) => (ui.busbar.peakFactor = num(e, 1, 10) ?? 1.5)} />
      </label>
      <label>{t('busbarPanel.peakSeconds')}
        <input type="number" step="0.5" min="0.1" value={ui.busbar.peakSeconds} onchange={(e) => (ui.busbar.peakSeconds = num(e, 0.1, 60) ?? 1)} />
      </label>
    </div>
    <Help label={t('busbarPanel.explain')}>{t('busbarPanel.peakHelp')}</Help>

    <label class="inline"><input type="checkbox" bind:checked={ui.showSpots} /> {t('busbarPanel.showSpots')}</label>
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
  label.inline {
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .note {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .note.warn {
    color: var(--warn);
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .top b {
    color: var(--fg);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
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
  .alt-title {
    margin: 0;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--muted);
  }
  .alts li {
    font-size: 0.78rem;
    line-height: 1.35;
    padding-left: 10px;
    border-left: 2px solid var(--line);
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
  .hint {
    font-size: 0.74rem;
    color: var(--muted);
  }
  .seg3 {
    display: flex;
  }
  .seg3 button {
    flex: 1;
    padding: 4px 6px;
    font-size: 0.78rem;
    border-radius: 0;
    margin-left: -1px;
  }
  .seg3 button:first-child {
    border-radius: 6px 0 0 6px;
    margin-left: 0;
  }
  .seg3 button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .seg3 button.on {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
    position: relative;
  }
  .adv > :global(:not(summary)) {
    margin-top: 2px;
  }
  .gotoexp {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 0.82rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.74rem;
  }
  th,
  td {
    text-align: right;
    padding: 2px 4px;
    border-bottom: 1px solid var(--line);
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  td.low {
    color: var(--danger);
    font-weight: 700;
  }
</style>
