# TODO

Open items, roughly in priority order. Keep this file up to date; `CLAUDE.md` only links here.

## Verify

- [x] Holder STL opened in Bambu Studio (tolerance piece and a real holder): no open edges, slices fine. Still to do: actually print one, and try PrusaSlicer / Cura if convenient.
- [ ] Check the 3D view on a real GPU.
- [ ] DXF in inches (`$INSUNITS`) and the inch SVG template: written but never opened in a real CAD / laser program; ask someone who works in inches to check the scale.

## Holder (phase 4 follow-ups)

- [x] Tolerance test piece (Esporta tab, `buildToleranceTest`): low plate with pockets at 0.1 / 0.2 / 0.3 mm (editable). Clearance engraved under each pocket in 1/100 mm (7-segment digits, `core/engrave.ts`). Not yet printed: check that the 5 mm / 0.8 mm digits are legible.
- [x] Split big plates into pieces (`core/holderSplit.ts`): cuts follow the power-diagram boundary between cells (never through a pocket), flat faces to glue, one STL per piece + ZIP, dashed seams and labels in the 2D view. Open: alignment pins / dovetails, staggering the top and bottom seams, showing the pieces in the 3D view, checking the glue seams on a real print.
- [ ] Cooling and cable windows in the walls.
- [ ] Modular holder: one tile per cell with interlocks (lattice layouts only).
- [ ] Optional: 3MF export (STEP was rejected).

## Busbars (phase 3 follow-ups)

- [ ] Fuse-per-cell strips (postponed).
- [ ] PDF template (only offered so far; SVG exists).
- [ ] Two-level busbars; single thickness only today.

## BMS (phase 5)

- [x] BMS catalogue: generic profiles (supported S range, max current, chemistry, NTC) plus custom entries (`core/bms.ts`, `BmsPanel.svelte`). The BMS current caps the pack current.
- [ ] BMS catalogue still missing: balance connector, size, holes, B-/P-/P+ positions (needed by the mounting step).
- [x] Checks: pack S = BMS S, current, chemistry, n+1 balance wires (info only).
- [x] Balance-wire tabs on the busbars: one per joint (S+1), drilled, on a chosen side; part of the busbar outline, so cut and exported with it.
- [ ] Through holes between faces, wire channels (chosen AWG), single exit in the holder, larger holes for power cables, NTC pocket.
- [ ] BMS mounted on the pack (pocket + spacers) or external (wire exit with strain relief).

## Polish (phase 6)

- [ ] Resistor-network model of the busbars (real currents and hot spots).
- [ ] Nesting for cut lists, share links, assembly PDF.
- [ ] Other cell families (26650, 32700, 4680) beyond custom entries.

## UI

- [ ] The sidebar result card repeats configuration, V, Wh and A, which are now also in the data strip. The owner chose to leave it for now.
- [x] Busbar defaults showed "problems" for a 3S2P: the thermal model now uses the band length (fin model, ends on the cells at `cellRiseK`, default 15 K) instead of an infinite strip in air. Open: no current-density cap (0.1 mm nickel passes at ~10 A/mm²), spot-weld/contact heating not modelled; check against a real pack.

## Project housekeeping

- [x] Author e-mail in the git history replaced with the GitHub no-reply address (done before going public).
- [x] Licence re-checked: staying with MIT; the README safety notice covers the lithium-pack risks.
