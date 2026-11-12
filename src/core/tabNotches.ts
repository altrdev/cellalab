import { MIN_PRINT_WALL_MM, type HolderSettings } from './holder';
import type { Pt } from './polygon';
import { tabsOf, type Strip } from './strips';
import { findAwg } from './wire';

/** Gioco di lato tra linguetta e scanalatura, mm. */
const SIDE_CLEARANCE_MM = 0.3;
/** Spazio in più oltre al filo: la linguetta piegata e la saldatura, mm. */
const DEPTH_EXTRA_MM = 0.2;
/** Una scanalatura più sottile di così non serve a niente. */
const MIN_DEPTH_MM = 0.3;

const DIR: Record<'top' | 'bottom' | 'left' | 'right', Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export interface Notch {
  stripId: string;
  polygon: Pt[];
  /** Profondità reale nella parete, mm. */
  depthMm: number;
  /** Il filo sporge dalla scanalatura: la parete è troppo sottile per alloggiarlo tutto. */
  shallow: boolean;
}

/**
 * Scanalature sul bordo del portacelle dove si appoggiano la linguetta piegata e il suo filo. Profondità: quanto
 * serve al filo (AWG scelto), ma la parete deve restare almeno `MIN_PRINT_WALL_MM`. Partono dal bordo teorico della
 * parete della cella da cui esce la linguetta e vanno verso l'esterno. Se la linguetta è intralciata (passa sopra altre
 * celle) la scanalatura non c'è: taglierebbe le pareti delle celle vicine.
 */
export function tabNotches(strips: readonly Strip[], holder: HolderSettings, wires: { balanceAwg: number; powerAwg: number }): Notch[] {
  const out: Notch[] = [];
  const maxDepth = holder.wallMm - MIN_PRINT_WALL_MM;
  for (const s of strips) {
    // Una linguetta che passa sopra altre celle o lamelle non ha un bordo libero dove stare: niente scanalatura.
    const tabs = tabsOf(s).filter((x) => !x.blockedBy);
    if (tabs.length === 0) continue;
    const tab = tabs[0]!;
    const node = s.nodes.find((n) => Math.hypot(n.x - tab.anchor.x, n.y - tab.anchor.y) < 1e-6);
    if (!node) continue;
    // Le linguette affiancate di un terminale stanno in una sola scanalatura larga; il filo più grosso decide la profondità.
    const wanted = Math.max(...tabs.map((x) => findAwg(x.power ? wires.powerAwg : wires.balanceAwg).outerMm)) + DEPTH_EXTRA_MM;
    const depth = Math.min(wanted, maxDepth);
    if (depth < MIN_DEPTH_MM) continue;
    const d = DIR[tab.side];
    const perp = { x: -d.y, y: d.x };
    const a0 = node.cellRadiusMm + holder.clearanceMm + holder.wallMm - depth;
    const a1 = a0 + depth + 2;
    const v0 = Math.min(...tabs.map((x) => x.lateralMm - x.widthMm / 2)) - SIDE_CLEARANCE_MM;
    const v1 = Math.max(...tabs.map((x) => x.lateralMm + x.widthMm / 2)) + SIDE_CLEARANCE_MM;
    const at = (a: number, p: number): Pt => ({ x: tab.anchor.x + d.x * a + perp.x * p, y: tab.anchor.y + d.y * a + perp.y * p });
    out.push({ stripId: s.id, polygon: [at(a0, v0), at(a1, v0), at(a1, v1), at(a0, v1)], depthMm: depth, shallow: depth < wanted - 1e-9 });
  }
  return out;
}
