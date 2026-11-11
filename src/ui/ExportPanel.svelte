<script lang="ts">
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import { history } from '../state';
  import { exportCutList, exportDxf, exportStl, exportSvg, exportToleranceTest } from './exports';
  import { DEFAULT_TEST_CLEARANCES_MM } from '../core/holder';
  import { holderOf } from './holder';
  import { reportOf } from './lamelle';
  import { ui } from './ui.svelte';

  let { onSave, onOpen }: { onSave: () => void; onOpen: (e: Event) => void } = $props();

  const project = $derived($history.present);
  const empty = $derived(project.cells.length === 0);

  const stripStatus = $derived(empty ? 'empty' : reportOf(project, ui.lamella).status);
  const holderReport = $derived(holderOf(project, ui.holder).report);
  const holderStatus = $derived(
    !holderReport ? 'empty' : holderReport.issues.some((i) => i.level === 'error') ? 'error' : holderReport.issues.some((i) => i.level === 'warning') ? 'warning' : 'ok',
  );

  let testClearances = $state([...DEFAULT_TEST_CLEARANCES_MM]);
  const testValid = $derived(testClearances.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));

  const text: Record<string, string> = {
    empty: 'Aggiungi delle celle per poter esportare.',
    ok: 'Pronto per l\'esportazione.',
    warning: 'Ci sono avvisi: controllali prima di tagliare o stampare.',
    error: 'Ci sono problemi: risolvili prima di tagliare o stampare.',
  };
</script>

<div class="stack">
  <section class="sec">
    <h3><Icon name="file" /> Progetto</h3>
    <div class="row">
      <button onclick={onSave}>Salva JSON</button>
      <label class="button">Apri…<input type="file" accept=".json,application/json" onchange={onOpen} hidden /></label>
    </div>
    <p class="note">Il progetto si salva anche da solo in questo browser.</p>
  </section>

  <section class="sec">
    <h3><Icon name="layers" /> Lamelle <span class="pill {stripStatus}">{stripStatus === 'ok' ? 'ok' : stripStatus === 'warning' ? 'attenzione' : stripStatus === 'error' ? 'problemi' : ''}</span></h3>
    <p class="status {stripStatus}">{text[stripStatus]}</p>
    <div class="exp">
      <button disabled={stripStatus === 'empty'} onclick={() => exportDxf(project, 'top')} title="Per laser, CNC o servizio di taglio (compensa il taglio)">DXF sopra</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportDxf(project, 'bottom')}>DXF sotto</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportSvg(project, 'top')} title="In scala 1:1: stampa al 100% e ritaglia">Dima sopra</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportSvg(project, 'bottom')}>Dima sotto</button>
      <button disabled={stripStatus === 'empty'} onclick={() => exportCutList(project)}>Lista di taglio</button>
    </div>
    <Help label="Che file sono">Il DXF è per laser, CNC o servizi di taglio e compensa lo spessore del taglio. La dima è un disegno in scala 1:1: stampala al 100% e ritaglia a mano. La lista di taglio riassume dimensioni e quantità.</Help>
    {#if stripStatus === 'warning' || stripStatus === 'error'}
      <button type="button" class="goto" onclick={() => (ui.sideTab = 'strips')}>Vai alle lamelle →</button>
    {/if}
  </section>

  <section class="sec">
    <h3><Icon name="box" /> Portacelle <span class="pill {holderStatus}">{holderStatus === 'ok' ? 'ok' : holderStatus === 'warning' ? 'attenzione' : holderStatus === 'error' ? 'problemi' : ''}</span></h3>
    <p class="status {holderStatus}">{text[holderStatus]}</p>
    <div class="exp">
      <button disabled={holderStatus === 'empty'} onclick={() => exportStl(project, 'top')} title="Piastra del lato sopra, già girata per la stampa">STL piastra sopra</button>
      <button disabled={holderStatus === 'empty'} onclick={() => exportStl(project, 'bottom')} title="Piastra del lato sotto">STL piastra sotto</button>
    </div>
    <Help label="Come si stampa">Stampa ogni piastra col fondo piatto sul piano. Sono una lo specchio dell'altra: non scambiarle.</Help>
    {#if holderStatus === 'warning' || holderStatus === 'error'}
      <button type="button" class="goto" onclick={() => (ui.sideTab = 'holder')}>Vai al portacelle →</button>
    {/if}
    <div class="test">
      <span class="lbl">Pezzo test tolleranze · gioco (mm)</span>
      <div class="gaps">
        {#each testClearances as _, i (i)}
          <input type="number" min="0" max="1" step="0.05" bind:value={testClearances[i]} aria-label="Gioco tasca {i + 1}" />
        {/each}
      </div>
      <div class="exp">
        <button disabled={!testValid} onclick={() => exportToleranceTest(project, testClearances)} title="Piastra bassa con una tasca per gioco, dalla più stretta (sinistra) alla più larga">STL pezzo test</button>
      </div>
      <Help label="A cosa serve">Stampa il pezzo test con le impostazioni del portacelle e prova una cella in ogni tasca: scegli quella che entra senza forzare e senza ballare, poi imposta quel gioco. Le tasche vanno dalla più stretta (sinistra) alla più larga (destra); sotto ognuna c'è il gioco inciso in centesimi di mm (10 = 0,10 mm).</Help>
    </div>
  </section>
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
  .gaps input {
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
