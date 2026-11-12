<script lang="ts">
  import { t, tn } from '../i18n';
  import { lenLabel, lenNum, money } from '../units';
  import BmsPanel from './BmsPanel.svelte';
  import Help from './Help.svelte';
  import Icon from './Icon.svelte';
  import UnitInput from './UnitInput.svelte';
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
  import BusbarPanel from './BusbarPanel.svelte';
  import SettingsMenu from './SettingsMenu.svelte';
  import { bmsFitIssues, reportOf } from './busbar';
  import { sanitizeLamellaSettings } from './busbarSettings';
  import { ui } from './ui.svelte';

  const project = $derived($history.present);
  const stats = $derived(computeStats(project));
  let showGenericInfo = $state(false);
  /** Pack checks, plus the BMS board footprint (which depends on the position and the wire exit side). */
  type Row = { severity: 'error' | 'warning' | 'info'; message: string; cellIds: string[] };
  const checkRows = $derived<Row[]>([...$drc, ...bmsFitIssues(project, ui.lamella)]);
  const sumErrors = $derived(checkRows.filter((i) => i.severity === 'error').length);
  const sumWarnings = $derived(checkRows.filter((i) => i.severity === 'warning').length);
  const sumTone = $derived(sumErrors > 0 ? 'error' : sumWarnings > 0 ? 'warning' : 'ok');
  const sumLabel = $derived(
    sumErrors > 0
      ? tn('side.sum.problem', sumErrors)
      : sumWarnings > 0
        ? tn('side.sum.warning', sumWarnings)
        : t('side.sum.ok'),
  );
  const allTypes = $derived([...project.customCellTypes, ...BUILTIN_CELL_TYPES]);
  let series = $state(4);
  let parallel = $state(3);
  let groupNumber = $state(1);
  let autoP = $state(3);
  let strategy = $state<GroupStrategy>('auto');
  const strategyNames = { x: t('side.strategy.x'), y: t('side.strategy.y'), blob: t('side.strategy.blob') } as const;
  let message = $state<{ kind: 'error' | 'ok'; text: string } | null>(null);

  type Tab = typeof ui.sideTab;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'pack', label: t('side.tab.pack') },
    { id: 'strips', label: t('side.tab.strips') },
    { id: 'holder', label: t('side.tab.holder') },
    { id: 'file', label: t('side.tab.file') },
  ];
  // Dot on the tab when there is something to look at: 'error' red, 'warning' yellow.
  const tabFlag = $derived.by((): Record<Tab, 'error' | 'warning' | null> => {
    const strips = project.cells.length > 0 ? reportOf(project, ui.lamella).status : 'empty';
    const issues = holderOf(project, ui.holder).report?.issues ?? [];
    return {
      pack: checkRows.some((i) => i.severity === 'error') ? 'error' : checkRows.some((i) => i.severity === 'warning') ? 'warning' : null,
      strips: strips === 'error' ? 'error' : strips === 'warning' ? 'warning' : null,
      holder: issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warning') ? 'warning' : null,
      file: null,
    };
  });
  function pickTab(id: Tab) {
    ui.sideTab = id;
    if (id === 'strips') ui.showStrips = true; // in the strips tab you want to see them
  }

  const selectedType = $derived(findCellType(project, ui.addTypeId));
  const diameter = $derived(selectedType?.diameterMm ?? 18);
  /** How many cells are in each series (and how many have none). */
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

  /** How you are working: generated pack (there is a recipe), by hand (cells with no recipe) or still empty. */
  const packMode = $derived<'generated' | 'manual' | 'empty'>(
    project.cells.length === 0 ? 'empty' : project.generator ? 'generated' : 'manual',
  );
  const generator = $derived(project.generator);
  const genType = $derived(generator ? findCellType(project, generator.typeId) : undefined);
  const typeDirty = $derived(!!generator && generator.typeId !== ui.addTypeId);
  const layoutDirty = $derived(
    !!generator && (generator.kind !== ui.layoutKind || Math.abs(generator.gapMm - ui.gapMm) > 1e-6 || typeDirty),
  );
  /** In the by-hand pack: cells already placed of a different type from the chosen one. */
  const otherTypeCount = $derived(
    project.cells.filter((c) => c.typeId !== ui.addTypeId && (ui.selected.size === 0 || ui.selected.has(c.id))).length,
  );

  // When the recipe changes (generation, undo, opening a file) the fields follow the recipe.
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
        text: t('side.err.applySlots'),
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
      message = { kind: 'error', text: err instanceof Error ? err.message : t('side.err.generate') };
    }
  }

  function applyGroup() {
    if (!Number.isInteger(groupNumber) || groupNumber < 1) {
      message = { kind: 'error', text: t('side.err.groupNumber') };
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
          t('side.msg.groups', { count: result.groupCount, p: autoP, from: start + 1, to: start + result.groupCount, strategy: strategyNames[result.strategy] }),
      };
    } catch (err) {
      message = { kind: 'error', text: err instanceof Error ? err.message : t('side.err.suggest') };
    }
  }

  function alternate() {
    const ids = ui.selected.size > 0 ? [...ui.selected] : undefined;
    history.commit((p) => alternateGroupPolarity(p, ids));
  }

  // ---- Cell catalogue
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
      message = { kind: 'error', text: err instanceof Error ? err.message : t('side.err.deleteType') };
    }
  }

  const typeSummary = (t: CellType) =>
    `${lenNum(t.diameterMm)}×${lenNum(t.heightMm)} ${lenLabel()} · ${t.capacityAh} Ah · ${t.maxDischargeA} A` +
    (t.priceEur !== undefined ? ` · ${money(t.priceEur, 2)}` : '');

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
      message = { kind: 'error', text: t('side.err.tooBig') };
      return;
    }
    try {
      const text = await file.text();
      const opened = parseProject(text);
      const saved = parseProjectSettings(text);
      history.reset(opened);
      // strips and holder: the file's settings are used; if there are none the current ones stay
      if (saved.lamella !== undefined) Object.assign(ui.lamella, sanitizeLamellaSettings(saved.lamella));
      if (saved.holder !== undefined) Object.assign(ui.holder, sanitizeHolderSettings(saved.holder));
      ui.selected = new Set();
      ui.fit(history.get().present);
      message = {
        kind: 'ok',
        text: t(saved.lamella !== undefined || saved.holder !== undefined ? 'side.msg.openedSettings' : 'side.msg.opened', { name: file.name }),
      };
    } catch (err) {
      message = { kind: 'error', text: err instanceof ProjectParseError ? err.message : t('side.err.read') };
    }
  }
