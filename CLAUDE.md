# CellaLab

Browser app to design DIY battery packs: 2D editor, 3D preview, 3D-printable cell holder (STL) and busbar strips to cut (DXF/SVG). Static app, no backend. Svelte 5 (runes) + TypeScript 6 + Vite 8 + Vitest + three.js + clipper-lib.

Planned work and open items: [docs/TODO.md](docs/TODO.md). Original specification (Italian, a first draft): [docs/spec.it.md](docs/spec.it.md).

## Working with the owner

- Reply in the language the user writes in (usually Italian, sometimes English). The app UI is **bilingual (Italian / English)**; see "Translations" below.
- Commit messages in English. Keep the Claude attribution trailers the harness asks for.
- Hobby project: one topic at a time, discuss options and decide together before large changes. Give an opinion when asked; do not start big refactors unasked.
- The owner is an experienced developer; be concise and concrete.

## Commands

```bash
npm install
npm run dev      # Vite dev server
npm test         # Vitest (node environment, src/**/*.test.ts)
npm run check    # svelte-check (keep at 0 errors / 0 warnings)
npm run build    # production build in dist/
```

TypeScript 7 is not supported by svelte-check yet: stay on TypeScript 6. Do not share `node_modules` between Linux and macOS: run `npm install` locally. `dist/` is ignored by git.

Before finishing a change: tests and `npm run check` must pass; for UI work look at it in a browser (Playwright is handy for screenshots).

## Architecture

- `src/core`: pure logic, no DOM, fully unit-tested: model (`types.ts`, `project.ts`, `ops.ts`, `history.ts`), lattice/layout (`lattice.ts`, `layout.ts`), calculations (`stats.ts`, `sizing.ts`), checks (`drc.ts`), busbars (`strips.ts`, `lamelle.ts`, `lamelleExport.ts`, `dxf.ts`), holder (`holder.ts`, `holderSplit.ts`, `zip.ts`), geometry helpers (`clip.ts`, `polygon.ts`, `geometry.ts`), catalog (`catalog.ts`, `celltype.ts`, `materials.ts`, `profiles.ts`), `stl.ts`.
- `src/prefs.ts` + `src/units.ts`: display preferences (length mm/in, temperature °C/°F, weight g·kg / oz·lb, currency with a manual rate from euros) and the conversions/formatters (`len`, `lenNum`, `tempDelta`, `massSmall`, `money`, …). The project data stays in mm, °C, g and euros.
- `src/i18n`: `it.ts` (source language, defines the keys) and `en.ts` (typed on the Italian keys), `t()` / `tn()` / `fmtNum()` in `index.ts`.
- `src/ui`: Svelte components and UI state. `ui.svelte.ts` is the shared UI state (selection, tool, view mode, settings); the project itself lives in the undo/redo store `history` (`src/state.ts`). `Editor.svelte` (2D SVG), `Preview3D.svelte` + `scene3d.ts` (three.js, lazy-loaded), `Sidebar.svelte` with tabs Pacco / Lamelle / Portacelle / Esporta, `PackBar.svelte` (data strip), `Toolbar.svelte`.
- Keep logic in `core`; the UI only wires state and rendering.

## Data model and conventions

