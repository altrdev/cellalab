# CellaLab

**A browser-based configurator for DIY battery packs.** Design the pack (or generate it from series and parallel counts), view it in 3D, and export a 3D-printable cell holder and busbar strips ready to cut.

English · [🇮🇹 Italiano](README.it.md)

## What it does

- **Pack:** automatic S×P generation (hexagonal or square layout) or free drawing cell by cell; series brush, parallel groups, polarity, undo/redo. Computes voltage, capacity, energy, current, weight, cost and overall size.
- **Cells:** a catalogue with generic profiles and 14 commercial 18650/21700 models (BAK, Samsung, Molicel, Murata, LG) with indicative prices; you can duplicate and edit them.
- **Current and BMS:** pack current is the lower of what the cells can deliver and the BMS limit; the busbars are sized on that value.
- **Checks:** overlapping cells, minimum spacing for the holder, unbalanced groups, polarity, limit above what the cells can handle.
- **3D preview** (three.js): drawing and 3D side by side, exploded view, isometric/top/front/side views.
- **Busbar strips:** generated from the pack topology and sized on material, thickness and current (nickel, copper, etc.), with suggested weld spots. Export a **DXF** for laser/CNC (with kerf compensation), a 1:1 **SVG** template and a cut list.
- **3D-printable holder:** two custom plates with cell pockets, a floor that retains the cells, fillets and a smooth sloped chamfer. Export an **STL** in print orientation. Plates bigger than your print bed are split into pieces to glue (cuts run through the wall between cells), with one STL per piece and a ZIP of all of them.
- **Project:** automatic saving in the browser; save and open `.cellalab.json` files (they include the busbar and holder settings).

The interface is available in English and Italian (it follows the browser language) and can show lengths in mm or inches, temperatures in °C or °F, weights in g/kg or oz/lb and prices in €, $ or £: open the settings with the gear next to the title. Files for cutting follow the length unit (DXF, SVG template); the STL is always in mm.

## Quick start

Requires Node 22 or newer.

```bash
npm install
npm run dev      # development, usually at http://localhost:5173
npm test         # tests (Vitest)
npm run check    # type check (svelte-check)
npm run build    # production build in dist/
```

## How to use it

1. **Pacco (Pack):** choose "Genera automaticamente" (set S, P, cell and spacing) or "Disegna a mano" (draw by hand).
2. **Lamelle (Busbars):** pick material, thickness and welder; the tab shows the result and warnings.
3. **Portacelle (Holder):** adjust walls, clearance, floor and chamfer.
4. **Esporta (Export):** DXF, template, cut list, STL and project saving.

## Status and limitations

A hobby project under development.

- The holder STL opens and slices cleanly in Bambu Studio, but no holder has been **printed yet**: always check the preview in your slicer before printing. Large plates split into glued pieces have not been tried on a real print.
- Thermal sizing of the busbars is a steady-state estimate (fin model, ends held at a set temperature rise on the cells): it ignores spot-weld and contact resistance and has not been checked against a real pack.
- DXF in inches and the inch SVG template have never been opened in a real CAD or laser program.
- Busbars are single-layer with one thickness.
- Cell prices and currents are indicative (from nkon.nl, November 2026) and must be checked against the datasheet.
- The 3D view has been tested with software rendering, not on a real GPU.

## Safety

A lithium cell pack can catch fire or explode if badly designed or built. CellaLab is a design aid, **not a certification**: its results are estimates, provided as is, with no warranty (see the [licence](LICENSE)). You are responsible for what you build.

- Check every value against the **datasheet** of your cells, BMS and welder; prices and currents in the catalogue are only indicative.
- Use a BMS suited to the cells and the current, fuses or other overcurrent protection, and proper cell-level protection where needed.
- Do not trust the busbar and spot-weld sizing alone: test a real pack under load, watching temperatures, before relying on it.
- Never mix cells of different type, age or charge state; keep the pack away from heat and flammable material while charging and testing.
- Handle bare cells with care: a short circuit with a tool or a loose strip can cause burns or fire. Work with insulated tools and cover exposed terminals.
- If you are not sure, ask someone experienced before building.

## Structure

```
src/core   pure logic (model, calculations, checks, busbars, holder, DXF/STL), with tests
src/ui     Svelte interface, 2D editor, 3D scene, exports
```

Stack: Svelte 5, TypeScript, Vite, Vitest, three.js, clipper-lib.

## License

[MIT](LICENSE) © 2026 Alessandro Travi
