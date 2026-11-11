<script lang="ts">
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import { DEFAULT_HOLDER_SETTINGS } from '../core/holder';
  import { history } from '../state';
  import { clampHolder, holderOf } from './holder';
  import { ui } from './ui.svelte';

  const project = $derived($history.present);
  const built = $derived(holderOf(project, ui.holder));
  const model = $derived(built.model);
  const report = $derived(built.report);
  const fmt = (n: number | null, d = 1) => (n === null ? '—' : n.toFixed(d).replace('.', ','));
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
  const reset = () => Object.assign(ui.holder, DEFAULT_HOLDER_SETTINGS);
  const noteLock = $derived(
    model && model.openingDiameterMm !== null ? `Foro Ø ${fmt(model.openingDiameterMm)} mm · fondo ${fmt(model.floorMm)} mm` : 'Le pareti sono aperte da parte a parte.',
  );

  /** Colori tipici dei filamenti per stampa 3D. */
  const COLORS = [
    { name: 'Grafite', hex: '#353b41' },
    { name: 'Nero', hex: '#111214' },
    { name: 'Grigio', hex: '#8a9099' },
    { name: 'Bianco', hex: '#e8e8e4' },
    { name: 'Rosso', hex: '#d64541' },
    { name: 'Arancione', hex: '#e8872b' },
    { name: 'Giallo', hex: '#e8c32b' },
    { name: 'Verde', hex: '#3fa66b' },
    { name: 'Blu', hex: '#3a7bd5' },
  ];
</script>

<div class="stack">
  {#if !report || !model}
    <section class="sec"><h3><Icon name="box" /> Portacelle</h3><p class="note">Aggiungi delle celle per vedere il portacelle.</p></section>
  {:else}
    <div class="result {status}">
      <div class="rhead"><Icon name="box" size={15} /> Portacelle <span class="badge {status}">{status === 'ok' ? 'ok' : status === 'warning' ? 'attenzione' : 'problemi'}</span></div>
      <div class="big">Due piastre da {fmt(report.widthMm, 0)} × {fmt(report.depthMm, 0)} mm</div>
      <div class="small">
        Pacco finito alto {fmt(report.totalHeightMm)} mm. Circa {fmt(grams, 0)} g di plastica l'una (al massimo, riempimento pieno).
      </div>
    </div>


    <section class="sec">
      <h3><Icon name="lock" /> Avvisi di stampa</h3>
    <ul class="issues">
      {#each report.issues as issue (issue.text)}
        <li class={issue.level}><span class="dot"></span><span>{issue.text}</span></li>
      {/each}
    </ul>

    <button type="button" class="gotoexp" onclick={() => (ui.sideTab = 'file')}><Icon name="download" /> Esporta i file STL →</button>
    </section>
  {/if}

  <section class="sec">
    <h3><Icon name="eye" /> Visualizzazione</h3>
  <div class="toggles">
    <label class="inline"><input type="checkbox" bind:checked={ui.showHolder} /> Mostra holder</label>
    <label class="inline"><input type="checkbox" bind:checked={ui.holderView.showTop} /> Superiore</label>
    <label class="inline"><input type="checkbox" bind:checked={ui.holderView.showBottom} /> Inferiore</label>
  </div>
  <div class="field">
    <span class="lbl">Colore</span>
    <div class="swatches" role="radiogroup" aria-label="Colore del portacelle">
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
      <label class="sw custom" class:on={!COLORS.some((c) => c.hex === ui.holderView.color.toLowerCase())} title="Colore a scelta">
        <input type="color" aria-label="Colore a scelta" bind:value={ui.holderView.color} />
      </label>
    </div>
  </div>

  </section>

  <section class="sec">
    <h3><Icon name="ruler" /> Forma</h3>
  <div class="row">
    <label>Parete attorno (mm)
      <input type="number" min="0.8" max="6" step="0.1" value={ui.holder.wallMm} onchange={(e) => setNum('wallMm', e)} />
    </label>
    <label>Gioco cella (mm)
      <input type="number" min="0" max="1" step="0.05" value={ui.holder.clearanceMm} onchange={(e) => setNum('clearanceMm', e)} />
    </label>
  </div>
  <Help label="Cos'è il gioco">Il gioco è lo spazio per lato tra cella e tasca: 0,1 per una stampante precisa, 0,2–0,3 se la tua stampa viene "grassa".</Help>

  <div class="field">
    <span class="lbl">Geometria</span>
    <div class="seg2">
      <button class:on={ui.holder.shape === 'rounded'} onclick={() => (ui.holder.shape = 'rounded')} title="Contorno convesso con gli angoli tondi">Arrotondato</button>
      <button class:on={ui.holder.shape === 'profile'} onclick={() => (ui.holder.shape = 'profile')} title="La sagoma segue le celle">Profilo cella</button>
    </div>
  </div>

  <div class="row">
    <label>Raccordo angoli concavi (mm)
      <input type="number" min="0" max="10" step="0.5" disabled={ui.holder.shape === 'rounded'} value={ui.holder.filletMm} onchange={(e) => setNum('filletMm', e)} />
    </label>
    <label>Smusso bordo esterno (mm)
      <input type="number" min="0" max="2" step="0.1" value={ui.holder.chamferMm} onchange={(e) => setNum('chamferMm', e)} />
    </label>
  </div>
  <Help label="Cosa fa">
    {#if ui.holder.shape === 'rounded'}Il contorno avvolge tutte le celle con gli angoli tondi, senza incavi.{:else}Il raccordo rende liscia la sagoma negli incavi tra le celle e chiude le fessure troppo strette per essere stampate.{/if}
  </Help>

  </section>

  <section class="sec">
    <h3><Icon name="lock" /> Fissaggio celle</h3>
  <label class="inline"><input type="checkbox" bind:checked={ui.holder.lockCells} /> Blocca celle sul lato poli</label>
  <Help label="Cosa cambia">{noteLock}</Help>

  </section>

  <details class="adv">
    <summary>Avanzate</summary>
    <div class="row">
      <label>Spessore fondo (mm)
        <input type="number" min="0.6" max="4" step="0.2" disabled={!ui.holder.lockCells} value={ui.holder.floorMm} onchange={(e) => setNum('floorMm', e)} />
      </label>
      <label>Altezza pareti (mm)
        <input type="number" min="2" max="30" step="1" value={ui.holder.lipMm} onchange={(e) => setNum('lipMm', e)} />
      </label>
    </div>
    <label>Bordo che trattiene la cella (mm)
      <input type="number" min="0.5" max="4" step="0.25" disabled={!ui.holder.lockCells} value={ui.holder.ledgeMm} onchange={(e) => setNum('ledgeMm', e)} />
    </label>
    <Help label="Spiegazione">Il fondo copre il bordo del polo e lascia un foro per saldare. Le lamelle poggiano sul fondo.</Help>
    <div class="row">
      <label>Piano di stampa X (mm)
        <input type="number" min="50" max="1000" step="10" value={ui.holder.bedXMm} onchange={(e) => setNum('bedXMm', e)} />
      </label>
      <label>Piano di stampa Y (mm)
        <input type="number" min="50" max="1000" step="10" value={ui.holder.bedYMm} onchange={(e) => setNum('bedYMm', e)} />
      </label>
    </div>
    <div class="exp"><button onclick={reset}>Valori predefiniti</button></div>
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
