<script lang="ts">
  import { t } from '../i18n';
  import { len } from '../units';
  import { onMount } from 'svelte';
  import { findCellType } from '../core/catalog';
  import { cellsInRect, normalizeRect, snapTo, type Rect } from '../core/geometry';
  import { snapToSlot, slotsInRect, type Lattice, type Point } from '../core/lattice';
  import { addCell, moveCells, paintGroup } from '../core/ops';
  import { drc, history } from '../state';
  import { groupColor } from './colors';
  import { holderOf, packExtent, regionsPath, seamsPath } from './holder';
  import { NTC_WIRE_HOLE_MM } from '../core/ntc';
  import { ntcPlanOf, pathOf, reportOf, spotMarks, stripsOf } from './lamelle';
  import { ui } from './ui.svelte';

  let svg: SVGSVGElement | undefined = $state();
  let cw = $state(800);
  let ch = $state(600);
  let hover = $state<(Point & { blocked: boolean }) | null>(null);
  let marquee = $state<Rect | null>(null);

  const project = $derived($history.present);
  const vh = $derived(ui.view.w * (ch / cw));
  const viewBox = $derived(`${ui.view.x} ${ui.view.y} ${ui.view.w} ${vh}`);

  /** Lamelle della faccia visibile, con l'esito dell'analisi per evidenziare quelle con problemi. */
  const holderModel = $derived(
    ui.showHolder && (ui.face === 'top' ? ui.holderView.showTop : ui.holderView.showBottom) ? holderOf(project, ui.holder).model : null,
  );
  /** Piastra troppo grande per il piano: le linee di taglio e le sigle dei pezzi. */
  const holderSplit = $derived(
    ui.showHolder && (ui.face === 'top' ? ui.holderView.showTop : ui.holderView.showBottom) ? holderOf(project, ui.holder).split : null,
  );
  /** Solco del filo dell'NTC: si vede sulla faccia della piastra dove va montato il sensore. */
  const ntcGroove = $derived.by(() => {
    if (!ui.showHolder) return null;
    const plan = ntcPlanOf(project, ui.lamella, ui.holder);
    return plan.route?.found && plan.face === ui.face ? plan : null;
  });
  const strips = $derived(ui.showStrips ? stripsOf(project, ui.lamella).filter((s) => s.face === ui.face) : []);
  const stripReport = $derived(ui.showStrips ? reportOf(project, ui.lamella) : null);
  const stripSeverity = $derived.by(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const issue of stripReport?.issues ?? []) {
      if (issue.severity === 'info') continue;
      for (const id of issue.stripIds) if (m.get(id) !== 'error') m.set(id, issue.severity);
    }
    return m;
  });
  const spotNeed = $derived(new Map((stripReport?.strips ?? []).map((r) => [r.stripId, r.spotsNeeded])));

  const radii = $derived.by(() => {
    const m = new Map<string, number>();
    for (const c of project.cells) {
      if (!m.has(c.typeId)) m.set(c.typeId, (findCellType(project, c.typeId)?.diameterMm ?? 18) / 2);
    }
    return m;
  });
  const ghostRadius = $derived((findCellType(project, ui.addTypeId)?.diameterMm ?? 18) / 2);
  /** Griglia a slot: passo centro-centro = diametro del tipo scelto + spazio. */
  const lattice = $derived<Lattice>({ kind: ui.layoutKind, pitchMm: ghostRadius * 2 + Math.max(ui.gapMm, 0) });
  const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

  function snapPoint(p: Point, lat: Lattice = lattice): Point {
    if (ui.snap === 'slot') return snapToSlot(lat, p.x, p.y);
    return { x: snapTo(p.x, ui.snap), y: snapTo(p.y, ui.snap) };
  }

  /** Vero se una cella nuova in `p` si sovrapporrebbe a una esistente. */
  function blockedAt(p: Point): boolean {
    for (const c of project.cells) {
      const r = (radii.get(c.typeId) ?? 9) + ghostRadius - 0.05;
      if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < r * r) return true;
    }
    return false;
  }

  const slotMode = $derived(ui.snap === 'slot');
  /** Slot nella parte visibile (null se sono troppi per essere disegnati). */
  const visibleSlots = $derived.by(() => {
    if (!slotMode || !ui.showGrid) return null;
    const slots = slotsInRect(
      lattice,
      { minX: ui.view.x, minY: ui.view.y, maxX: ui.view.x + ui.view.w, maxY: ui.view.y + vh },
      2500,
    );
    if (!slots) return null;
    const p = lattice.pitchMm;
    const buckets = new Map<string, Point[]>();
    for (const c of project.cells) {
      const key = `${Math.floor(c.x / p)},${Math.floor(c.y / p)}`;
      const b = buckets.get(key);
      if (b) b.push(c);
      else buckets.set(key, [c]);
    }
    const lim = (0.45 * p) ** 2;
    return slots.filter((s) => {
      const bx = Math.floor(s.x / p);
      const by = Math.floor(s.y / p);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const c of buckets.get(`${bx + i},${by + j}`) ?? [])
            if ((c.x - s.x) ** 2 + (c.y - s.y) ** 2 < lim) return false;
      return true;
    });
  });

  /** Millimetri per pixel: serve a tenere le quote di dimensione costante sullo schermo. */
  const k = $derived(ui.view.w / cw);
  const bounds = $derived(packExtent(project, ui.holder, ui.showHolder));
  /** Celle coinvolte in errori o avvisi (le informazioni non si evidenziano). */
  const flagged = $derived.by(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const issue of $drc) {
      if (issue.severity === 'info') continue;
      for (const id of issue.cellIds) if (m.get(id) !== 'error') m.set(id, issue.severity);
    }
    return m;
  });

  type Drag =
    | {
        kind: 'move';
        ids: string[];
        start: Point;
        anchor: Point;
        lat: Lattice;
        px: { x: number; y: number };
        active: boolean;
        applied: { dx: number; dy: number };
        key: string;
      }
    | { kind: 'paint'; seen: Set<string>; key: string }
    | { kind: 'marquee'; start: Point; additive: boolean; moved: boolean; paint: boolean }
    | { kind: 'pan'; lastX: number; lastY: number };
  let drag: Drag | null = null;
  let gesture = 0;

  function toWorld(e: { clientX: number; clientY: number }) {
    const r = svg!.getBoundingClientRect();
    return {
      x: ui.view.x + ((e.clientX - r.left) / r.width) * ui.view.w,
      y: ui.view.y + ((e.clientY - r.top) / r.height) * vh,
    };
  }

  function onpointerdown(e: PointerEvent) {
    if (!svg) return;
    const hit = (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null;

    if (e.button === 1 || (e.button === 0 && ui.spaceDown)) {
      drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e);

    if (ui.tool === 'add' && hit === null) {
      const { x, y } = snapPoint(w);
      if (slotMode && blockedAt({ x, y })) return;
      history.commit((p) => addCell(p, { typeId: ui.addTypeId, x, y }));
      return;
    }

    if (ui.tool === 'series') {
      if (hit !== null) {
        drag = { kind: 'paint', seen: new Set(), key: `paint-${++gesture}` };
        paintCell(hit);
      } else {
        drag = { kind: 'marquee', start: w, additive: false, moved: false, paint: true };
      }
      svg.setPointerCapture(e.pointerId);
      return;
    }

    if (hit !== null) {
      if (e.shiftKey) {
        const next = new Set(ui.selected);
        if (next.has(hit)) next.delete(hit);
        else next.add(hit);
        ui.selected = next;
      } else if (!ui.selected.has(hit)) {
        ui.selected = new Set([hit]);
      }
      if (ui.selected.has(hit)) {
        const anchorCell = project.cells.find((c) => c.id === hit);
        drag = {
          kind: 'move',
          ids: [...ui.selected],
          start: w,
          anchor: { x: anchorCell?.x ?? w.x, y: anchorCell?.y ?? w.y },
          lat: lattice, // congelata a inizio gesto: il passo non cambia durante il trascinamento
          px: { x: e.clientX, y: e.clientY },
          active: false,
          applied: { dx: 0, dy: 0 },
          key: `move-${++gesture}`,
        };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    if (!e.shiftKey) ui.selected = new Set();
    drag = { kind: 'marquee', start: w, additive: e.shiftKey, moved: false, paint: false };
    svg.setPointerCapture(e.pointerId);
  }

  function paintCell(id: string) {
    if (drag?.kind !== 'paint' || drag.seen.has(id)) return;
    drag.seen.add(id);
    const series = ui.activeSeries;
    const alternatePolarity = ui.alternateOnPaint;
    history.commit((p) => paintGroup(p, [id], series, { alternatePolarity }), { coalesceKey: drag.key });
  }

  function onpointermove(e: PointerEvent) {
    if (!svg) return;
    const w = toWorld(e);
    if (ui.tool === 'add') {
      const sp = snapPoint(w);
      hover = { ...sp, blocked: slotMode && blockedAt(sp) };
    } else hover = null;
    if (!drag) return;

    if (drag.kind === 'pan') {
      const k = ui.view.w / svg.getBoundingClientRect().width;
      ui.view = {
        ...ui.view,
        x: ui.view.x - (e.clientX - drag.lastX) * k,
        y: ui.view.y - (e.clientY - drag.lastY) * k,
      };
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
    } else if (drag.kind === 'paint') {
      const id = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]')?.getAttribute('data-id');
      if (id) paintCell(id);
    } else if (drag.kind === 'move') {
      // Soglia di 3 px: un semplice clic non sposta la cella.
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.px.x, e.clientY - drag.px.y) < 3) return;
        drag.active = true;
      }
      let dx: number;
      let dy: number;
      if (slotMode) {
        // La cella afferrata va sullo slot più vicino; le altre la seguono.
        const target = { x: drag.anchor.x + (w.x - drag.start.x), y: drag.anchor.y + (w.y - drag.start.y) };
        const snapped = snapToSlot(drag.lat, target.x, target.y);
        dx = round3(snapped.x - drag.anchor.x);
        dy = round3(snapped.y - drag.anchor.y);
      } else {
        dx = snapTo(w.x - drag.start.x, ui.snap as number);
        dy = snapTo(w.y - drag.start.y, ui.snap as number);
      }
      const ddx = dx - drag.applied.dx;
      const ddy = dy - drag.applied.dy;
      if (ddx !== 0 || ddy !== 0) {
        const { ids, key } = drag;
        history.commit((p) => moveCells(p, ids, ddx, ddy), { coalesceKey: key });
        drag.applied = { dx, dy };
      }
    } else {
      drag.moved = true;
      marquee = normalizeRect(drag.start.x, drag.start.y, w.x, w.y);
    }
  }

  function onpointerup(e: PointerEvent) {
    if (drag?.kind === 'marquee' && drag.moved && marquee) {
      const ids = cellsInRect(project, marquee);
      if (drag.paint) {
        const series = ui.activeSeries;
        const alternatePolarity = ui.alternateOnPaint;
        history.commit((p) => paintGroup(p, ids, series, { alternatePolarity }));
      } else {
        ui.selected = drag.additive ? new Set([...ui.selected, ...ids]) : new Set(ids);
      }
    }
    marquee = null;
    drag = null;
    if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  }

  // La rotella zooma attorno al puntatore: serve un listener non passivo per bloccare lo scroll della pagina.
  $effect(() => {
    const el = svg;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = toWorld(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.min(Math.max(Math.exp(delta * 0.0015), 0.5), 2);
      const nw = Math.min(Math.max(ui.view.w * factor, 20), 20000);
      const f = nw / ui.view.w;
      ui.view = { x: w.x - (w.x - ui.view.x) * f, y: w.y - (w.y - ui.view.y) * f, w: nw };
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  onMount(() => {
    ui.stage = svg ?? null;
    const id = requestAnimationFrame(() => ui.fit(history.get().present));
    return () => {
      cancelAnimationFrame(id);
      ui.stage = null;
    };
  });
</script>

<div class="stage" bind:clientWidth={cw} bind:clientHeight={ch}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg}
    {viewBox}
    class:pan={ui.spaceDown}
    class:adding={ui.tool === 'add'}
    class:painting={ui.tool === 'series'}
    role="application"
    aria-label={t('editor.aria')}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointerleave={() => (hover = null)}
  >
    <defs>
      <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="var(--grid)" stroke-width="1" vector-effect="non-scaling-stroke" />
      </pattern>
    </defs>

    {#if visibleSlots}
      <g class="slots" pointer-events="none">
        {#each visibleSlots as s (`${s.x},${s.y}`)}
          {#if ui.tool === 'add'}
            <circle class="slot-ring" cx={s.x} cy={s.y} r={ghostRadius} />
          {/if}
          <circle class="slot-dot" cx={s.x} cy={s.y} r={2 * k} />
        {/each}
      </g>
    {:else if ui.showGrid && ui.view.w < 1500}
      <rect x={ui.view.x} y={ui.view.y} width={ui.view.w} height={vh} fill="url(#grid)" pointer-events="none" />
    {/if}

    {#if ui.showHolder && holderModel}
      <path class="holder" style:--holder-fill={ui.holderView.color} d={regionsPath(holderModel.wall)} fill-rule="evenodd" pointer-events="none" />
    {/if}
    {#if ntcGroove?.route}
      <path class="ntc-groove" d={regionsPath(ntcGroove.route.polygons.map((outline) => ({ outline, holes: [] })))} pointer-events="none" />
      {#if ntcGroove.site}
        <circle class="ntc-pocket" cx={ntcGroove.site.x} cy={ntcGroove.site.y} r={ntcGroove.site.radiusMm} pointer-events="none" />
        <circle class="ntc-wire" cx={ntcGroove.site.x} cy={ntcGroove.site.y} r={NTC_WIRE_HOLE_MM / 2} pointer-events="none" />
      {/if}
    {/if}
    {#if holderSplit}
      <path class="seam" d={seamsPath(holderSplit.seams)} pointer-events="none" />
    {/if}

    {#each project.cells as c (c.id)}
      {@const r = radii.get(c.typeId) ?? 9}
      {@const col = groupColor(c.group)}
      {@const flag = flagged.get(c.id)}
      {@const endPlus = ui.face === 'top' ? c.plusUp : !c.plusUp}
      <g data-id={c.id} transform="translate({c.x} {c.y})" class="cell" class:selected={ui.selected.has(c.id)}>
        {#if flag}
          <circle class="flag" class:error={flag === 'error'} class:warning={flag === 'warning'} r={r + 1.6} />
        {/if}
        <!-- guaina: fascia larga del colore della serie -->
        <circle class="sleeve" {r} fill={c.group === null ? 'var(--muted)' : col} stroke-dasharray={c.group === null ? '4 3' : undefined} />
        {#if r / k >= 9}
          {#if endPlus}
            <!-- polo +: spalla chiara, anello scuro a tacche (aggraffatura), bottone bianco -->
            <circle class="detail" r={r * 0.68} fill="#eceeec" stroke="rgba(0,0,0,0.28)" stroke-width="1" />
            <circle class="detail scaled" r={r * 0.56} fill="none" stroke="#4a4e52" stroke-width={r * 0.05} />
            <circle class="detail scaled" r={r * 0.62} fill="none" stroke="#ffffff" stroke-width={r * 0.04} />
            <circle class="detail" r={r * 0.46} fill="#ffffff" stroke="#c4c7c9" stroke-width="0.8" />
          {:else}
            <!-- polo −: fondo piatto beige -->
            <circle class="detail" r={r * 0.68} fill="#e6decd" stroke="rgba(0,0,0,0.3)" stroke-width="1" />
            <circle class="detail" r={r * 0.6} fill="none" stroke="rgba(120,104,76,0.25)" stroke-width="1" />
          {/if}
          {#if c.group !== null}
            <text class="num" class:onplus={endPlus} font-size={r * 0.62} y={r * 0.03}>{c.group + 1}</text>
          {/if}
          <!-- polarità: piccola, sul bordo della fascia colorata -->
          <text class="sign" font-size={r * 0.26} y={-r * 0.84}>{endPlus ? '+' : '−'}</text>
        {:else}
          <text class="plain" font-size={r * 0.8} y={r * 0.05}>{endPlus ? '+' : '−'}</text>
        {/if}
      </g>
    {/each}

    {#if holderSplit}
      <g class="pieces" pointer-events="none" font-size={12 * k} style:--halo="{3 * k}px">
        {#each holderSplit.pieces as piece (piece.id)}
          <text x={piece.model.bounds.minX} y={piece.model.bounds.minY - 4 * k}>{piece.id}</text>
        {/each}
      </g>
    {/if}

    {#if ui.showStrips}
      <g class="strips" pointer-events="none" style:--strip-op={ui.stripOpacity} style:--halo="{2.5 * k}px" style:--strip-fill={stripReport?.material.colorHex ?? '#b0b6bd'}>
        {#each strips as s (s.id)}
          <path class="strip" class:bad={stripSeverity.get(s.id) === 'error'} class:warn={stripSeverity.get(s.id) === 'warning'} d={pathOf(s)} fill-rule="evenodd" />
        {/each}
        {#if ui.showSpots && stripReport}
          {#each strips as s (s.id)}
            {#each spotMarks(s, spotNeed.get(s.id) ?? 0, stripReport.welder) as p, i (`${s.id}-${i}`)}
              <circle class="spot" cx={p.x} cy={p.y} r={stripReport.welder.spotDiameterMm / 2} />
            {/each}
          {/each}
        {/if}
        {#each strips as s (s.id)}
          {@const lx = s.outline.reduce((a, p) => a + p.x, 0) / s.outline.length}
          {@const ly = s.outline.reduce((a, p) => a + p.y, 0) / s.outline.length}
          <text class="strip-label" x={lx} y={ly} font-size={11 * k}>{s.label}</text>
        {/each}
      </g>
    {/if}

    {#if ui.showDims && bounds}
      {@const w = bounds.maxX - bounds.minX}
      {@const d = bounds.maxY - bounds.minY}
      {@const off = 20 * k}
      {@const tick = 5 * k}
      {@const labelY = Math.max(bounds.maxY, ...strips.flatMap((s) => s.outline.map((p) => p.y)))}
      <g class="dims" pointer-events="none" font-size={12 * k} style:--halo="{3 * k}px">
        <rect class="envelope" x={bounds.minX} y={bounds.minY} width={w} height={d} />
        <!-- larghezza -->
        <line x1={bounds.minX} x2={bounds.maxX} y1={bounds.minY - off} y2={bounds.minY - off} />
        <line x1={bounds.minX} x2={bounds.minX} y1={bounds.minY - 2 * k} y2={bounds.minY - off - tick} />
        <line x1={bounds.maxX} x2={bounds.maxX} y1={bounds.minY - 2 * k} y2={bounds.minY - off - tick} />
        <text x={(bounds.minX + bounds.maxX) / 2} y={bounds.minY - off - 8 * k}>{len(w, 1)}</text>
        <!-- profondità -->
        <line x1={bounds.minX - off} x2={bounds.minX - off} y1={bounds.minY} y2={bounds.maxY} />
        <line x1={bounds.minX - 2 * k} x2={bounds.minX - off - tick} y1={bounds.minY} y2={bounds.minY} />
        <line x1={bounds.minX - 2 * k} x2={bounds.minX - off - tick} y1={bounds.maxY} y2={bounds.maxY} />
        <text transform="translate({bounds.minX - off - 8 * k} {(bounds.minY + bounds.maxY) / 2}) rotate(-90)">{len(d, 1)}</text>
        <!-- altezza (asse verticale delle celle, non visibile da sopra) -->
        <text class="h" x={bounds.maxX} y={labelY + 14 * k}>{t(bounds.withHolder ? 'editor.heightPack' : 'editor.heightCells', { height: len(bounds.heightMm, 1) })}</text>
      </g>
    {/if}

    {#if ui.tool === 'add' && hover}
      <circle class="ghost" class:blocked={hover.blocked} cx={hover.x} cy={hover.y} r={ghostRadius} pointer-events="none" />
    {/if}

    {#if marquee}
      <rect
        class="marquee"
        x={marquee.minX}
        y={marquee.minY}
        width={marquee.maxX - marquee.minX}
        height={marquee.maxY - marquee.minY}
        pointer-events="none"
      />
    {/if}
  </svg>

  <span class="face-tag" class:bottom={ui.face === 'bottom'} title={t('editor.flipFace')}>{t('editor.faceTag', { face: t(ui.face === 'top' ? 'editor.faceTop' : 'editor.faceBottom') })}</span>

  {#if project.cells.length === 0}
    <p class="empty">
      {t('editor.empty1')}<br />{t('editor.empty2a')} <kbd>A</kbd> {t('editor.empty2b')}
    </p>
  {/if}
</div>

<style>
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--canvas);
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    user-select: none;
    cursor: default;
  }
  svg.adding {
    cursor: crosshair;
  }
  svg.painting {
    cursor: cell;
  }
  svg.pan {
    cursor: grab;
  }
  .cell {
    cursor: pointer;
  }
  .cell circle {
    vector-effect: non-scaling-stroke;
  }
  .cell .sleeve {
    stroke: rgba(0, 0, 0, 0.35);
    stroke-width: 1px;
  }
  .cell.selected .sleeve {
    stroke: var(--accent);
    stroke-width: 3.5px;
  }
  .detail {
    pointer-events: none;
  }
  .cell circle.scaled {
    vector-effect: none; /* anelli che crescono con la cella, non a spessore fisso */
  }
  text {
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
    font-weight: 600;
  }
  .num {
    fill: #bec2c6;
    font-weight: 700;
  }
  .num:not(.onplus) {
    fill: #b9ab92;
  }
  .sign {
    fill: #fff;
    stroke: rgba(0, 0, 0, 0.3);
    stroke-width: 0.9px;
    stroke-linejoin: round;
    paint-order: stroke;
    font-weight: 700;
  }
  .plain {
    fill: #fff;
    stroke: rgba(0, 0, 0, 0.5);
    stroke-width: 2px;
    paint-order: stroke;
  }
  .ghost {
    fill: var(--accent);
    fill-opacity: 0.18;
    stroke: var(--accent);
    stroke-dasharray: 4 3;
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
  }
  .face-tag {
    position: absolute;
    left: 10px;
    top: 10px;
    padding: 2px 9px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--panel);
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    font-weight: 600;
    pointer-events: none;
  }
  .face-tag.bottom {
    border-color: var(--accent);
    color: var(--accent);
  }
  .seam {
    fill: none;
    stroke: var(--warn, #e8a33b);
    stroke-width: 2px;
    stroke-dasharray: 7 5;
    vector-effect: non-scaling-stroke;
  }
  .pieces text {
    fill: var(--warn, #e8a33b);
    font-weight: 700;
    paint-order: stroke;
    stroke: var(--bg, #111);
    stroke-width: var(--halo, 2px);
    stroke-linejoin: round;
  }
  .ntc-groove {
    fill: color-mix(in srgb, var(--warn) 55%, transparent);
    stroke: var(--warn);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .ntc-pocket {
    fill: none;
    stroke: var(--warn);
    stroke-width: 1px;
    stroke-dasharray: 3 2;
    vector-effect: non-scaling-stroke;
  }
  .ntc-wire {
    fill: #000;
    stroke: var(--warn);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .holder {
    fill: var(--holder-fill, #353b41);
    fill-opacity: 0.92;
    stroke: color-mix(in srgb, var(--holder-fill, #353b41) 55%, #000);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .strip {
    fill: var(--strip-fill, #b0b6bd);
    fill-opacity: var(--strip-op, 0.85);
    stroke: color-mix(in srgb, var(--strip-fill, #b0b6bd) 45%, #000);
    stroke-width: 1.2px;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .strip.warn {
    stroke: var(--warn);
    stroke-width: 2.4px;
  }
  .strip.bad {
    stroke: var(--danger);
    stroke-width: 2.4px;
    fill: #c88282;
  }
  .spot {
    fill: #2c2f33;
    fill-opacity: 0.85;
    stroke: #fff;
    stroke-width: 0.8px;
    vector-effect: non-scaling-stroke;
  }
  .strip-label {
    fill: #1d2227;
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: var(--halo, 0.3px);
    stroke-linejoin: round;
    paint-order: stroke;
    font-weight: 700;
  }
  .ghost.blocked {
    fill: var(--danger);
    fill-opacity: 0.15;
    stroke: var(--danger);
  }
  .slot-dot {
    fill: var(--dim);
    opacity: 0.55;
  }
  .slot-ring {
    fill: none;
    stroke: var(--dim);
    stroke-width: 1px;
    stroke-dasharray: 3 3;
    opacity: 0.45;
    vector-effect: non-scaling-stroke;
  }
  .flag {
    fill: none;
    stroke-width: 2.5px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .flag.error {
    stroke: var(--danger);
  }
  .flag.warning {
    stroke: var(--warn);
  }
  .dims line,
  .envelope {
    stroke: var(--dim);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .envelope {
    fill: none;
    stroke-dasharray: 6 4;
  }
  .dims text {
    fill: var(--fg);
    stroke: var(--canvas);
    stroke-width: var(--halo, 0.4px);
    stroke-linejoin: round;
    paint-order: stroke;
    font-weight: 500;
  }
  .dims text.h {
    text-anchor: end;
    fill: var(--muted);
  }
  .marquee {
    fill: var(--accent);
    fill-opacity: 0.1;
    stroke: var(--accent);
    stroke-dasharray: 4 3;
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
    margin: 0;
    color: var(--muted);
    pointer-events: none;
    line-height: 1.6;
  }
  kbd {
    font: inherit;
    font-size: 0.8em;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 5px;
  }
</style>
