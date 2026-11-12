<script lang="ts">
  import { fmtNum, t } from '../i18n';
  import { area, len, lenLabel, lenNum, massSmall, tempDelta } from '../units';
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import UnitInput from './UnitInput.svelte';
  import { rangeFill } from './rangeFill';
  import { COOLING, type CoolingId } from '../core/sizing';
  import { CUTTER_PROFILES, WELDER_PROFILES } from '../core/profiles';
  import { LAMELLA_MATERIALS } from '../core/materials';
  import { bmsOf } from '../core/bms';
  import { MIN_PRINT_WALL_MM } from '../core/holder';
  import { BALANCE_AWGS, POWER_AWGS } from '../core/wire';
  import { history } from '../state';
  import { freeTabSides, ntcPlanOf, reportOf, tabSideOf } from './lamelle';
  import { ui } from './ui.svelte';

  const project = $derived($history.present);
  const report = $derived(reportOf(project, ui.lamella));
  const sides = $derived(freeTabSides(project, ui.lamella));
  const sideName = { top: t('lam.tabSide.top'), bottom: t('lam.tabSide.bottom'), left: t('lam.tabSide.left'), right: t('lam.tabSide.right') } as const;
  const ntcPlan = $derived(ntcPlanOf(project, ui.lamella, ui.holder));
  const ntcSite = $derived(ntcPlan.site);
  const tabSide = $derived(tabSideOf(project, ui.lamella));
  const material = $derived(report.material);
  const weldLabel = { good: t('lam.weld.good'), fair: t('lam.weld.fair'), poor: t('lam.weld.poor') } as const;
  const fmt = (n: number | null, d = 2) => (n === null ? '—' : fmtNum(n, d));

  function num(e: Event, min: number, max: number): number | null {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  }

  const PRESETS = [
    { k: 15, label: t('lam.preset.careful'), hint: t('lam.preset.carefulHint', { d: tempDelta(15) }) },
    { k: 25, label: t('lam.preset.normal'), hint: t('lam.preset.normalHint', { d: tempDelta(25) }) },
    { k: 40, label: t('lam.preset.pushed'), hint: t('lam.preset.pushedHint', { d: tempDelta(40) }) },
  ] as const;
  const COOLING_TEXT: Record<CoolingId, string> = {
    free: t('lam.cool.free'),
    ventilated: t('lam.cool.ventilated'),
    enclosed: t('lam.cool.enclosed'),
  };
  const isPreset = $derived(PRESETS.some((p) => p.k === ui.lamella.deltaTK));

  /** L'esito in una frase, senza gergo. */
  const verdict = $derived.by(() => {
    const r = report;
    const name = r.material.name.replace(/\s*\(.*\)$/, '');
    if (r.status === 'empty') return '';
    if (r.thicknessMm === null) {
      return t('lam.verdict.none', { name: name.toLowerCase(), required: len(r.requiredMm, 2) });
    }
    const spess = `${len(r.thicknessMm, 2)}${r.layers > 1 ? t('lam.verdict.layers', { n: r.layers }) : ''}`;
    if (r.status === 'error') return t('lam.verdict.error', { name, spec: spess });
    if (r.status === 'warning') return t('lam.verdict.warning', { name, spec: spess, current: fmt(r.currentA, 0) });
    return t('lam.verdict.ok', { name, spec: spess, current: fmt(r.currentA, 0) });
  });
</script>

