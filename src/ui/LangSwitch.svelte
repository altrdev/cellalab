<script lang="ts">
  import { LOCALES, t } from '../i18n';
  import { ui } from './ui.svelte';
</script>

<div class="lang" role="group" aria-label={t('lang.label')}>
  {#each LOCALES as l (l.id)}
    <button type="button" class:on={ui.locale === l.id} aria-pressed={ui.locale === l.id} onclick={() => ui.setLanguage(l.id)}>{l.label}</button>
  {/each}
</div>

<style>
  .lang {
    display: inline-flex;
    flex: none;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  button {
    padding: 2px 8px;
    border: 0;
    border-radius: 0;
    background: none;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
  }
  button.on {
    background: var(--accent);
    color: #fff;
  }
</style>
