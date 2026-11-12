/** Action for sliders: computes `--p`, the part of the track (from the left) up to the handle, to colour it. */
export function rangeFill(node: HTMLInputElement, _value?: unknown) {
  const apply = () => {
    const min = Number(node.min) || 0;
    const max = Number(node.max) || 100;
    let pos = max === min ? 0 : (node.valueAsNumber - min) / (max - min);
    if (getComputedStyle(node).direction === 'rtl') pos = 1 - pos;
    node.style.setProperty('--p', `${Math.min(1, Math.max(0, pos)) * 100}%`);
  };
  // the field value may be updated by Svelte right after: recompute on the next frame too
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