<div class="stack">
  {#if report.status === 'empty'}
    <section class="sec"><h3><Icon name="layers" /> {t('lam.title')}</h3><p class="note">{t('lam.empty')}</p></section>
  {:else}
    <div class="result {report.status}" role="status">
      <div class="rhead"><Icon name="layers" size={15} /> {t('lam.title')} <span class="badge {report.status}">{report.status === 'ok' ? t('lam.badge.ok') : report.status === 'warning' ? t('lam.badge.warning') : t('lam.badge.error')}</span></div>
      <div class="big">{verdict}</div>
      <div class="small">
        {t('lam.area', { area: area(report.totalAreaCm2, 1) })}{report.massG !== null ? ` · ${massSmall(report.massG, 0)}` : ''}
      </div>
    </div>
  {/if}

  <section class="sec">
    <h3><Icon name="sliders" /> {t('lam.matSection')}</h3>
  <label>{t('lam.material')}
    <select bind:value={ui.lamella.materialId}>
      {#each LAMELLA_MATERIALS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
    </select>
  </label>
  <Help label={t('lam.materialHelp')}>{weldLabel[material.weldability]}. {material.note}</Help>

  <div class="row">
    <label>{t('lam.thickness')}
      <select
        value={ui.lamella.thicknessMm === null ? 'auto' : String(ui.lamella.thicknessMm)}
        onchange={(e) => (ui.lamella.thicknessMm = e.currentTarget.value === 'auto' ? null : Number(e.currentTarget.value))}
      >
        <option value="auto">{t('lam.thicknessAuto')}</option>
        {#each material.thicknessesMm as th (th)}<option value={String(th)}>{len(th, 2)}</option>{/each}
      </select>
    </label>
    <label>{t('lam.linkWidth')}
      <UnitInput
        kind="len"
        min={1}
        max={60}
        step={0.5}
        nullable
        placeholder={report.strips[0] ? report.strips[0].neckMm : 'auto'}
        value={ui.lamella.widthMm}
        onchange={(v) => (ui.lamella.widthMm = v)}
      />
    </label>
  </div>
  </section>

  <section class="sec">
    <h3><Icon name="ruler" /> {t('lam.shape')}</h3>
  <label>
    <span class="top"><span>{t('lam.widen')}</span><b>{ui.lamella.widthMm ? len(ui.lamella.widthMm, 1) : 'auto'}</b></span>
    <input
      use:rangeFill={ui.lamella.widthMm}
      type="range"
      min="0"
      max="26"
      step="0.5"
      value={ui.lamella.widthMm ?? 0}
      oninput={(e) => (ui.lamella.widthMm = e.currentTarget.valueAsNumber > 0 ? e.currentTarget.valueAsNumber : null)}
    />
  </label>
  <Help label={t('lam.what')}>{t('lam.widenHelp')}</Help>

  <label>{t('lam.weldArea')}
    <UnitInput kind="len" min={1} max={30} step={0.5} nullable placeholder="auto" value={ui.lamella.contactDiameterMm} onchange={(v) => (ui.lamella.contactDiameterMm = v)} />
  </label>
  <Help label={t('lam.what')}>{t('lam.weldAreaHelp', { edge: len(1, 0) })}</Help>

  {#if bmsOf(project)}
    <label><span><input type="checkbox" bind:checked={ui.lamella.tabs} /> {t('lam.tabs')}</span></label>
    {#if ui.lamella.tabs}
      <label>{t('lam.tabSide')}
        <select value={ui.lamella.tabSide} onchange={(e) => (ui.lamella.tabSide = e.currentTarget.value as typeof ui.lamella.tabSide)}>
          <option value="auto">{t('lam.tabSide.auto', { side: sideName[tabSide] })}</option>
          {#each ['top', 'bottom', 'left', 'right'] as const as side (side)}
            {#if sides[side] || ui.lamella.tabSide === side}
              <option value={side}>{sideName[side]}{sides[side] ? '' : ` ${t('lam.tabSide.blocked')}`}</option>
            {/if}
          {/each}
        </select>
      </label>
      <div class="row">
        <label>{t('lam.tabWidth')}<UnitInput kind="len" min={2} max={30} step={0.5} value={ui.lamella.tabWidthMm} onchange={(v) => { if (v !== null) ui.lamella.tabWidthMm = v; }} /></label>
        <label>{t('lam.tabLength')}<UnitInput kind="len" min={2} max={60} step={0.5} value={ui.lamella.tabLengthMm} onchange={(v) => { if (v !== null) ui.lamella.tabLengthMm = v; }} /></label>
      </div>
      <div class="row">
        <label>{t('lam.balanceAwg')}
          <select value={String(ui.lamella.balanceAwg)} onchange={(e) => (ui.lamella.balanceAwg = Number(e.currentTarget.value))}>
            {#each BALANCE_AWGS as a (a)}<option value={String(a)}>AWG {a}</option>{/each}
          </select>
        </label>
        <label>{t('lam.powerAwg')}
          <select value={String(ui.lamella.powerAwg)} onchange={(e) => (ui.lamella.powerAwg = Number(e.currentTarget.value))}>
            {#each POWER_AWGS as a (a)}<option value={String(a)}>AWG {a}</option>{/each}
          </select>
        </label>
      </div>
      <label>{t('lam.tabBend')}<UnitInput kind="len" min={0} max={20} step={0.1} value={ui.lamella.tabBendMm} onchange={(v) => { if (v !== null) ui.lamella.tabBendMm = v; }} /></label>
      <Help label={t('lam.what')}>{t('lam.tabsHelp', { min: len(MIN_PRINT_WALL_MM, 1) })}</Help>
    {/if}
    {#if bmsOf(project)?.ntc}
      <label><span><input type="checkbox" bind:checked={ui.lamella.ntc} /> {t('lam.ntc')}</span></label>
      {#if ui.lamella.ntc}
        <label>{t('lam.ntcSize')}<UnitInput kind="len" min={2} max={12} step={0.5} value={ui.lamella.ntcMm} onchange={(v) => { if (v !== null) ui.lamella.ntcMm = v; }} /></label>
        {#if !ntcSite}<p class="note">{t('lam.ntcNone')}</p>{:else if ntcSite.covered}<p class="note">{t('lam.ntcCovered')}</p>{:else if ntcPlan.route?.found}<p class="note">{t('lam.ntcRoute', { len: len(ntcPlan.route.lengthMm, 0), face: ntcPlan.face === 'bottom' ? t('face.bottom') : t('face.top') })}</p>{:else if ntcPlan.route}<p class="note">{t('lam.ntcNoRoute')}</p>{/if}
        <Help label={t('lam.what')}>{t('lam.ntcHelp')}</Help>
      {/if}
    {/if}
  {/if}

  <label>{t('lam.spotsPer')}
    <select
      value={ui.lamella.spotsPerTerminal ?? 'auto'}
      onchange={(e) => (ui.lamella.spotsPerTerminal = e.currentTarget.value === 'auto' ? null : Number(e.currentTarget.value))}
    >
      <option value="auto">{t('lam.spotsAuto')}</option>
      {#each [2, 4, 6, 8] as n (n)}<option value={n}>{t('lam.spotsN', { n })}</option>{/each}
    </select>
  </label>
  <Help label={t('lam.spotsHelpLabel')}>{t('lam.spotsHelp')}</Help>

  <label>
    <span class="top"><span>{t('lam.opacity')}</span><b>{Math.round((1 - ui.stripOpacity) * 100)}%</b></span>
    <input use:rangeFill={ui.stripOpacity} type="range" min="0.2" max="1" step="0.05" bind:value={ui.stripOpacity} style="direction: rtl" />
  </label>

  </section>

  {#if report.status !== 'empty'}
  <button type="button" class="gotoexp" onclick={() => (ui.sideTab = 'file')}><Icon name="download" /> {t('lam.gotoExport')}</button>

    <details class="adv">
      <summary>{t('lam.details')}</summary>
      {#if report.issues.length}
        <ul class="issues">
          {#each report.issues as issue (issue.message)}
            <li class={issue.severity}><span class="dot"></span><span>{issue.message}</span></li>
          {/each}
        </ul>
      {/if}
      {#if report.alternatives.length}
        <p class="alt-title">{t('lam.alternatives')}</p>
        <ul class="alts">
          {#each report.alternatives as a (a)}<li>{a}</li>{/each}
        </ul>
      {/if}
      {#if report.strips.length}
        <p class="alt-title">{t('lam.perStrip')}</p>
        <table>
          <thead><tr><th>{t('lam.th.strip')}</th><th>{t('lam.th.band')}</th><th>{t('lam.th.current')}</th><th>{t('lam.th.thickness')}</th><th>{t('lam.th.spots')}</th></tr></thead>
          <tbody>
            {#each report.strips as s (s.stripId)}
              <tr>
                <td>{s.face === 'top' ? '↑' : '↓'} {s.label}</td>
                <td>{lenNum(s.neckMm, 1)}</td>
                <td>{fmt(s.neckCurrentA, 0)}</td>
                <td>{lenNum(s.requiredMm, 2)}</td>
                <td class:low={s.spotCapacity < s.spotsNeeded || s.spotsCarryA < s.cellCurrentA} title={t('lam.spotsTitle', { n: s.spotsNeeded, carry: fmt(s.spotsCarryA, 0), cell: fmt(s.cellCurrentA, 1) })}>{s.spotsNeeded}/{s.spotCapacity} <small>({fmt(s.spotsCarryA, 0)} A)</small></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <Help label={t('lam.tableHelpLabel')}>{t('lam.tableHelp', { u: lenLabel() })}</Help>
      {/if}
    </details>
  {/if}

  <details class="adv">
    <summary>{t('lam.advanced')}</summary>

    <label>{t('lam.welder')}
      <select bind:value={ui.lamella.welderId}>
        {#each WELDER_PROFILES as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
      </select>
    </label>
    <Help label={t('lam.explain')}>{t('lam.welderHelp')}</Help>

    <div class="row">
      <label>{t('lam.spotCurrent')}
        <input
          type="number"
          min="1"
          step="0.5"
          placeholder={fmt(report.welder.spotCurrentA, 0)}
          value={ui.lamella.spotCurrentA ?? ''}
          onchange={(e) => (ui.lamella.spotCurrentA = e.currentTarget.value === '' ? null : num(e, 1, 100))}
        />
      </label>
      <label>{t('lam.spotSpacing')}
        <UnitInput kind="len" min={1} max={20} step={0.5} nullable placeholder={report.welder.spotSpacingMm} value={ui.lamella.spotSpacingMm} onchange={(v) => (ui.lamella.spotSpacingMm = v)} />
      </label>
    </div>
    <Help label={t('lam.explain')}>{t('lam.spotsNote')}</Help>

    <label>{t('lam.cutter')}
      <select bind:value={ui.lamella.cutterId}>
        {#each CUTTER_PROFILES as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>

    <div class="field">
      <span class="lbl">{t('lam.where')}</span>
      <div class="seg3">
        {#each Object.keys(COOLING) as id (id)}
          <button class:on={ui.lamella.cooling === id} onclick={() => (ui.lamella.cooling = id as CoolingId)}>{COOLING_TEXT[id as CoolingId]}</button>
        {/each}
      </div>
      <span class="hint">{t('lam.whereHint')}</span>
    </div>

    <div class="field">
      <span class="lbl">{t('lam.howHot')}</span>
      <div class="seg3">
        {#each PRESETS as p (p.k)}
          <button class:on={ui.lamella.deltaTK === p.k} title={p.hint} onclick={() => (ui.lamella.deltaTK = p.k)}>{p.label}</button>
        {/each}
      </div>
      <span class="hint">
        {#if isPreset}{t('lam.steady', { hint: PRESETS.find((p) => p.k === ui.lamella.deltaTK)?.hint ?? '' })}{:else}{t('lam.custom', { delta: tempDelta(ui.lamella.deltaTK) })}{/if}
      </span>
    </div>

    <label>{t('lam.layers')}
      <input type="number" min="1" max="4" step="1" value={ui.lamella.layers} onchange={(e) => (ui.lamella.layers = Math.round(num(e, 1, 4) ?? 1))} />
    </label>
    <Help label={t('lam.explain')}>{t('lam.layersHelp')}</Help>

    <div class="row">
      <label>{t('lam.ambient')}
        <UnitInput kind="tempAbs" min={-20} max={60} step={1} value={ui.lamella.ambientC} onchange={(v) => (ui.lamella.ambientC = v ?? 25)} />
      </label>
      <label>{t('lam.cellRise')}
        <UnitInput kind="tempDelta" min={0} max={40} step={1} value={ui.lamella.cellRiseK} onchange={(v) => (ui.lamella.cellRiseK = v ?? 15)} />
      </label>
    </div>
    <Help label={t('lam.cellRiseLabel')}>{t('lam.cellRiseHelp')}</Help>

    <div class="row">
      <label>{t('lam.peak')}
        <input type="number" step="0.1" min="1" value={ui.lamella.peakFactor} onchange={(e) => (ui.lamella.peakFactor = num(e, 1, 10) ?? 1.5)} />
      </label>
      <label>{t('lam.peakSeconds')}
        <input type="number" step="0.5" min="0.1" value={ui.lamella.peakSeconds} onchange={(e) => (ui.lamella.peakSeconds = num(e, 0.1, 60) ?? 1)} />
      </label>
    </div>
    <Help label={t('lam.explain')}>{t('lam.peakHelp')}</Help>

    <label class="inline"><input type="checkbox" bind:checked={ui.showSpots} /> {t('lam.showSpots')}</label>
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
