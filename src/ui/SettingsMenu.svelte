<script lang="ts">
  import { LOCALES, t } from '../i18n';
  import { CURRENCIES, type Currency } from '../prefs';
  import Icon from './Icon.svelte';
  import { ui } from './ui.svelte';

  let root: HTMLElement | undefined = $state();

  function outside(e: PointerEvent) {
    if (ui.settingsOpen && root && !root.contains(e.target as Node)) ui.settingsOpen = false;
  }
  function key(e: KeyboardEvent) {
    if (ui.settingsOpen && e.key === 'Escape') ui.settingsOpen = false;
  }
  const rate = $derived(ui.prefs.rate);
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<div class="settings" bind:this={root}>
  <button type="button" class="gear" class:on={ui.settingsOpen} aria-expanded={ui.settingsOpen} aria-label={t('settings.open')} title={t('settings.open')} onclick={() => (ui.settingsOpen = !ui.settingsOpen)}>
    <Icon name="gear" size={18} />
  </button>
  {#if ui.settingsOpen}
    <div class="pop" role="dialog" aria-label={t('settings.title')}>
      <div class="field">
        <span class="lbl">{t('settings.language')}</span>
        <div class="seg">
          {#each LOCALES as l (l.id)}
            <button type="button" class:on={ui.locale === l.id} aria-pressed={ui.locale === l.id} onclick={() => ui.setLanguage(l.id)}>{l.label}</button>
          {/each}
        </div>
      </div>
      <div class="field">
        <span class="lbl">{t('settings.theme')}</span>
        <div class="seg">
          <button type="button" class:on={ui.theme === 'auto'} aria-pressed={ui.theme === 'auto'} onclick={() => ui.setTheme('auto')}>{t('settings.themeAuto')}</button>
          <button type="button" class:on={ui.theme === 'light'} aria-pressed={ui.theme === 'light'} onclick={() => ui.setTheme('light')}>{t('settings.themeLight')}</button>
          <button type="button" class:on={ui.theme === 'dark'} aria-pressed={ui.theme === 'dark'} onclick={() => ui.setTheme('dark')}>{t('settings.themeDark')}</button>
        </div>
      </div>
      <div class="field">
        <span class="lbl">{t('settings.length')}</span>
        <div class="seg">
          <button type="button" class:on={ui.prefs.length === 'mm'} aria-pressed={ui.prefs.length === 'mm'} onclick={() => ui.setPref({ length: 'mm' })}>mm</button>
          <button type="button" class:on={ui.prefs.length === 'in'} aria-pressed={ui.prefs.length === 'in'} onclick={() => ui.setPref({ length: 'in' })}>in</button>
        </div>
      </div>
      <div class="field">
        <span class="lbl">{t('settings.temp')}</span>
        <div class="seg">
          <button type="button" class:on={ui.prefs.temp === 'C'} aria-pressed={ui.prefs.temp === 'C'} onclick={() => ui.setPref({ temp: 'C' })}>°C</button>
          <button type="button" class:on={ui.prefs.temp === 'F'} aria-pressed={ui.prefs.temp === 'F'} onclick={() => ui.setPref({ temp: 'F' })}>°F</button>
        </div>
      </div>
      <div class="field">
        <span class="lbl">{t('settings.weight')}</span>
        <div class="seg">
          <button type="button" class:on={ui.prefs.weight === 'metric'} aria-pressed={ui.prefs.weight === 'metric'} onclick={() => ui.setPref({ weight: 'metric' })}>{t('settings.weightMetric')}</button>
          <button type="button" class:on={ui.prefs.weight === 'imperial'} aria-pressed={ui.prefs.weight === 'imperial'} onclick={() => ui.setPref({ weight: 'imperial' })}>{t('settings.weightImperial')}</button>
        </div>
      </div>
      <div class="field">
        <span class="lbl">{t('settings.currency')}</span>
        <div class="seg">
          {#each Object.keys(CURRENCIES) as c (c)}
            <button type="button" class:on={ui.prefs.currency === c} aria-pressed={ui.prefs.currency === c} onclick={() => ui.setPref({ currency: c as Currency })}>{CURRENCIES[c as Currency].symbol} {c}</button>
          {/each}
        </div>
        {#if ui.prefs.currency !== 'EUR'}
          <label class="rate">{t('settings.rate')}
            <input
              type="number"
              min="0.0001"
              step="0.01"
              value={rate}
              onchange={(e) => {
                const v = e.currentTarget.valueAsNumber;
                if (Number.isFinite(v) && v > 0) ui.setPref({ rate: v });
                else e.currentTarget.value = String(rate);
              }}
            />
            <span>{CURRENCIES[ui.prefs.currency].symbol}</span>
          </label>
          <span class="hint">{t('settings.rateHint')}</span>
        {/if}
      </div>
      <p class="note">{t('settings.exportNote')}</p>
    </div>
  {/if}
</div>

<style>
  .settings {
    position: relative;
    flex: none;
  }
  .gear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 8px;
    border-color: transparent;
    background: none;
    color: var(--muted);
  }
  .gear:hover,
  .gear.on {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  }
  .pop {
    position: absolute;
    top: 38px;
    right: 0;
    z-index: 20;
    width: 280px;
    max-width: calc(100vw - 24px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lbl {
    font-size: 0.74rem;
    color: var(--muted);
  }
  .seg {
    display: flex;
  }
  .seg button {
    flex: 1;
    padding: 4px 6px;
    font-size: 0.78rem;
    border-radius: 0;
    white-space: nowrap;
  }
  .seg button + button {
    margin-left: -1px;
  }
  .seg button:first-child {
    border-radius: 8px 0 0 8px;
  }
  .seg button:last-child {
    border-radius: 0 8px 8px 0;
  }
  .seg button.on {
    position: relative;
    z-index: 1;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--panel));
    color: var(--accent);
    font-weight: 600;
  }
  .rate {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .rate input {
    flex: 1;
    min-width: 0;
  }
  .hint,
  .note {
    margin: 0;
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--muted);
  }
</style>
