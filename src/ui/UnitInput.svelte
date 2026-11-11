<script lang="ts">
  import { fromLen, fromMassSmall, fromMoney, fromTemp, fromTempDelta, toLen, toMassSmall, toMoney, toTemp, toTempDelta } from '../units';
  import { getPrefs } from '../prefs';

  /**
   * Campo numerico che mostra e accetta il valore nell'unità scelta nelle impostazioni (pollici, °F, oz, altra valuta).
   * `value`, `min`, `max`, `step` e `onchange` restano nell'unità interna del progetto (mm, °C, g, euro).
   */
  type Kind = 'len' | 'tempAbs' | 'tempDelta' | 'mass' | 'money';
  let {
    value,
    kind,
    onchange,
    min,
    max,
    step,
    placeholder,
    disabled = false,
    nullable = false,
    label,
  }: {
    value: number | null | undefined;
    kind: Kind;
    onchange: (v: number | null) => void;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string | number;
    disabled?: boolean;
    nullable?: boolean;
    label?: string;
  } = $props();

  const conv: Record<Kind, { to: (v: number) => number; from: (v: number) => number; round: () => number | null }> = {
    len: { to: toLen, from: fromLen, round: () => (getPrefs().length === 'in' ? 4 : null) },
    tempAbs: { to: toTemp, from: fromTemp, round: () => (getPrefs().temp === 'F' ? 1 : null) },
    tempDelta: { to: toTempDelta, from: fromTempDelta, round: () => (getPrefs().temp === 'F' ? 1 : null) },
    mass: { to: toMassSmall, from: fromMassSmall, round: () => (getPrefs().weight === 'imperial' ? 3 : null) },
    money: { to: toMoney, from: fromMoney, round: () => (getPrefs().currency === 'EUR' ? null : 4) },
  };

  /** Valore da mostrare: convertito, e arrotondato solo se la conversione lo richiede (in mm resta com'è). */
  function show(v: number): number {
    const c = conv[kind];
    const x = c.to(v);
    const r = c.round();
    return r === null ? x : Math.round(x * 10 ** r) / 10 ** r;
  }
  const shown = $derived(value === null || value === undefined || !Number.isFinite(value) ? '' : show(value));
  const ph = $derived(typeof placeholder === 'number' ? String(show(placeholder)) : placeholder);
  const attr = (v: number | undefined) => (v === undefined ? undefined : show(v));

  function commit(e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const raw = input.valueAsNumber;
    if (input.value === '' && nullable) {
      onchange(null);
    } else if (Number.isFinite(raw)) {
      let v = conv[kind].from(raw);
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onchange(v);
    }
    // se il valore è stato limitato o rifiutato la proprietà può non cambiare: riallinea quello che si vede
    queueMicrotask(() => {
      input.value = value === null || value === undefined || !Number.isFinite(value) ? '' : String(show(value));
    });
  }
</script>

<input
  type="number"
  value={shown}
  min={attr(min)}
  max={attr(max)}
  step={attr(step)}
  placeholder={ph}
  {disabled}
  aria-label={label}
  onchange={commit}
/>
