/** Azione per i cursori: calcola `--p`, la parte di traccia (da sinistra) fino alla maniglia, per colorarla. */
export function rangeFill(node: HTMLInputElement, _value?: unknown) {
  const apply = () => {
    const min = Number(node.min) || 0;
    const max = Number(node.max) || 100;
    let pos = max === min ? 0 : (node.valueAsNumber - min) / (max - min);
    if (getComputedStyle(node).direction === 'rtl') pos = 1 - pos;
    node.style.setProperty('--p', `${Math.min(1, Math.max(0, pos)) * 100}%`);
  };
  // il valore del campo può essere aggiornato da Svelte subito dopo: si ricalcola anche al frame successivo
  const later = () => {
    apply();
    requestAnimationFrame(apply);
  };
  later();
  node.addEventListener('input', apply);
  return {
    update: later,
    destroy: () => node.removeEventListener('input', apply),
  };
}
