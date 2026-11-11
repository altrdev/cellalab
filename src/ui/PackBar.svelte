<script lang="ts">
  import { computeStats } from '../core/stats';
  import { history } from '../state';
  import { packExtent } from './holder';
  import { ui } from './ui.svelte';

  const stats = $derived(computeStats($history.present));
  const empty = $derived(stats.cellCount === 0);

  const num = (v: number | null, digits = 1, unit = '') => (v === null ? '—' : `${v.toFixed(digits)}${unit}`);
  const extent = $derived(packExtent($history.present, ui.holder, ui.showHolder));
  const size = $derived(
    extent ? `${extent.widthMm.toFixed(1)}×${extent.depthMm.toFixed(1)}×${extent.heightMm.toFixed(1)} mm` : '—',
  );
  const weight = $derived(empty ? '—' : `${(stats.weightG / 1000).toFixed(2)} kg`);
  const cost = $derived(stats.costEur === null ? '—' : `${stats.costEur.toFixed(2)} €`);
  const perWh = $derived(
    stats.costEur === null || !stats.energyWh ? null : `${(stats.costEur / stats.energyWh).toFixed(2)} €/Wh`,
  );
  const voltage = $derived(stats.nominalV === null ? '—' : `${stats.nominalV.toFixed(1)} V`);
  const voltageRange = $derived(
    stats.minV === null || stats.maxV === null ? null : `${stats.minV.toFixed(1)}–${stats.maxV.toFixed(1)} V`,
  );
  const sizeLabel = $derived(extent?.withHolder ? 'Ingombro pacco' : 'Ingombro celle');
</script>

<section class="bar" aria-label="Riepilogo del pacco">
  <div class="id">
    <span class="cfg" class:none={empty}>{stats.configLabel ?? (empty ? 'Nessuna cella' : '—')}</span>
    {#if !empty}<span class="count">{stats.cellCount} {stats.cellCount === 1 ? 'cella' : 'celle'}</span>{/if}
  </div>
  <div class="m" title="Nominale e, tra parentesi, da scarica a carica completa">
    <b>Tensione</b><span class="big">{voltage}</span>{#if voltageRange}<small>{voltageRange}</small>{/if}
  </div>
  <div class="m">
    <b>Capacità</b><span class="big">{num(stats.capacityAh, 1, ' Ah')}</span>{#if stats.energyWh !== null}<small>{num(stats.energyWh, 0, ' Wh')}</small>{/if}
  </div>
  <div
    class="m"
    title={stats.limitedByBms
      ? `Corrente di progetto: le celle reggerebbero ${num(stats.cellCurrentA, 0, ' A')}`
      : 'Corrente continua che reggono le celle'}
  >
    <b>Corrente</b><span class="big">{num(stats.maxCurrentA, 0, ' A')}</span>{#if stats.limitedByBms}<small class="bms">di progetto</small>{/if}
  </div>
  <div class="m s"><b>Peso celle</b><span>{weight}</span></div>
  <div class="m s" title="Disponibile se tutte le celle hanno un prezzo nel catalogo">
    <b>Costo celle</b><span>{cost}</span>{#if perWh}<small>{perWh}</small>{/if}
  </div>
  <div class="m s" title={extent?.withHolder ? 'Ingombro totale con le due piastre del portacelle' : 'Ingombro delle sole celle'}>
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
