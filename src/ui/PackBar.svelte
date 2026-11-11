<script lang="ts">
  import { t, tn } from '../i18n';
  import { lenLabel, lenNum, mass, money } from '../units';
  import { computeStats } from '../core/stats';
  import { history } from '../state';
  import { packExtent } from './holder';
  import { ui } from './ui.svelte';

  const stats = $derived(computeStats($history.present));
  const empty = $derived(stats.cellCount === 0);

  const num = (v: number | null, digits = 1, unit = '') => (v === null ? '—' : `${v.toFixed(digits)}${unit}`);
  const extent = $derived(packExtent($history.present, ui.holder, ui.showHolder));
  const size = $derived(
    extent ? `${lenNum(extent.widthMm)}×${lenNum(extent.depthMm)}×${lenNum(extent.heightMm)} ${lenLabel()}` : '—',
  );
  const weight = $derived(empty ? '—' : mass(stats.weightG, 2));
  const cost = $derived(stats.costEur === null ? '—' : money(stats.costEur, 2));
  const perWh = $derived(
    stats.costEur === null || !stats.energyWh ? null : `${money(stats.costEur / stats.energyWh, 2)}/Wh`,
  );
  const voltage = $derived(stats.nominalV === null ? '—' : `${stats.nominalV.toFixed(1)} V`);
  const voltageRange = $derived(
    stats.minV === null || stats.maxV === null ? null : `${stats.minV.toFixed(1)}–${stats.maxV.toFixed(1)} V`,
  );
  const sizeLabel = $derived(extent?.withHolder ? t('packbar.sizePack') : t('packbar.sizeCells'));
</script>

<section class="bar" aria-label={t('packbar.aria')}>
  <div class="id">
    <span class="cfg" class:none={empty}>{stats.configLabel ?? (empty ? t('packbar.noCells') : '—')}</span>
    {#if !empty}<span class="count">{tn('packbar.cell', stats.cellCount)}</span>{/if}
  </div>
  <div class="m" title={t('packbar.voltageTitle')}>
    <b>{t('packbar.voltage')}</b><span class="big">{voltage}</span>{#if voltageRange}<small>{voltageRange}</small>{/if}
  </div>
  <div class="m">
    <b>{t('packbar.capacity')}</b><span class="big">{num(stats.capacityAh, 1, ' Ah')}</span>{#if stats.energyWh !== null}<small>{num(stats.energyWh, 0, ' Wh')}</small>{/if}
  </div>
  <div
    class="m"
    title={stats.limitedByBms
      ? t('packbar.currentLimited', { cells: num(stats.cellCurrentA, 0, ' A') })
      : t('packbar.currentTitle')}
  >
    <b>{t('packbar.current')}</b><span class="big">{num(stats.maxCurrentA, 0, ' A')}</span>{#if stats.limitedByBms}<small class="bms">{t('packbar.designBadge')}</small>{/if}
  </div>
  <div class="m s"><b>{t('packbar.weight')}</b><span>{weight}</span></div>
  <div class="m s" title={t('packbar.costTitle')}>
    <b>{t('packbar.cost')}</b><span>{cost}</span>{#if perWh}<small>{perWh}</small>{/if}
  </div>
  <div class="m s" title={extent?.withHolder ? t('packbar.sizeWithHolderTitle') : t('packbar.sizeCellsTitle')}>
    <b>{sizeLabel}</b><span>{size}</span>
  </div>
</section>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 6px 0;
    padding: 8px 14px;
    border-top: 1px solid var(--line);
    background: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  .id {
    display: flex;
    flex-direction: column;
    padding-right: 18px;
    margin-right: 4px;
    border-right: 1px solid var(--line);
  }
  .cfg {
    font-size: 1.3rem;
    font-weight: 700;
    line-height: 1.15;
    color: var(--accent);
  }
  .cfg.none {
    font-size: 1rem;
    color: var(--muted);
    font-weight: 600;
  }
  .count {
    font-size: 0.74rem;
    color: var(--muted);
  }
  .m {
    display: grid;
    grid-template-columns: auto auto;
    column-gap: 6px;
    align-items: baseline;
    padding: 0 16px;
    border-right: 1px solid var(--line);
  }
  .m:last-child {
    border-right: 0;
  }
  b {
    grid-column: 1 / -1;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
  }
  .big {
    font-size: 1.2rem;
    font-weight: 650;
    line-height: 1.2;
    white-space: nowrap;
  }
  .s span {
    font-size: 0.88rem;
    white-space: nowrap;
  }
  small {
    font-size: 0.74rem;
    color: var(--muted);
    white-space: nowrap;
  }
  .bms {
    color: var(--warn);
    font-weight: 600;
  }
  @media (max-width: 800px) {
    .m {
      padding: 0 12px 0 0;
      border-right: 0;
    }
    .id {
      width: 100%;
      flex-direction: row;
      align-items: baseline;
      gap: 10px;
      border-right: 0;
    }
  }
</style>
