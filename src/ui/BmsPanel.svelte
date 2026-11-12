<script lang="ts">
  import { t } from '../i18n';
  import { allBmsTypes, bmsFromDraft, bmsOf, seriesLabel, validateBms, type BmsDraft } from '../core/bms';
  import { addCustomBms, removeCustomBms, setBms, setBmsMount } from '../core/ops';
  import { bmsMountOf } from '../core/harness';
  import UnitInput from './UnitInput.svelte';
  import { history } from '../state';
  import Help from './Help.svelte';
  import { rangeFill } from './rangeFill';

  const project = $derived($history.present);
  const bms = $derived(bmsOf(project));
  const mount = $derived(bmsMountOf(project));
  const isCustom = $derived(bms !== undefined && (project.customBmsTypes ?? []).some((b) => b.id === bms.id));

  const blank = (): BmsDraft => ({ name: '', minSeries: 13, maxSeries: 13, maxCurrentA: 30, chemistry: 'li-ion', ntc: true, lengthMm: 0, widthMm: 0, thicknessMm: 0 });
  let draft = $state<BmsDraft | null>(null);
  let errors = $state<string[]>([]);

  function save() {
    if (!draft) return;
    const d = { ...draft, name: draft.name.trim() };
    errors = validateBms(d);
    if (errors.length > 0) return;
    const type = bmsFromDraft(project, d);
    history.commit((p) => setBms(addCustomBms(p, type), type.id));
    draft = null;
  }

  const summary = (b: NonNullable<typeof bms>) =>
    t('bms.summary', { s: seriesLabel(b), a: b.maxCurrentA, ntc: b.ntc ? t('bms.ntcYes') : t('bms.ntcNo') });
</script>

<label>{t('bms.label')}
  <select value={project.bmsId ?? ''} onchange={(e) => history.commit((p) => setBms(p, e.currentTarget.value))}>
    <option value="">{t('side.none')}</option>
    {#each allBmsTypes(project) as b (b.id)}
      <option value={b.id}>{b.name}</option>
    {/each}
  </select>
</label>
{#if bms}
  <p class="note">{summary(bms)}{bms.generic ? ` ${t('bms.genericNote')}` : ''}</p>
{/if}
{#if !draft}
  <div class="row">
    <button type="button" onclick={() => { draft = blank(); errors = []; }}>{t('bms.new')}</button>
    {#if bms && isCustom}
      <button type="button" onclick={() => history.commit((p) => removeCustomBms(p, bms.id))}>{t('bms.delete')}</button>
    {/if}
  </div>
{:else}
  <form onsubmit={(e) => { e.preventDefault(); save(); }}>
    <label>{t('side.draft.name')}<input type="text" bind:value={draft.name} maxlength="60" /></label>
    <div class="row">
      <label>{t('bms.minSeries')}<input type="number" min="1" step="1" bind:value={draft.minSeries} /></label>
      <label>{t('bms.maxSeries')}<input type="number" min="1" step="1" bind:value={draft.maxSeries} /></label>
    </div>
    <div class="row">
      <label>{t('bms.maxCurrent')}<input type="number" min="1" step="1" bind:value={draft.maxCurrentA} /></label>
      <label>{t('side.draft.chemistry')}
        <select bind:value={draft.chemistry}>
          <option value="li-ion">Li-ion</option>
          <option value="lifepo4">LiFePO4</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label>{t('bms.sizeLength')}<UnitInput kind="len" min={0} max={400} step={1} value={draft.lengthMm} onchange={(v) => { if (draft && v !== null) draft.lengthMm = v; }} /></label>
      <label>{t('bms.sizeWidth')}<UnitInput kind="len" min={0} max={400} step={1} value={draft.widthMm} onchange={(v) => { if (draft && v !== null) draft.widthMm = v; }} /></label>
      <label>{t('bms.sizeThickness')}<UnitInput kind="len" min={0} max={100} step={0.5} value={draft.thicknessMm} onchange={(v) => { if (draft && v !== null) draft.thicknessMm = v; }} /></label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={draft.ntc} />{t('bms.ntc')}</label>
    {#if errors.length > 0}
      <ul class="errs">{#each errors as err (err)}<li>{err}</li>{/each}</ul>
    {/if}
    <div class="row">
      <button type="submit" class="primary">{t('side.draft.add')}</button>
      <button type="button" onclick={() => (draft = null)}>{t('side.draft.cancel')}</button>
    </div>
  </form>
{/if}
{#if bms}
  <label>{t('bms.mount')}
    <select value={mount.mode} onchange={(e) => history.commit((p) => setBmsMount(p, { mode: e.currentTarget.value === 'external' ? 'external' : 'pack' }))}>
      <option value="pack">{t('bms.mountPack')}</option>
      <option value="external">{t('bms.mountExternal')}</option>
    </select>
  </label>
  <label>
    <span class="top"><span>{t('bms.along')}</span><b>{Math.round(mount.along * 100)}%</b></span>
    <input
      use:rangeFill={mount.along * 100}
      type="range"
      min="0"
      max="100"
      step="1"
      value={mount.along * 100}
      oninput={(e) => history.commit((p) => setBmsMount(p, { along: e.currentTarget.valueAsNumber / 100 }))}
    />
  </label>
  <div class="row">
    <label>{t('bms.slack')}<UnitInput kind="len" min={0} max={200} step={5} value={mount.slackMm} onchange={(v) => { if (v !== null) history.commit((p) => setBmsMount(p, { slackMm: v })); }} /></label>
    {#if mount.mode === 'external'}
      <label>{t('bms.tail')}<UnitInput kind="len" min={0} max={2000} step={10} value={mount.tailMm} onchange={(v) => { if (v !== null) history.commit((p) => setBmsMount(p, { tailMm: v })); }} /></label>
    {/if}
  </div>
  {#if mount.mode === 'pack' && !bms.sizeMm}<p class="note">{t('bms.noSize')}</p>{/if}
{/if}
<Help label={t('help.how')}>{t('bms.help')}</Help>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
  label.check {
    flex-direction: row;
    align-items: center;
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .top {
    display: flex;
    justify-content: space-between;
  }
  .note {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .errs {
    margin: 0;
    padding-left: 18px;
    font-size: 0.82rem;
    color: var(--danger);
  }
</style>
