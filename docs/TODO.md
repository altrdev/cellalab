# TODO

Open items, roughly in priority order. Keep this file up to date; `CLAUDE.md` only links here.

## Verify

- [ ] Open the holder STL (both plates) in a real slicer (PrusaSlicer / Cura): check walls, pockets, floor holes and the chamfer ramp slice correctly. Never tested.
- [ ] Check the 3D view on a real GPU.

## Holder (phase 4 follow-ups)

- [ ] Tolerance test piece: a small plate with pockets at different clearances (0.1 / 0.2 / 0.3 mm) to calibrate the printer.
- [ ] Split big plates into pieces with joints when they exceed the print bed (today only a warning above 220×220 mm). The owner said "wait" on this one: ask before starting.
- [ ] Cooling and cable windows in the walls.
- [ ] Modular holder: one tile per cell with interlocks (lattice layouts only).
- [ ] Optional: 3MF export (STEP was rejected).

## Busbars (phase 3 follow-ups)

- [ ] Fuse-per-cell strips (postponed).
- [ ] PDF template (only offered so far; SVG exists).
- [ ] Two-level busbars; single thickness only today.

## BMS (phase 5)

- [ ] BMS catalogue (supported S, max current, balance connector, size, holes, B-/P-/P+ positions, NTC) plus custom entries.
- [ ] Checks: pack S = BMS S, current, chemistry, n+1 balance wires.
- [ ] Balance-wire tabs on series busbars, through holes between faces, wire channels (chosen AWG), single exit, larger holes for power cables, NTC pocket.
- [ ] BMS mounted on the pack (pocket + spacers) or external (wire exit with strain relief).

## Polish (phase 6)

- [ ] Resistor-network model of the busbars (real currents and hot spots).
- [ ] Nesting for cut lists, share links, assembly PDF.
- [ ] Other cell families (26650, 32700, 4680) beyond custom entries.

## UI

- [ ] The sidebar result card repeats configuration, V, Wh and A, which are now also in the data strip. The owner chose to leave it for now.
- [ ] Busbar settings defaults for a 3S2P show "problems" (pure nickel is not enough): pre-existing behaviour, review the defaults.

## Project housekeeping

- [ ] Before making the repo public: replace the author e-mail in the git history with the GitHub no-reply address; re-check the licence (MIT for now).