</script>

<div class="side">
  <header>
    <div class="brand">
      <h1><img class="logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="26" height="26" />CellaLab <small class="ver" title={t('side.version')}>v{__APP_VERSION__}</small></h1>
      <SettingsMenu />
    </div>
    <input
      class="name"
      aria-label={t('side.projectName')}
      value={project.name}
      oninput={(e) => history.commit((p) => renameProject(p, e.currentTarget.value), { coalesceKey: 'rename' })}
    />
  </header>

  {#if message}
    <p class="banner" class:error={message.kind === 'error'} role="status">{message.text}</p>
  {/if}

  <div class="tabs" role="tablist" aria-label={t('side.sections')}>
    {#each tabs as tab (tab.id)}
      <button role="tab" aria-selected={ui.sideTab === tab.id} class:on={ui.sideTab === tab.id} onclick={() => pickTab(tab.id)}>
        {tab.label}{#if tabFlag[tab.id]}<span class="flag {tabFlag[tab.id]}" title={tabFlag[tab.id] === 'error' ? t('side.tab.flagError') : t('side.tab.flagWarning')}></span>{/if}
      </button>
    {/each}
  </div>

  {#if ui.sideTab === 'pack'}

  {#snippet layoutFields(dia: number)}
    <div class="row">
      <label>{t('side.layout')}
        <select bind:value={ui.layoutKind}>
          <option value="hex">{t('side.layout.hex')}</option>
          <option value="square">{t('side.layout.square')}</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label>{t('side.gap')}<UnitInput kind="len" min={0} max={20} step={0.1} value={ui.gapMm} onchange={(v) => (ui.gapMm = v ?? 0)} /></label>
      <label title={t('side.pitchTitle')}>{t('side.pitch')}
        <UnitInput
          kind="len"
          min={dia}
          max={dia + 20}
          step={0.1}
          value={Math.round((dia + ui.gapMm) * 100) / 100}
          onchange={(v) => {
            if (v !== null) ui.gapMm = Math.max(0, Math.round((v - dia) * 100) / 100);
          }}
        />
      </label>
    </div>
  {/snippet}

  {#snippet seriesParallel()}
    <div class="row">
      <label>{t('side.series')}<input type="number" min="1" max={MAX_GENERATED_CELLS} step="1" bind:value={series} /></label>
      <label>{t('side.parallel')}<input type="number" min="1" max={MAX_GENERATED_CELLS} step="1" bind:value={parallel} /></label>
    </div>
  {/snippet}

  {#snippet generateButton(verb: string)}
    <button class="primary" onclick={generate}>{verb} {Number.isInteger(series) && Number.isInteger(parallel) ? `${series}S${parallel}P` : t('side.packWord')}</button>
    <p class="note">{t('side.replaces')}</p>
  {/snippet}

  {#if project.cells.length > 0}
    <div class="sum {sumTone}" role="status">
      <div class="sum-main">
        <span class="cfg">{stats.configLabel ?? tn('packbar.cell', stats.cellCount)}</span>
        <span class="pill">{sumLabel}</span>
      </div>
      <div class="sum-grid">
        <span><b>{stats.nominalV === null ? '—' : stats.nominalV.toFixed(1)} V</b>{t('side.voltage')}</span>
        <span><b>{stats.energyWh === null ? '—' : stats.energyWh.toFixed(0)} Wh</b>{t('side.energy')}</span>
        <span><b>{stats.maxCurrentA === null ? '—' : stats.maxCurrentA.toFixed(0)} A</b>{stats.limitedByBms ? t('side.currentDesign') : t('side.current')}</span>
      </div>
    </div>
  {/if}

  {#if !(packMode === 'empty' && ui.startMode === null)}
  <details class="sec" open>
    <summary><Icon name="battery" /> {t('side.cell.title')}</summary>
    <label>{packMode === 'generated' ? t('side.cell.of') : packMode === 'manual' ? t('side.cell.toAdd') : t('side.cell.type')}
      <select bind:value={ui.addTypeId}>
        {#each allTypes as ct (ct.id)}
          <option value={ct.id}>{ct.name}</option>
        {/each}
      </select>
    </label>
    {#if selectedType}
      <div class="spec">
        <span>{typeSummary(selectedType)}</span>
        {#if selectedType.generic}
          <button type="button" class="tag" class:on={showGenericInfo} onclick={() => (showGenericInfo = !showGenericInfo)} title={t('side.cell.genericTitle')}>{t('side.cell.generic')}</button>
        {/if}
      </div>
      {#if selectedType.generic && showGenericInfo}
        <p class="note">{t('side.cell.genericInfo')}</p>
      {/if}
    {/if}
    {#if packMode === 'manual' && otherTypeCount > 0}
      <button type="button" onclick={() => history.commit((p) => setCellType(p, ui.addTypeId, ui.selected.size > 0 ? ui.selected : undefined))}>
        {ui.selected.size > 0 ? t('side.cell.useSelected', { n: otherTypeCount }) : t('side.cell.useAll', { n: otherTypeCount })}
      </button>
    {/if}
    {#if !draft}
      <div class="row">
        {#if selectedType && !selectedType.generic && project.customCellTypes.some((c) => c.id === selectedType.id)}
          <button onclick={() => startDraft(selectedType, true)}>{t('side.cell.edit')}</button>
          <button onclick={() => removeType(selectedType.id)}>{t('side.cell.delete')}</button>
        {:else}
          <button onclick={() => selectedType && startDraft(selectedType, false)}>{t('side.cell.duplicate')}</button>
        {/if}
      </div>
    {/if}
    {#if draft}
      <form class="draft" onsubmit={(e) => { e.preventDefault(); saveDraft(); }}>
        <label>{t('side.draft.name')}<input type="text" bind:value={draft.name} maxlength="60" /></label>
        <label>{t('side.draft.chemistry')}
          <select bind:value={draft.chemistry}>
            <option value="li-ion">Li-ion</option>
            <option value="lifepo4">LiFePO4</option>
          </select>
        </label>
        <div class="row">
          <label>{t('side.draft.diameter')}<UnitInput kind="len" step={0.1} value={draft.diameterMm} onchange={(v) => { if (draft && v !== null) draft.diameterMm = v; }} /></label>
          <label>{t('side.draft.height')}<UnitInput kind="len" step={0.1} value={draft.heightMm} onchange={(v) => { if (draft && v !== null) draft.heightMm = v; }} /></label>
        </div>
        <div class="row">
          <label>V min<input type="number" step="0.05" bind:value={draft.minV} /></label>
          <label>V nom<input type="number" step="0.05" bind:value={draft.nominalV} /></label>
          <label>V max<input type="number" step="0.05" bind:value={draft.maxV} /></label>
        </div>
        <div class="row">
          <label>{t('side.draft.capacity')}<input type="number" step="0.1" bind:value={draft.capacityAh} /></label>
          <label>{t('side.draft.discharge')}<input type="number" step="0.5" bind:value={draft.maxDischargeA} /></label>
        </div>
        <div class="row">
          <label>{t('side.draft.weight')}<UnitInput kind="mass" step={0.5} value={draft.weightG} onchange={(v) => { if (draft && v !== null) draft.weightG = v; }} /></label>
          <label>{t('side.draft.price')}<UnitInput kind="money" step={0.01} min={0} nullable placeholder={t('side.draft.optional')} value={draft.priceEur} onchange={(v) => { if (draft) draft.priceEur = v ?? undefined; }} /></label>
        </div>
        {#if draftErrors.length > 0}
          <ul class="errs">{#each draftErrors as err (err)}<li>{err}</li>{/each}</ul>
        {/if}
        <div class="row">
          <button type="submit" class="primary">{editingId ? t('side.draft.save') : t('side.draft.add')}</button>
          <button type="button" onclick={cancelDraft}>{t('side.draft.cancel')}</button>
        </div>
      </form>
    {/if}
  </details>
  {/if}

  {#if !(packMode === 'empty' && ui.startMode === null)}
  <details class="sec" open>
    <summary><Icon name="bolt" /> {t('side.currentSection')}</summary>
    <label>{t('side.currentDesignLabel')}
      <input
        type="number"
        min="0"
        step="1"
        placeholder={stats.cellCurrentA === null ? t('side.none') : t('side.cellsCurrent', { n: stats.cellCurrentA.toFixed(0) })}
        value={project.currentLimitA ?? ''}
        onchange={(e) => {
          const v = e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value);
          history.commit((p) => setCurrentLimit(p, v));
        }}
      />
    </label>
    <Help label={t('help.how')}>
      {#if stats.cellCurrentA === null}{t('side.currentHelp.noCells')}
      {:else if stats.limitedByBms}{t('side.currentHelp.limited', { design: stats.maxCurrentA?.toFixed(0) ?? '', cells: stats.cellCurrentA.toFixed(0) })}
      {:else}{t('side.currentHelp.default', { cells: stats.cellCurrentA.toFixed(0) })}{/if}
    </Help>
  </details>

  <details class="sec">
    <summary><Icon name="battery" /> {t('bms.section')}</summary>
    <BmsPanel />
  </details>
  {/if}

  {#if packMode === 'empty' && ui.startMode === null}
    <section class="sec start">
      <h2>{t('side.start.title')}</h2>
      <button class="choice" onclick={() => (ui.startMode = 'auto')}>
        <b>{t('side.start.auto')}</b>
        <span>{t('side.start.autoHelp')}</span>
      </button>
      <button class="choice" onclick={() => (ui.startMode = 'manual')}>
        <b>{t('side.start.manual')}</b>
        <span>{t('side.start.manualHelp')}</span>
      </button>
    </section>
  {:else if packMode === 'empty' && ui.startMode === 'auto'}
    <details class="sec" open>
      <summary><Icon name="wand" /> {t('side.generate.title')}</summary>
      <button class="back" onclick={() => (ui.startMode = null)}>{t('side.back')}</button>
      {@render seriesParallel()}
      {@render layoutFields(diameter)}
      {@render generateButton(t('side.generate.verb'))}
    </details>
  {:else if packMode === 'empty'}
    <details class="sec" open>
      <summary><Icon name="pen" /> {t('side.start.manual')}</summary>
      <button class="back" onclick={() => (ui.startMode = null)}>{t('side.back')}</button>
      {@render layoutFields(diameter)}
      <Help label={t('side.draw.helpLabel')}>{t('side.draw.help')}</Help>
    </details>
  {:else if packMode === 'generated'}
    <details class="sec" open>
      <summary><Icon name="grid" /> {t('side.gen.title')}</summary>
      <p class="note">{t('side.gen.origin', { name: genType?.name ?? t('side.cell.title'), s: generator?.series ?? '', p: generator?.parallel ?? '' })}</p>
      {@render layoutFields(diameter)}
      <button class="primary" onclick={applyToPack} disabled={!layoutDirty}>{t('side.gen.apply')}</button>
      {#if layoutDirty}
        <p class="note warn">
          {#if typeDirty}{t('side.gen.dirtyType')}{:else}{t('side.gen.dirtyGrid')}{/if}
        </p>
      {:else}
        <Help label={t('side.gen.applyHelpLabel')}>{t('side.gen.applyHelp')}</Help>
      {/if}
      <details class="adv">
        <summary>{t('side.gen.regen')}</summary>
        {@render seriesParallel()}
        {@render generateButton(t('side.gen.regenVerb'))}
      </details>
      <button type="button" class="restart" onclick={clearAll} title={t('side.restartTitle')}>{t('side.restart')}</button>
    </details>
  {:else}
    <details class="sec" open>
      <summary><Icon name="grid" /> {t('side.manual.title')} <span class="count">{project.cells.length}</span></summary>
      {@render layoutFields(diameter)}
      <Help label={t('side.manual.helpLabel')}>{t('side.manual.help')}</Help>
      <details class="adv">
        <summary>{t('side.manual.generate')}</summary>
        {@render seriesParallel()}
        {@render generateButton(t('side.generate.verb'))}
      </details>
      <button type="button" class="restart" onclick={clearAll} title={t('side.restartTitle')}>{t('side.restart')}</button>
    </details>
  {/if}

  <details class="sec">
    <summary><Icon name="pen" /> {t('side.brush.title')}</summary>
    <div class="row end">
      <label>{t('side.brush.n')}
        <input type="number" min="1" step="1" value={ui.activeSeries + 1}
          onchange={(e) => { const v = Math.floor(e.currentTarget.valueAsNumber); if (v >= 1) ui.activeSeries = v - 1; else e.currentTarget.value = String(ui.activeSeries + 1); }} />
      </label>
      <span class="swatch" style:background={groupColor(ui.activeSeries)} title={t('side.brush.colorTitle')}></span>
      <button onclick={() => stepSeries(-1)} disabled={ui.activeSeries === 0} title={t('side.brush.prevTitle')}>−</button>
      <button onclick={() => stepSeries(1)} title={t('side.brush.nextTitle')}>+</button>
    </div>
    <label class="inline"><input type="checkbox" bind:checked={ui.alternateOnPaint} /> {t('side.brush.alternate')}</label>
    <button class="primary" class:on={ui.tool === 'series'} onclick={toggleSeriesTool}>
      {ui.tool === 'series' ? t('side.brush.active') : t('side.brush.activate')}
    </button>
    <Help label={t('side.brush.helpLabel')}>{t('side.brush.help')}</Help>
    {#if groupCounts.groups.length > 0 || groupCounts.none > 0}
      <div class="chips">
        {#each groupCounts.groups as [g, n] (g)}
          <button class="chip" class:active={g === ui.activeSeries} onclick={() => selectGroup(g)} title={t('side.brush.selectTitle')}>
            <span class="dot" style:background={groupColor(g)}></span>S{g + 1} · {n}
          </button>
        {/each}
        {#if groupCounts.none > 0}<span class="chip static">{t('side.brush.noSeries', { n: groupCounts.none })}</span>{/if}
      </div>
    {/if}
  </details>

  <details class="sec">
    <summary><Icon name="cursor" /> {t('side.sel.title')} <span class="count">{ui.selected.size}</span></summary>
    {#if ui.selected.size === 0}
      <p class="note">{t('side.sel.help')}</p>
    {:else}
      <div class="row">
        <button onclick={flipSelected}>{t('side.sel.flip')}</button>
        <button onclick={deleteSelected}>{t('side.sel.delete')}</button>
      </div>
      <div class="row end">
        <label>{t('side.sel.groupNo')}<input type="number" min="1" step="1" bind:value={groupNumber} /></label>
        <button onclick={applyGroup}>{t('side.sel.assign')}</button>
      </div>
      <button onclick={() => assignGroupToSelected(null)}>{t('side.sel.dissociate')}</button>
    {/if}
  </details>

  <details class="sec">
    <summary><Icon name="wand" /> {t('side.auto.title')}</summary>
    <div class="row">
      <label>{t('side.auto.p')}<input type="number" min="1" step="1" bind:value={autoP} /></label>
      <label>{t('side.layout')}
        <select bind:value={strategy}>
          <option value="auto">{t('side.auto.auto')}</option>
          <option value="x">{t('side.auto.cols')}</option>
          <option value="y">{t('side.auto.rows')}</option>
          <option value="blob">{t('side.auto.blocks')}</option>
        </select>
      </label>
    </div>
    <button onclick={suggest} disabled={project.cells.length === 0}>
      {t('side.auto.suggest', { what: ui.selected.size > 0 ? t('side.auto.selected', { n: ui.selected.size }) : t('side.auto.allCells') })}
    </button>
    <button onclick={alternate} disabled={project.cells.length === 0} title={t('side.auto.alternateTitle')}>
      {t('side.auto.alternate')}
    </button>
    <Help label={t('side.auto.helpLabel')}>{t('side.auto.help')}</Help>
  </details>


  <details class="sec" open>
    <summary><Icon name={checkRows.some((i) => i.severity !== 'info') ? 'alert' : 'check'} /> {t('side.checks.title')} {#if checkRows.length > 0}<span class="count">{checkRows.length}</span>{/if}</summary>
    {#if project.cells.length === 0}
      <p class="note">{t('side.checks.none')}</p>
    {:else if checkRows.length === 0}
      <p class="ok">{t('side.checks.ok')}</p>
    {:else}
      <ul>
        {#each checkRows as issue (issue.message)}
          <li>
            <button
              class="issue {issue.severity}"
              onclick={() => show(issue.cellIds)}
              disabled={issue.cellIds.length === 0}
              title={issue.cellIds.length ? t('side.checks.selectTitle') : ''}
            >
              <span class="dot"></span><span>{issue.message}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </details>

  {:else if ui.sideTab === 'strips'}
    <BusbarPanel />
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
  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h1 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1.2rem;
  }
  .logo {
    flex: none;
    border-radius: 6px;
  }
  .ver {
    margin-left: -2px;
    align-self: flex-end;
    padding-bottom: 3px;
    font-size: 0.65rem;
    font-weight: 400;
    color: var(--muted);
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
  /* uniform distance between the elements of the tab (gap does not apply inside <details>) */
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
