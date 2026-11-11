<script lang="ts">
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import { rangeFill } from './rangeFill';
  import { COOLING, type CoolingId } from '../core/sizing';
  import { CUTTER_PROFILES, WELDER_PROFILES } from '../core/profiles';
  import { LAMELLA_MATERIALS } from '../core/materials';
  import { history } from '../state';
  import { reportOf } from './lamelle';
  import { ui } from './ui.svelte';

  const project = $derived($history.present);
  const report = $derived(reportOf(project, ui.lamella));
  const material = $derived(report.material);
  const weldLabel = { good: 'si salda bene', fair: 'saldatura media', poor: 'si salda male a punti' } as const;
  const fmt = (n: number | null, d = 2) => (n === null ? '—' : n.toFixed(d).replace('.', ','));

  function num(e: Event, min: number, max: number): number | null {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
  }

  const PRESETS = [
    { k: 15, label: 'Prudente', hint: 'si scalda poco (+15 °C)' },
    { k: 25, label: 'Normale', hint: 'tiepida (+25 °C)' },
    { k: 40, label: 'Tirato', hint: 'calda al tatto (+40 °C)' },
  ] as const;
  const COOLING_TEXT: Record<CoolingId, string> = {
    free: 'All\'aperto',
    ventilated: 'Con ventole',
    enclosed: 'Chiuso in un box',
  };
  const isPreset = $derived(PRESETS.some((p) => p.k === ui.lamella.deltaTK));

  /** L'esito in una frase, senza gergo. */
  const verdict = $derived.by(() => {
    const r = report;
    const name = r.material.name.replace(/\s*\(.*\)$/, '');
    if (r.status === 'empty') return '';
    if (r.thicknessMm === null) {
      return `Con ${name.toLowerCase()} non basta: servono almeno ${fmt(r.requiredMm)} mm. Prova un altro materiale, più strati o allarga la lamella.`;
    }
    const spess = `${fmt(r.thicknessMm)} mm${r.layers > 1 ? ` × ${r.layers} strati` : ''}`;
    if (r.status === 'error') return `${name} ${spess}: ci sono problemi da risolvere (vedi sotto).`;
    if (r.status === 'warning') return `${name} ${spess} regge ${fmt(r.currentA, 0)} A, ma c'è qualcosa da controllare (vedi sotto).`;
    return `${name} ${spess}: va bene per ${fmt(r.currentA, 0)} A.`;
  });
</script>

