<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label = 'Come funziona', children }: { label?: string; children: Snippet } = $props();
  let open = $state(false);
</script>

<div class="help">
  <button type="button" class="more" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="q">?</span>{label}
  </button>
  {#if open}<p>{@render children()}</p>{/if}
</div>

<style>
  .help {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .more {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: none;
    font-size: 0.76rem;
    color: var(--muted);
  }
  .more:hover:not(:disabled) {
    color: var(--fg);
    background: none;
  }
  .q {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1px solid var(--line);
    font-size: 0.66rem;
    font-weight: 700;
  }
  p {
    margin: 0;
    padding: 7px 9px;
    border-radius: 8px;
    background: var(--bg);
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--muted);
  }
</style>
