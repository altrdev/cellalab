# CellaLab

Browser app to design DIY battery packs: 2D editor, 3D preview, 3D-printable cell holder (STL) and busbar strips to cut (DXF/SVG). Static app, no backend. Svelte 5 (runes) + TypeScript 6 + Vite 8 + Vitest + three.js + clipper-lib.

Planned work and open items: [docs/TODO.md](docs/TODO.md). Original specification (Italian, a first draft): [docs/spec.it.md](docs/spec.it.md).

## Working with the owner

- Reply in the language the user writes in (usually Italian, sometimes English). The **app UI strings are Italian** and stay Italian.
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

- `src/core`: pure logic, no DOM, fully unit-tested: model (`types.ts`, `project.ts`, `ops.ts`, `history.ts`), lattice/layout (`lattice.ts`, `layout.ts`), calculations (`stats.ts`, `sizing.ts`), checks (`drc.ts`), busbars (`strips.ts`, `lamelle.ts`, `lamelleExport.ts`, `dxf.ts`), holder (`holder.ts`), geometry helpers (`clip.ts`, `polygon.ts`, `geometry.ts`), catalog (`catalog.ts`, `celltype.ts`, `materials.ts`, `profiles.ts`), `stl.ts`.
- `src/ui`: Svelte components and UI state. `ui.svelte.ts` is the shared UI state (selection, tool, view mode, settings); the project itself lives in the undo/redo store `history` (`src/state.ts`). `Editor.svelte` (2D SVG), `Preview3D.svelte` + `scene3d.ts` (three.js, lazy-loaded), `Sidebar.svelte` with tabs Pacco / Lamelle / Portacelle / Esporta, `PackBar.svelte` (data strip), `Toolbar.svelte`.
- Keep logic in `core`; the UI only wires state and rendering.

## Data model and conventions

- Units are **millimetres**. Origin top-left, **y points down**. In the 3D scene the drawing x,y map to X,Z and height goes up Y.
- **Geometry** (cell position, type, polarity) is separate from **electrical topology**: `group` is the 0-based parallel-group index, groups are in series in index order. 3D, holder, busbars and calculations derive from this model.
- `Project.generator` remembers how an automatic S×P pack was generated (layout, spacing, pitch, cell type); `applyLayout` remaps cells onto new slots. `Project.currentLimitA` is the BMS/use limit; pack current is the lower of the cells' and that limit.
- Lattice: centre-to-centre pitch = cell diameter + gap (default gap 1.5 mm). Hexagonal rows are horizontal with vertical pitch p·√3/2 and odd rows offset by p/2.
- Busbar and holder **settings** are UI state (not in undo history), saved in `localStorage` and also written under `settings` in the exported project JSON. Project files are `.cellalab.json`.
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