<div class="stack">
  {#if report.status === 'empty'}
    <section class="sec"><h3><Icon name="layers" /> Lamelle</h3><p class="note">Aggiungi celle e assegna le serie per vedere le lamelle.</p></section>
  {:else}
    <div class="result {report.status}" role="status">
      <div class="rhead"><Icon name="layers" size={15} /> Lamelle <span class="badge {report.status}">{report.status === 'ok' ? 'ok' : report.status === 'warning' ? 'attenzione' : 'problemi'}</span></div>
      <div class="big">{verdict}</div>
      <div class="small">
        {fmt(report.totalAreaCm2, 1)} cm² di lamella{report.massG !== null ? ` · ${fmt(report.massG, 0)} g` : ''}
      </div>
    </div>
  {/if}

  <section class="sec">
    <h3><Icon name="sliders" /> Materiale e spessore</h3>
  <label>Materiale
    <select bind:value={ui.lamella.materialId}>
      {#each LAMELLA_MATERIALS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
    </select>
  </label>
  <Help label="Com'è questo materiale">{weldLabel[material.weldability]}. {material.note}</Help>

  <div class="row">
    <label>Spessore
      <select
        value={ui.lamella.thicknessMm === null ? 'auto' : String(ui.lamella.thicknessMm)}
        onchange={(e) => (ui.lamella.thicknessMm = e.currentTarget.value === 'auto' ? null : Number(e.currentTarget.value))}
      >
        <option value="auto">automatico</option>
        {#each material.thicknessesMm as t (t)}<option value={String(t)}>{fmt(t)} mm</option>{/each}
      </select>
    </label>
    <label>Larghezza collegamento (mm)
      <input
        type="number"
        min="1"
        step="0.5"
        placeholder={report.strips[0] ? fmt(report.strips[0].neckMm, 1) : 'auto'}
        value={ui.lamella.widthMm ?? ''}
        onchange={(e) => (ui.lamella.widthMm = e.currentTarget.value === '' ? null : num(e, 1, 60))}
      />
    </label>
  </div>
  </section>

  <section class="sec">
    <h3><Icon name="ruler" /> Forma</h3>
  <label>
    <span class="top"><span>Allarga / stringi i collegamenti</span><b>{ui.lamella.widthMm ? `${fmt(ui.lamella.widthMm, 1)} mm` : 'auto'}</b></span>
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
  <Help label="Cosa fa">Tra le celle vicine ci sono bande larghe quanto scegli. Allargandole le finestre si chiudono; tutto a destra = lamella piena.</Help>

  <label>Ø appoggio sulla cella (mm)
    <input
      type="number"
      min="1"
      step="0.5"
      placeholder="auto"
      value={ui.lamella.contactDiameterMm ?? ''}
      onchange={(e) => (ui.lamella.contactDiameterMm = e.currentTarget.value === '' ? null : num(e, 1, 30))}
    />
  </label>

  <label>
    <span class="top"><span>Trasparenza lamelle</span><b>{Math.round((1 - ui.stripOpacity) * 100)}%</b></span>
    <input use:rangeFill={ui.stripOpacity} type="range" min="0.2" max="1" step="0.05" bind:value={ui.stripOpacity} style="direction: rtl" />
  </label>

  </section>

  {#if report.status !== 'empty'}
  <button type="button" class="gotoexp" onclick={() => (ui.sideTab = 'file')}><Icon name="download" /> Esporta DXF, dima e lista di taglio →</button>

    <details class="adv">
      <summary>Dettagli e consigli</summary>
      {#if report.issues.length}
        <ul class="issues">
          {#each report.issues as issue (issue.message)}
            <li class={issue.severity}><span class="dot"></span><span>{issue.message}</span></li>
          {/each}
        </ul>
      {/if}
      {#if report.alternatives.length}
        <p class="alt-title">Alternative</p>
        <ul class="alts">
          {#each report.alternatives as a (a)}<li>{a}</li>{/each}
        </ul>
      {/if}
      {#if report.strips.length}
        <p class="alt-title">Lamella per lamella</p>
        <table>
          <thead><tr><th>Lamella</th><th>Banda</th><th>Corr.</th><th>Spess. min</th><th>Punti</th></tr></thead>
          <tbody>
            {#each report.strips as s (s.stripId)}
              <tr>
                <td>{s.face === 'top' ? '↑' : '↓'} {s.label}</td>
                <td>{fmt(s.neckMm, 1)}</td>
                <td>{fmt(s.neckCurrentA, 0)}</td>
                <td>{fmt(s.requiredMm)}</td>
                <td class:low={s.spotCapacity < s.spotsNeeded}>{s.spotsNeeded}/{s.spotCapacity}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <Help label="Come leggere la tabella">Larghezza della banda in mm, corrente in A che la attraversa, spessore minimo in mm; punti di saldatura = necessari/possibili (in rosso se non bastano).</Help>
      {/if}
    </details>
  {/if}

  <details class="adv">
    <summary>Avanzate</summary>

    <label>Che saldatrice hai
      <select bind:value={ui.lamella.welderId}>
        {#each WELDER_PROFILES as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
      </select>
    </label>
    <Help label="Spiegazione">Decide lo spessore massimo che riesci a saldare e quanti punti servono.</Help>

    <label>Come tagli le lamelle
      <select bind:value={ui.lamella.cutterId}>
        {#each CUTTER_PROFILES as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>

    <div class="field">
      <span class="lbl">Dove sta il pacco</span>
      <div class="seg3">
        {#each Object.keys(COOLING) as id (id)}
          <button class:on={ui.lamella.cooling === id} onclick={() => (ui.lamella.cooling = id as CoolingId)}>{COOLING_TEXT[id as CoolingId]}</button>
        {/each}
      </div>
      <span class="hint">Un pacco chiuso smaltisce meno calore: servono lamelle più generose.</span>
    </div>

    <div class="field">
      <span class="lbl">Quanto può scaldarsi la lamella</span>
      <div class="seg3">
        {#each PRESETS as p (p.k)}
          <button class:on={ui.lamella.deltaTK === p.k} title={p.hint} onclick={() => (ui.lamella.deltaTK = p.k)}>{p.label}</button>
        {/each}
      </div>
      <span class="hint">
        {#if isPreset}{PRESETS.find((p) => p.k === ui.lamella.deltaTK)?.hint}, a regime.{:else}Valore personalizzato: +{ui.lamella.deltaTK} °C.{/if}
      </span>
    </div>

    <label>Fogli sovrapposti
      <input type="number" min="1" max="4" step="1" value={ui.lamella.layers} onchange={(e) => (ui.lamella.layers = Math.round(num(e, 1, 4) ?? 1))} />
    </label>
    <Help label="Spiegazione">Più fogli saldati insieme portano più corrente, ma la saldatrice deve riuscire a bucarli tutti.</Help>

    <label>Bordo attorno all'appoggio (mm)
      <input type="number" min="0" max="10" step="0.5" value={ui.lamella.stripMarginMm} onchange={(e) => (ui.lamella.stripMarginMm = num(e, 0, 10) ?? 1)} />
    </label>

    <div class="row">
      <label>Temperatura ambiente (°C)
        <input type="number" step="1" value={ui.lamella.ambientC} onchange={(e) => (ui.lamella.ambientC = num(e, -20, 60) ?? 25)} />
      </label>
      <label>Celle più calde di (°C)
        <input type="number" step="1" min="0" max="40" value={ui.lamella.cellRiseK} onchange={(e) => (ui.lamella.cellRiseK = num(e, 0, 40) ?? 15)} />
      </label>
    </div>
    <Help label="Perché le celle">Le bande sono corte e saldate alle celle, che portano via parte del calore. Qui metti di quanto pensi che le celle si scaldino sopra l'ambiente sotto carico: più sono calde, meno calore smaltiscono le lamelle.</Help>

    <div class="row">
      <label>Picchi di corrente (×)
        <input type="number" step="0.1" min="1" value={ui.lamella.peakFactor} onchange={(e) => (ui.lamella.peakFactor = num(e, 1, 10) ?? 1.5)} />
      </label>
      <label>Durata picco (s)
        <input type="number" step="0.5" min="0.1" value={ui.lamella.peakSeconds} onchange={(e) => (ui.lamella.peakSeconds = num(e, 0.1, 60) ?? 1)} />
      </label>
    </div>
    <Help label="Spiegazione">Picchi: per esempio un motore che per 1 secondo assorbe 1,5 volte la corrente normale.</Help>

    <label class="inline"><input type="checkbox" bind:checked={ui.showSpots} /> Mostra i punti di saldatura</label>
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
