<script lang="ts">
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import { computeStats } from '../core/stats';
  import { nextFreeGroup, suggestGroups, type GroupStrategy } from '../core/autogroup';
  import { BUILTIN_CELL_TYPES, findCellType } from '../core/catalog';
  import { uniqueTypeId, validateCellType } from '../core/celltype';
  import { generateGrid, MAX_GENERATED_CELLS } from '../core/layout';
  import {
    addCustomCellType,
    alternateGroupPolarity,
    applyLayout,
    assignGroups,
    clearPack,
    removeCustomCellType,
    renameProject,
    replaceCells,
    setGenerator,
    setCurrentLimit,
    setCellType,
    updateCustomCellType,
  } from '../core/ops';
  import { parseProject, parseProjectSettings, ProjectParseError, serializeProject } from '../core/project';
  import { drc, history } from '../state';
  import type { CellType } from '../core/types';
  import { assignGroupToSelected, deleteSelected, flipSelected, stepSeries, toggleSeriesTool } from './actions';
  import { groupColor } from './colors';
  import ExportPanel from './ExportPanel.svelte';
  import HolderPanel from './HolderPanel.svelte';
  import { holderOf, sanitizeHolderSettings } from './holder';
  import LamellePanel from './LamellePanel.svelte';
  import { reportOf, sanitizeLamellaSettings } from './lamelle';
  import { ui } from './ui.svelte';

  const project = $derived($history.present);
  const stats = $derived(computeStats(project));
  let showGenericInfo = $state(false);
  const sumErrors = $derived($drc.filter((i) => i.severity === 'error').length);
  const sumWarnings = $derived($drc.filter((i) => i.severity === 'warning').length);
  const sumTone = $derived(sumErrors > 0 ? 'error' : sumWarnings > 0 ? 'warning' : 'ok');
  const sumLabel = $derived(
    sumErrors > 0
      ? `${sumErrors} ${sumErrors === 1 ? 'problema' : 'problemi'}`
      : sumWarnings > 0
        ? `${sumWarnings} ${sumWarnings === 1 ? 'avviso' : 'avvisi'}`
        : 'Tutto a posto',
  );
  const allTypes = $derived([...project.customCellTypes, ...BUILTIN_CELL_TYPES]);
  let series = $state(4);
  let parallel = $state(3);
  let groupNumber = $state(1);
  let autoP = $state(3);
  let strategy = $state<GroupStrategy>('auto');
  const strategyNames = { x: 'a colonne', y: 'a righe', blob: 'a blocchi compatti' } as const;
  let message = $state<{ kind: 'error' | 'ok'; text: string } | null>(null);

  type Tab = typeof ui.sideTab;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'pack', label: 'Pacco' },
    { id: 'strips', label: 'Lamelle' },
    { id: 'holder', label: 'Portacelle' },
    { id: 'file', label: 'Esporta' },
  ];
  // Pallino sulla scheda quando c'è qualcosa da guardare: 'error' rosso, 'warning' giallo.
  const tabFlag = $derived.by((): Record<Tab, 'error' | 'warning' | null> => {
    const strips = project.cells.length > 0 ? reportOf(project, ui.lamella).status : 'empty';
    const issues = holderOf(project, ui.holder).report?.issues ?? [];
    return {
      pack: $drc.some((i) => i.severity === 'error') ? 'error' : $drc.length > 0 ? 'warning' : null,
      strips: strips === 'error' ? 'error' : strips === 'warning' ? 'warning' : null,
      holder: issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warning') ? 'warning' : null,
      file: null,
    };
  });
  function pickTab(id: Tab) {
    ui.sideTab = id;
    if (id === 'strips') ui.showStrips = true; // nella scheda delle lamelle le si vuole vedere
  }

  const selectedType = $derived(findCellType(project, ui.addTypeId));
  const diameter = $derived(selectedType?.diameterMm ?? 18);
  /** Quante celle ci sono in ogni serie (e quante non ne hanno una). */
  const groupCounts = $derived.by(() => {
    const m = new Map<number, number>();
    let none = 0;
    for (const c of project.cells) {
      if (c.group === null) none++;
      else m.set(c.group, (m.get(c.group) ?? 0) + 1);
    }
    return { groups: [...m.entries()].sort((a, b) => a[0] - b[0]), none };
  });

  function selectGroup(g: number) {
    ui.activeSeries = g;
    ui.selected = new Set(project.cells.filter((c) => c.group === g).map((c) => c.id));
  }

  /** Come si sta lavorando: pacco generato (c'è la ricetta), a mano (celle senza ricetta) o ancora vuoto. */
  const packMode = $derived<'generated' | 'manual' | 'empty'>(
    project.cells.length === 0 ? 'empty' : project.generator ? 'generated' : 'manual',
  );
  const generator = $derived(project.generator);
  const genType = $derived(generator ? findCellType(project, generator.typeId) : undefined);
  const typeDirty = $derived(!!generator && generator.typeId !== ui.addTypeId);
  const layoutDirty = $derived(
    !!generator && (generator.kind !== ui.layoutKind || Math.abs(generator.gapMm - ui.gapMm) > 1e-6 || typeDirty),
  );
  /** Nel pacco a mano: celle già inserite di un tipo diverso da quello scelto. */
  const otherTypeCount = $derived(
    project.cells.filter((c) => c.typeId !== ui.addTypeId && (ui.selected.size === 0 || ui.selected.has(c.id))).length,
  );

  // Quando cambia la ricetta (generazione, annulla, apertura di un file) i campi seguono la ricetta.
  $effect(() => {
    const g = project.generator;
    if (g) {
      ui.layoutKind = g.kind;
      ui.gapMm = g.gapMm;
      if (findCellType(project, g.typeId)) ui.addTypeId = g.typeId;
    }
  });

  function applyToPack() {
    const g = project.generator;
    const type = g ? findCellType(project, ui.addTypeId) : undefined;
    if (!g || !type) return;
    const next = applyLayout(project, {
      kind: ui.layoutKind,
      gapMm: ui.gapMm,
      pitchMm: type.diameterMm + ui.gapMm,
      typeId: type.id,
    });
    if (!next) {
      message = {
        kind: 'error',
        text: 'Alcune celle non stanno più sugli slot del pacco generato: non posso adeguarle. Riportale sugli slot oppure rigenera il pacco.',
      };
      return;
    }
    history.commit(() => next);
    message = null;
    ui.fit(history.get().present);
  }

  function generate() {
    const type = findCellType(project, ui.addTypeId);
    if (!type) return;
    try {
      const cells = generateGrid({
        typeId: type.id,
        diameterMm: type.diameterMm,
        series,
        parallel,
        kind: ui.layoutKind,
        gapMm: ui.gapMm,
      });
      history.commit((p) =>
        setGenerator(replaceCells(p, cells), {
          series,
          parallel,
          kind: ui.layoutKind,
          gapMm: ui.gapMm,
          pitchMm: type.diameterMm + ui.gapMm,
          typeId: type.id,
        }),
      );
      ui.selected = new Set();
      ui.startMode = null;
      autoP = parallel;
      ui.fit(history.get().present);
      message = null;
    } catch (err) {
      message = { kind: 'error', text: err instanceof Error ? err.message : 'Impossibile generare il pacco' };
    }
  }

  function applyGroup() {
    if (!Number.isInteger(groupNumber) || groupNumber < 1) {
      message = { kind: 'error', text: 'Il numero del gruppo deve essere un intero >= 1' };
      return;
    }
    assignGroupToSelected(groupNumber - 1);
    message = null;
  }

  function show(ids: string[]) {
    ui.selected = new Set(ids);
  }

  function suggest() {
    const subset = ui.selected.size > 0 ? new Set(ui.selected) : null;
    const target = subset ? project.cells.filter((c) => subset.has(c.id)) : project.cells;
    try {
      const start = subset ? nextFreeGroup(project.cells, subset) : 0;
      const result = suggestGroups(target, autoP, { strategy, startGroup: start });
      history.commit((p) => assignGroups(p, result.groups));
      message = {
        kind: 'ok',
        text:
          `${result.groupCount} gruppi da ${autoP} celle (S${start + 1}–S${start + result.groupCount}), ` +
          `disposizione ${strategyNames[result.strategy]}. Controlla l'ordine in serie e correggi a mano se serve.`,
      };
    } catch (err) {
      message = { kind: 'error', text: err instanceof Error ? err.message : 'Impossibile suggerire i gruppi' };
    }
  }

  function alternate() {
    const ids = ui.selected.size > 0 ? [...ui.selected] : undefined;
    history.commit((p) => alternateGroupPolarity(p, ids));
  }

  // ---- Catalogo celle
  let draft = $state<CellType | null>(null);
  let editingId = $state<string | null>(null);
  let draftErrors = $state<string[]>([]);

  function startDraft(from: CellType, editing: boolean) {
    const copy: CellType = { ...from };
    delete copy.generic;
    if (!editing) copy.name = `${from.name} (mia)`;
    draft = copy;
    editingId = editing ? from.id : null;
    draftErrors = [];
  }

  function newDraft() {
    startDraft(selectedType ?? BUILTIN_CELL_TYPES[0]!, false);
  }

  function cancelDraft() {
    draft = null;
    editingId = null;
    draftErrors = [];
  }

  function saveDraft() {
    if (!draft) return;
    const t: CellType = { ...draft, name: draft.name.trim() };
    if (t.priceEur == null || Number.isNaN(t.priceEur)) delete t.priceEur;
    const problems = validateCellType(t);
    if (problems.length > 0) {
      draftErrors = problems;
      return;
    }
    if (editingId) {
      history.commit((p) => updateCustomCellType(p, t));
    } else {
      t.id = uniqueTypeId(project, t.name);
      history.commit((p) => addCustomCellType(p, t));
      ui.addTypeId = t.id;
    }
    cancelDraft();
  }

  function removeType(id: string) {
    try {
      history.commit((p) => removeCustomCellType(p, id));
      if (ui.addTypeId === id) ui.addTypeId = BUILTIN_CELL_TYPES[0]!.id;
      message = null;
    } catch (err) {
      message = { kind: 'error', text: err instanceof Error ? err.message : 'Impossibile eliminare il tipo' };
    }
  }

  const typeSummary = (t: CellType) =>
    `${t.diameterMm}×${t.heightMm} mm · ${t.capacityAh} Ah · ${t.maxDischargeA} A` +
    (t.priceEur !== undefined ? ` · ${t.priceEur.toFixed(2)} €` : '');

  function clearAll() {
    history.commit((p) => clearPack(p));
    ui.selected = new Set();
    ui.startMode = null;
  }

  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'pacco';

  function download() {
    const blob = new Blob([serializeProject(project, { lamella: $state.snapshot(ui.lamella), holder: $state.snapshot(ui.holder) })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(project.name)}.cellalab.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function open(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5_000_000) {
      message = { kind: 'error', text: 'File troppo grande per essere un progetto CellaLab' };
      return;
    }
    try {
      const text = await file.text();
      const opened = parseProject(text);
      const saved = parseProjectSettings(text);
      history.reset(opened);
      // lamelle e portacelle: si usano le impostazioni del file; se non ci sono restano quelle correnti
      if (saved.lamella !== undefined) Object.assign(ui.lamella, sanitizeLamellaSettings(saved.lamella));
      if (saved.holder !== undefined) Object.assign(ui.holder, sanitizeHolderSettings(saved.holder));
      ui.selected = new Set();
      ui.fit(history.get().present);
      message = {
        kind: 'ok',
        text: `Aperto: ${file.name}${saved.lamella !== undefined || saved.holder !== undefined ? ' (con le impostazioni di lamelle e portacelle)' : ''}`,
      };
    } catch (err) {
      message = { kind: 'error', text: err instanceof ProjectParseError ? err.message : 'Impossibile leggere il file' };
    }
  }
</script>

<div class="side">
  <header>
    <h1>CellaLab</h1>
    <input
      class="name"
      aria-label="Nome del progetto"
      value={project.name}
      oninput={(e) => history.commit((p) => renameProject(p, e.currentTarget.value), { coalesceKey: 'rename' })}
    />
  </header>

  {#if message}
    <p class="banner" class:error={message.kind === 'error'} role="status">{message.text}</p>
  {/if}

  <div class="tabs" role="tablist" aria-label="Sezioni">
    {#each tabs as t (t.id)}
      <button role="tab" aria-selected={ui.sideTab === t.id} class:on={ui.sideTab === t.id} onclick={() => pickTab(t.id)}>
        {t.label}{#if tabFlag[t.id]}<span class="flag {tabFlag[t.id]}" title={tabFlag[t.id] === 'error' ? 'Ci sono problemi' : 'Ci sono avvisi'}></span>{/if}
      </button>
    {/each}
  </div>

  {#if ui.sideTab === 'pack'}

  {#snippet layoutFields(dia: number)}
    <div class="row">
      <label>Disposizione
        <select bind:value={ui.layoutKind}>
          <option value="hex">Esagonale (compatta)</option>
          <option value="square">Quadrata</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label>Spazio tra celle (mm)<input type="number" min="0" max="20" step="0.1" bind:value={ui.gapMm} /></label>
      <label title="Distanza tra i centri di due celle vicine = diametro + spazio">Centro-centro (mm)
        <input
          type="number"
          min={dia}
          max={dia + 20}
          step="0.1"
          value={Math.round((dia + ui.gapMm) * 100) / 100}
          onchange={(e) => {
            const v = e.currentTarget.valueAsNumber;
            if (Number.isFinite(v)) ui.gapMm = Math.max(0, Math.round((v - dia) * 100) / 100);
          }}
        />
      </label>
    </div>
  {/snippet}

  {#snippet seriesParallel()}
    <div class="row">
      <label>S (serie)<input type="number" min="1" max={MAX_GENERATED_CELLS} step="1" bind:value={series} /></label>
      <label>P (parallelo)<input type="number" min="1" max={MAX_GENERATED_CELLS} step="1" bind:value={parallel} /></label>
    </div>
  {/snippet}

  {#snippet generateButton(verb: string)}
    <button class="primary" onclick={generate}>{verb} {Number.isInteger(series) && Number.isInteger(parallel) ? `${series}S${parallel}P` : 'pacco'}</button>
    <p class="note">Sostituisce le celle attuali; puoi annullare con Ctrl+Z.</p>
  {/snippet}

  {#if project.cells.length > 0}
    <div class="sum {sumTone}" role="status">
      <div class="sum-main">
        <span class="cfg">{stats.configLabel ?? `${stats.cellCount} celle`}</span>
        <span class="pill">{sumLabel}</span>
      </div>
      <div class="sum-grid">
        <span><b>{stats.nominalV === null ? '—' : stats.nominalV.toFixed(1)} V</b>tensione</span>
        <span><b>{stats.energyWh === null ? '—' : stats.energyWh.toFixed(0)} Wh</b>energia</span>
        <span><b>{stats.maxCurrentA === null ? '—' : stats.maxCurrentA.toFixed(0)} A</b>{stats.limitedByBms ? 'corrente · BMS' : 'corrente'}</span>
      </div>
    </div>
  {/if}

  {#if !(packMode === 'empty' && ui.startMode === null)}
  <details class="sec" open>
    <summary><Icon name="battery" /> Cella</summary>
    <label>{packMode === 'generated' ? 'Cella del pacco' : packMode === 'manual' ? 'Cella da aggiungere' : 'Tipo di cella'}
      <select bind:value={ui.addTypeId}>
        {#each allTypes as t (t.id)}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>
    </label>
    {#if selectedType}
      <div class="spec">
        <span>{typeSummary(selectedType)}</span>
        {#if selectedType.generic}
          <button type="button" class="tag" class:on={showGenericInfo} onclick={() => (showGenericInfo = !showGenericInfo)} title="Valori generici di catalogo">generico</button>
        {/if}
      </div>
      {#if selectedType.generic && showGenericInfo}
        <p class="note">Sono valori tipici di catalogo, non di una cella precisa: verifica sulla scheda tecnica, oppure duplicala e metti i tuoi dati.</p>
      {/if}
    {/if}
    {#if packMode === 'manual' && otherTypeCount > 0}
      <button type="button" onclick={() => history.commit((p) => setCellType(p, ui.addTypeId, ui.selected.size > 0 ? ui.selected : undefined))}>
        {ui.selected.size > 0 ? `Usa questa cella per le ${otherTypeCount} selezionate` : `Usa questa cella per tutte le ${otherTypeCount} altre`}
      </button>
    {/if}
    {#if !draft}
      <div class="row">
        {#if selectedType && !selectedType.generic && project.customCellTypes.some((c) => c.id === selectedType.id)}
          <button onclick={() => startDraft(selectedType, true)}>Modifica</button>
          <button onclick={() => removeType(selectedType.id)}>Elimina</button>
        {:else}
          <button onclick={() => selectedType && startDraft(selectedType, false)}>Duplica e modifica</button>
        {/if}
      </div>
    {/if}
    {#if draft}
      <form class="draft" onsubmit={(e) => { e.preventDefault(); saveDraft(); }}>
        <label>Nome<input type="text" bind:value={draft.name} maxlength="60" /></label>
        <label>Chimica
          <select bind:value={draft.chemistry}>
            <option value="li-ion">Li-ion</option>
            <option value="lifepo4">LiFePO4</option>
          </select>
        </label>
        <div class="row">
          <label>Diametro (mm)<input type="number" step="0.1" bind:value={draft.diameterMm} /></label>
          <label>Altezza (mm)<input type="number" step="0.1" bind:value={draft.heightMm} /></label>
        </div>
        <div class="row">
          <label>V min<input type="number" step="0.05" bind:value={draft.minV} /></label>
          <label>V nom<input type="number" step="0.05" bind:value={draft.nominalV} /></label>
          <label>V max<input type="number" step="0.05" bind:value={draft.maxV} /></label>
        </div>
        <div class="row">
          <label>Capacità (Ah)<input type="number" step="0.1" bind:value={draft.capacityAh} /></label>
          <label>Scarica max (A)<input type="number" step="0.5" bind:value={draft.maxDischargeA} /></label>
        </div>
        <div class="row">
          <label>Peso (g)<input type="number" step="0.5" bind:value={draft.weightG} /></label>
          <label>Prezzo (€/cella)<input type="number" step="0.01" min="0" placeholder="facoltativo" bind:value={draft.priceEur} /></label>
        </div>
        {#if draftErrors.length > 0}
          <ul class="errs">{#each draftErrors as err (err)}<li>{err}</li>{/each}</ul>
        {/if}
        <div class="row">
          <button type="submit" class="primary">{editingId ? 'Salva modifiche' : 'Aggiungi al catalogo'}</button>
          <button type="button" onclick={cancelDraft}>Annulla</button>
        </div>
      </form>
    {/if}
  </details>
  {/if}

  {#if !(packMode === 'empty' && ui.startMode === null)}
  <details class="sec" open>
    <summary><Icon name="bolt" /> Corrente</summary>
    <label>Limite del pacco / BMS (A)
      <input
        type="number"
        min="0"
        step="1"
        placeholder={stats.cellCurrentA === null ? 'nessuno' : `celle: ${stats.cellCurrentA.toFixed(0)}`}
        value={project.currentLimitA ?? ''}
        onchange={(e) => {
          const v = e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value);
          history.commit((p) => setCurrentLimit(p, v));
        }}
      />
    </label>
    <Help label="Come funziona">
      {#if stats.cellCurrentA === null}Con le celle il pacco regge quanto indicato dalle schede; il BMS può limitarlo.
      {:else if stats.limitedByBms}Il BMS limita il pacco a {stats.maxCurrentA?.toFixed(0)} A (le celle reggerebbero {stats.cellCurrentA.toFixed(0)} A). Lamelle e verifiche usano {stats.maxCurrentA?.toFixed(0)} A.
      {:else}Vuoto = corrente massima delle celle ({stats.cellCurrentA.toFixed(0)} A). Scrivi la corrente continua del tuo BMS o dell'uso previsto: le lamelle si dimensionano su quella.{/if}
    </Help>
  </details>
  {/if}

  {#if packMode === 'empty' && ui.startMode === null}
    <section class="sec start">
      <h2>Come vuoi partire?</h2>
      <button class="choice" onclick={() => (ui.startMode = 'auto')}>
        <b>Genera automaticamente</b>
        <span>Scegli cella, serie (S) e parallelo (P): il pacco si costruisce da solo.</span>
      </button>
      <button class="choice" onclick={() => (ui.startMode = 'manual')}>
        <b>Disegna a mano</b>
        <span>Parti da un disegno vuoto e aggiungi le celle una alla volta o a pennello.</span>
      </button>
    </section>
  {:else if packMode === 'empty' && ui.startMode === 'auto'}
    <details class="sec" open>
      <summary><Icon name="wand" /> Genera pacco</summary>
      <button class="back" onclick={() => (ui.startMode = null)}>← Cambia scelta</button>
      {@render seriesParallel()}
      {@render layoutFields(diameter)}
      {@render generateButton('Genera')}
    </details>
  {:else if packMode === 'empty'}
    <details class="sec" open>
      <summary><Icon name="pen" /> Disegna a mano</summary>
      <button class="back" onclick={() => (ui.startMode = null)}>← Cambia scelta</button>
      {@render layoutFields(diameter)}
      <Help label="Come si aggiungono">Aggiungi le celle con <b>＋ Aggiungi</b> (tasto A) nella barra sotto il disegno, poi assegna le serie col pennello (tasto S). La griglia a slot segue disposizione e spazio.</Help>
    </details>
  {:else if packMode === 'generated'}
    <details class="sec" open>
      <summary><Icon name="grid" /> Pacco generato</summary>
      <p class="note">{genType?.name ?? 'Cella'} · {generator?.series}S{generator?.parallel}P all'origine</p>
      {@render layoutFields(diameter)}
      <button class="primary" onclick={applyToPack} disabled={!layoutDirty}>Applica al pacco</button>
      {#if layoutDirty}
        <p class="note warn">
          {#if typeDirty}Hai scelto un'altra cella: premi Applica per sostituirla in tutto il pacco e adeguare il passo.{:else}La griglia è cambiata ma le celle sono ancora al vecchio passo: premi Applica per spostarle.{/if}
        </p>
      {:else}
        <Help label="Come si applica">Cambia disposizione o spazio e premi Applica: le celle si spostano sulla nuova griglia, con serie, polarità e modifiche intatte.</Help>
      {/if}
      <details class="adv">
        <summary>Rigenera da S×P</summary>
        {@render seriesParallel()}
        {@render generateButton('Rigenera')}
      </details>
      <button type="button" class="restart" onclick={clearAll} title="Toglie le celle e torna alla scelta iniziale (Ctrl+Z annulla)">↺ Ricomincia da capo</button>
    </details>
  {:else}
    <details class="sec" open>
      <summary><Icon name="grid" /> Pacco a mano <span class="count">{project.cells.length}</span></summary>
      {@render layoutFields(diameter)}
      <Help label="A cosa servono">Sono la griglia di aggancio per le celle che aggiungi: disposizione e spazio non spostano le celle già messe.</Help>
      <details class="adv">
        <summary>Genera un pacco automatico</summary>
        {@render seriesParallel()}
        {@render generateButton('Genera')}
      </details>
      <button type="button" class="restart" onclick={clearAll} title="Toglie le celle e torna alla scelta iniziale (Ctrl+Z annulla)">↺ Ricomincia da capo</button>
    </details>
  {/if}

  <details class="sec">
    <summary><Icon name="pen" /> Serie a pennello</summary>
    <div class="row end">
      <label>Serie n.
        <input type="number" min="1" step="1" value={ui.activeSeries + 1}
          onchange={(e) => { const v = Math.floor(e.currentTarget.valueAsNumber); if (v >= 1) ui.activeSeries = v - 1; else e.currentTarget.value = String(ui.activeSeries + 1); }} />
      </label>
      <span class="swatch" style:background={groupColor(ui.activeSeries)} title="Colore della serie"></span>
      <button onclick={() => stepSeries(-1)} disabled={ui.activeSeries === 0} title="Serie precedente (←)">−</button>
      <button onclick={() => stepSeries(1)} title="Serie successiva (→)">+</button>
    </div>
    <label class="inline"><input type="checkbox" bind:checked={ui.alternateOnPaint} /> Alterna la polarità (serie pari: + sopra)</label>
    <button class="primary" class:on={ui.tool === 'series'} onclick={toggleSeriesTool}>
      {ui.tool === 'series' ? 'Pennello attivo — clicca per uscire' : 'Attiva il pennello (S)'}
    </button>
    <Help label="Come si usa">Trascina sulle celle per assegnarle alla serie, oppure disegna un rettangolo. Con ←/→ cambi serie. Un solo annulla per ogni pennellata.</Help>
    {#if groupCounts.groups.length > 0 || groupCounts.none > 0}
      <div class="chips">
        {#each groupCounts.groups as [g, n] (g)}
          <button class="chip" class:active={g === ui.activeSeries} onclick={() => selectGroup(g)} title="Seleziona le celle della serie">
            <span class="dot" style:background={groupColor(g)}></span>S{g + 1} · {n}
          </button>
        {/each}
        {#if groupCounts.none > 0}<span class="chip static">senza serie · {groupCounts.none}</span>{/if}
      </div>
    {/if}
  </details>

  <details class="sec">
    <summary><Icon name="cursor" /> Selezione <span class="count">{ui.selected.size}</span></summary>
    {#if ui.selected.size === 0}
      <p class="note">Clicca una cella o trascina un rettangolo. Il simbolo mostra il polo rivolto verso l'alto.</p>
    {:else}
      <div class="row">
        <button onclick={flipSelected}>Inverti polarità</button>
        <button onclick={deleteSelected}>Elimina</button>
      </div>
      <div class="row end">
        <label>Gruppo in serie n.<input type="number" min="1" step="1" bind:value={groupNumber} /></label>
        <button onclick={applyGroup}>Assegna</button>
      </div>
      <button onclick={() => assignGroupToSelected(null)}>Dissocia dal gruppo</button>
    {/if}
  </details>

  <details class="sec">
    <summary><Icon name="wand" /> Gruppi automatici</summary>
    <div class="row">
      <label>Celle per gruppo (P)<input type="number" min="1" step="1" bind:value={autoP} /></label>
      <label>Disposizione
        <select bind:value={strategy}>
          <option value="auto">Automatica</option>
          <option value="x">A colonne</option>
          <option value="y">A righe</option>
          <option value="blob">A blocchi compatti</option>
        </select>
      </label>
    </div>
    <button onclick={suggest} disabled={project.cells.length === 0}>
      Suggerisci gruppi ({ui.selected.size > 0 ? `${ui.selected.size} selezionate` : 'tutte le celle'})
    </button>
    <button onclick={alternate} disabled={project.cells.length === 0} title="Gruppi pari con + sopra, dispari con − sopra">
      Alterna polarità tra gruppi
    </button>
    <Help label="Cosa fa">È un suggerimento: puoi correggerlo a mano o annullarlo con Ctrl+Z.</Help>
  </details>


  <details class="sec" open>
    <summary><Icon name={$drc.some((i) => i.severity !== 'info') ? 'alert' : 'check'} /> Verifiche {#if $drc.length > 0}<span class="count">{$drc.length}</span>{/if}</summary>
    {#if project.cells.length === 0}
      <p class="note">Nessun pacco.</p>
    {:else if $drc.length === 0}
      <p class="ok">Nessun problema: pacco coerente.</p>
    {:else}
      <ul>
        {#each $drc as issue (issue.message)}
          <li>
            <button
              class="issue {issue.severity}"
              onclick={() => show(issue.cellIds)}
              disabled={issue.cellIds.length === 0}
              title={issue.cellIds.length ? 'Seleziona le celle coinvolte' : ''}
            >
              <span class="dot"></span><span>{issue.message}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </details>

  {:else if ui.sideTab === 'strips'}
    <LamellePanel />
  {:else if ui.sideTab === 'holder'}
    <HolderPanel />
  {:else}
    <ExportPanel onSave={download} onOpen={open} />
  {/if}
</div>

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 4px;
  }
  h1 {
    margin: 0;
    font-size: 1.2rem;
  }
  .start h2 {
    margin: 0;
    font-size: 0.95rem;
  }
  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 10px 12px;
    text-align: left;
    border-radius: 8px;
  }
  .choice span {
    font-size: 0.78rem;
    color: var(--muted);
    font-weight: 400;
    line-height: 1.35;
  }
  .back {
    align-self: flex-start;
    border: 0;
    background: none;
    padding: 0;
    font-size: 0.78rem;
    color: var(--muted);
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
  }
  .adv > :global(:not(summary)) {
    margin-top: 8px;
  }
  .tabs {
    display: flex;
    position: sticky;
    top: -12px;
    z-index: 2;
    margin: 0 -12px 6px;
    padding: 0 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 9px 2px 8px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .tabs button.on {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .flag {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .flag.error {
    background: var(--danger);
  }
  .flag.warning {
    background: var(--warn);
  }
  .sec {
    margin-top: 8px;
    padding: 11px 12px;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  /* distanza uniforme tra gli elementi della scheda (il gap non vale dentro <details>) */
  .sec > :global(:not(summary)) {
    margin-top: 10px;
  }
  .sec > :global(:first-child) {
    margin-top: 0;
  }
  .sec > summary {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.86rem;
    font-weight: 650;
    color: var(--fg);
  }
  .sec > summary :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .sec > summary::after {
    content: '';
    margin-left: auto;
    width: 7px;
    height: 7px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: rotate(45deg) translateY(-2px);
    transition: transform 0.15s;
  }
  .sec[open] > summary::after {
    transform: rotate(-135deg);
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
  .spec {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .tag {
    padding: 1px 8px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    font-size: 0.7rem;
    color: var(--muted);
  }
  .tag.on,
  .tag:hover {
    color: var(--fg);
    border-color: var(--accent);
  }
  .restart {
    align-self: flex-start;
    padding: 4px 10px;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .restart:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
  .note.warn {
    color: var(--warn);
  }
  .sum {
    margin-top: 4px;
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--line);
    border-left: 4px solid var(--ok);
    background: var(--panel);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sum.warning {
    border-left-color: var(--warn);
  }
  .sum.error {
    border-left-color: var(--danger);
  }
  .sum-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .cfg {
    font-size: 1.45rem;
    font-weight: 750;
    letter-spacing: -0.01em;
  }
  .pill {
    padding: 2px 9px;
    border-radius: 10px;
    font-size: 0.72rem;
    font-weight: 600;
    background: var(--ok);
    color: #fff;
  }
  .sum.warning .pill {
    background: var(--warn);
  }
  .sum.error .pill {
    background: var(--danger);
  }
  .sum-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .sum-grid span {
    display: flex;
    flex-direction: column;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .sum-grid b {
    font-size: 0.95rem;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .side :global(input[type='checkbox']) {
    appearance: none;
    flex: none;
    width: 30px;
    height: 18px;
    margin: 0;
    border-radius: 9px;
    background: var(--line);
    position: relative;
    cursor: pointer;
    transition: background 0.15s;
  }
  .side :global(input[type='checkbox']::after) {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .side :global(input[type='checkbox']:checked) {
    background: var(--accent);
  }
  .side :global(input[type='checkbox']:checked::after) {
    transform: translateX(12px);
  }
  .swatch {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--line);
  }
  label.inline {
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    font-size: 0.78rem;
    border-radius: 12px;
  }
  .chip.active {
    border-color: var(--accent);
  }
  .chip.static {
    border: 1px dashed var(--line);
    color: var(--muted);
  }
  .chip .dot {
    margin: 0;
    width: 8px;
    height: 8px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    text-align: left;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--fg);
  }
  .draft {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
  }
  .errs {
    color: var(--danger);
    font-size: 0.78rem;
  }
  .count {
    background: var(--line);
    border-radius: 10px;
    padding: 0 7px;
    margin-left: 4px;
  }
  label {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 5px;
    font-size: 0.78rem;
    color: var(--muted);
    flex: 1;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .row.end {
    align-items: flex-end;
  }
  .name {
    font-weight: 600;
  }
  .note {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .ok {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ok);
  }
  .error {
    margin: 0;
    font-size: 0.82rem;
    color: var(--danger);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .issue {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 5px 4px;
    border: none;
    border-radius: 6px;
    background: transparent;
    text-align: left;
    font-size: 0.82rem;
    line-height: 1.35;
  }
  .issue:hover:not(:disabled) {
    background: var(--bg);
  }
  .issue:disabled {
    opacity: 1;
    cursor: default;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    margin-top: 4px;
    border-radius: 50%;
    background: var(--minus);
  }
  .issue.error .dot {
    background: var(--danger);
  }
  .issue.warning .dot {
    background: var(--warn);
  }
  .banner {
    margin: 4px 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .banner.error {
    border-color: var(--danger);
    color: var(--danger);
  }
</style>