- Units are **millimetres**. Origin top-left, **y points down**. In the 3D scene the drawing x,y map to X,Z and height goes up Y.
- **Geometry** (cell position, type, polarity) is separate from **electrical topology**: `group` is the 0-based parallel-group index, groups are in series in index order. 3D, holder, busbars and calculations derive from this model.
- `Project.generator` remembers how an automatic S×P pack was generated (layout, spacing, pitch, cell type); `applyLayout` remaps cells onto new slots. `Project.currentLimitA` is the design current (shown as "Corrente di progetto": your real use, or the BMS cap); pack current is the lower of the cells' and that value. It is the single source for busbar and spot-weld sizing.
- Lattice: centre-to-centre pitch = cell diameter + gap (default gap 1.5 mm). Hexagonal rows are horizontal with vertical pitch p·√3/2 and odd rows offset by p/2.
- Busbar and holder **settings** are UI state (not in undo history), saved in `localStorage` and also written under `settings` in the exported project JSON. Project files are `.cellalab.json`.
- Holder splitting: when a plate is larger than the print bed (`bedXMm`/`bedYMm`, rotation allowed), `splitHolder` groups the cells with the fewest vertical/horizontal cuts that fit and builds each piece as the stepped-chamfer plate ∩ the power-diagram region of its cells (the cut never enters a pocket); pieces are glued, no joints. `holderOf` returns `split` (null if the plate fits); the report, 2D view and Export tab use it. Pieces use the stepped chamfer (not the smooth ramp).
- Holder: each plate is a "cap" (floor + walls with a pocket per cell). `buildHolder(project, settings, smooth)`: with `smooth` the outer chamfer is a continuous ramp (closed wedge meshes in `ui/holderMesh.ts`), falling back to 0.2 mm stairs if offsetting changes topology. The UI always uses `holderOf` (smooth).
- clipper-lib works on integers (scale 1000 µm); types in `src/clipper-lib.d.ts`.

## UI conventions and gotchas

- Scoped CSS per component, global rules in `src/app.css`. Colours: `--accent` is indigo (actions, selection); `--ok` green only for positive states; `--warn` amber; `--danger` red; group colours start from blue (red is reserved for errors).
- Inside `<details>`, flex `gap` does not apply: spacing uses `margin-top: 10px` with `:global(...)` for child-component roots.
- SVG text halos must scale with zoom (`--halo` = n·k px, round line joins).
- In the 2D editor `.cell circle` uses non-scaling strokes; circles that must scale carry the class `scaled`.
- Range sliders are styled globally with `--p`, set by the `rangeFill` action. Fields and selects are 34 px high.
- Keyboard shortcuts stay active on checkboxes and sliders, off in text/number fields and selects: V face, L busbars, S series brush, A add, H fit, 3 cycles drawing / split / 3D.
- 3D holder meshes use creased normals (35°) because circles are polygons.

## Known limits

The holder STL has never been tested in a real slicer; the 3D view was only tested with software rendering. See [docs/TODO.md](docs/TODO.md) for the rest.

## Translations

- All user-visible text is `t('key')` (plural: `tn('base', n)` with `base_one` / `base_other`; numbers: `fmtNum`). Never hard-code UI text. Add the key to **both** `src/i18n/it.ts` and `en.ts`: a missing English key does not compile, and a test checks that both have the same parameters and that every key is used.
- `t()` also works in `core` (messages, checks, export text): the language is a module variable, `'it'` outside the browser, so unit tests run in Italian. Data tables (materials, welders, cutters, catalogue names, cooling) expose `name` / `note` as getters that call `t()`.
- Language: saved choice (`localStorage` `cellalab:lang`), else the browser language (`it*` → Italian, anything else → English). The IT/EN switch is next to the title; `App.svelte` re-mounts the UI on change (`{#key ui.locale}`), so caches keyed on settings need no language in the key.
- Do not name a variable `t` in a file that uses `t()` (it shadows the function).

## Units and currency

- Preferences live in the settings popup (gear next to the title): language, length, temperature, weight, currency + rate. They change only how values are shown and typed; saving, calculations and the STL are always mm / °C / g / euro.
- Dictionary texts have **no fixed units**: callers pass values already formatted with their unit (`len(mm)`, `tempDelta(k)`, `massSmall(g)`, `money(eur)`, `area(cm2)`). Only field labels keep a metric token, `(mm)` `(°C)` `(g)` `(€/…)`, which `t()` swaps for the chosen unit. A test fails if a text hard-codes `mm`, `°C`, `K`, `cm²`, `kg` or `€` (a few exceptions are listed there).
- Number fields in a non-metric unit use `UnitInput.svelte` (props in internal units); the 2D editor, messages, cut list, summary and exports follow the preferences. DXF is written in the chosen unit with `$INSUNITS`; the SVG template declares its size in that unit; the STL stays in mm (the format has no units).
- `App.svelte` re-mounts the UI when language or preferences change (`ui.viewKey`); caches of text-bearing results key on `renderKey()`.
