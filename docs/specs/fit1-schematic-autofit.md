# FIT-1 — Schematic is always fully framed on the sketch pad (auto-fit)

**Goal:** the schematic must **never be clipped by the edge of the sketch pad**. In the current build, loading a circuit can leave part of the drawing off-canvas — in the reported case the top-left instrument (supply / scope glyph) is cut off by the left edge, so its body, terminal, and label are not visible and the student can't tell what it is. The whole schematic — every component body, terminal, instrument-ground glyph, and text label — must always sit fully inside the visible drawing area with a margin.

**Behavior chosen with André: full auto-fit / always reframe.** The editor re-frames (pans + zooms to fit) the entire schematic on load *and* on every structural change, so the drawing is continuously kept fully in view. Accepted trade-off (André's call): the view may shift while placing/moving parts, in exchange for a hard guarantee that nothing is ever clipped.

Pure editor/viewport work. No signal path, no `toCircuit`, no netlist, no Check changes.

---

## Design decisions (locked with André)

1. **Always reframe.** After any change that alters the drawing's bounding box — load/open, select an Example, place, delete, move, rotate, flip, add/remove a wire — the viewport re-fits so the full content is visible with margin. This is the "Full auto-fit (always reframe)" option, chosen over fit-on-load-only.
2. **Fit the *rendered* extent, not the grid nodes.** The clipping in the report is a component **glyph/label** past the edge, not a terminal grid point. The bounding box must include everything drawn: component bodies, the fixed instrument-ground symbols (W1/W2 return ground, V+/V− reference-pole ground), reference designators (`R1`), value labels (`1.5kΩ`, `100nF`), node labels (`GND`, `1−`, `1`), and wires. Fitting to terminal coordinates alone will still clip labels.
3. **Margin on all four sides.** Leave a visible gutter (recommend ~1 grid cell or ~5% of the viewport, whichever is larger) so nothing touches the edge.
4. **Bounded zoom.** Clamp the fit zoom to sane `[minZoom, maxZoom]`. A single tiny component must not zoom to absurd magnification; a large sprawling schematic must not shrink below legibility (if it can't fit at `minZoom`, fit at `minZoom` and center — never clip in a way that hides content without the ability to reach it).
5. **No jitter, no loops.** Reframing must not feed back into itself (a reframe changes the viewport, not the content bbox, so it must not retrigger). Debounce/settle during a live drag: keep content in-bounds while dragging and settle the final fit on drag-end, so the canvas doesn't oscillate on every pixel of mouse movement.

---

## What's wrong now (root-cause hypothesis, CC to confirm)

The editor renders the schematic at a fixed pan/zoom (or a pan/zoom that isn't recomputed when content loads), so a circuit whose geometry starts near/left of the origin renders partly outside the viewport. There is no fit-to-content step, or the existing one measures terminal/grid extent rather than rendered extent. CC to locate the canvas/viewport component and confirm.

---

## What to build

1. **A `fitToContent(viewport, contentBBox, opts)` helper (pure, tested).** Given the content bounding box (in schematic/world coordinates) and the viewport size, compute the pan + zoom that centers the content with the configured margin, clamped to `[minZoom, maxZoom]`. No DOM inside the pure function so it can be unit-tested for: correct centering, margin respected on all sides, zoom clamping, and graceful handling of empty content (no components ⇒ default view, no NaN).
2. **A `contentBBox()` that measures the full rendered extent.** Union the drawn bounds of every component (body + ground glyph + all labels/designators) and every wire. This is the piece most likely to be wrong today — it must account for label/glyph overhang beyond the component's grid node, which is exactly what is clipped in the screenshot.
3. **Wire reframing to the change events.** Call fit after: initial load/open, Example selection, place, delete, move (on drag-end), rotate, flip, wire add/remove, and Clear→new. Debounce so rapid changes coalesce into one fit.
4. **Keep content in-bounds during an active drag** (so a part being dragged toward the edge doesn't visually leave the pad before the settle-fit), then settle to the full fit on release.

---

## Out of scope / explicitly not changing

- **No minimap, no scrollbars, no pan/zoom persistence across reloads.** With always-reframe, a manual zoom/pan is transient and is overridden by the next structural change — this is the accepted consequence of André's choice, not a bug.
- **No change to the grid, snapping, component geometry, or coordinate system.** FIT-1 only changes how the viewport frames existing content.
- **No signal path / `toCircuit` / Check / netlist changes.** Editor viewport only.
- **Breadboard view framing** is out of scope unless the same helper trivially applies — if so, note it in PROGRESS but the DoD is the schematic sketch pad.

---

## Definition of Done

- `npm run build` clean (tsc + Vite); `npm test` green, with new tests for `fitToContent` (centering, per-side margin, min/max zoom clamp, empty content) and, where feasible, a `contentBBox` test proving labels/ground glyphs are included in the extent.
- Live app verified in Chrome: **load every shipped Example** and confirm the entire schematic — including the left-most instrument that was clipped in the report — is fully visible with margin, nothing touching or past any edge. Reproduce the reported RC low-pass and confirm the top-left instrument body, terminal, and label are fully on the pad.
- Place a component near an edge and confirm the view reframes so everything stays visible; rotate/flip/delete and confirm the fit updates without jitter or runaway reframing.
- A deliberately large schematic fits at `minZoom` centered (no hidden, unreachable content); a single small component does not over-zoom.
- 12-bit canary unaffected (`signal.ts`/FFT untouched).
- PROGRESS.md + ROADMAP.md updated (FIT-1 → DONE); one focused commit routed through Claude Code (do not commit from the sandbox).

## Suggested allowed-files list

The schematic canvas/viewport component (pan/zoom state + render transform), a new `fitToContent` core helper + its test, the content-bounds measurement used by the canvas (extend to include labels/glyphs), the change/event wiring that already handles place/move/rotate/flip/delete/load, `PROGRESS.md`, `ROADMAP.md`. Anything beyond this set gets flagged in PROGRESS with a reason. **CC to confirm exact paths in the repo.**

---

## Why this matters

A student who loads a lab and can't see one of the instruments — because its glyph is cut off the edge — has no way to know what they're looking at, and no obvious way to recover it. The sketch pad is the primary surface of the whole tool; content silently rendering off-screen reads as "broken," even when the circuit is fine. Guaranteeing the whole schematic is always framed is a baseline correctness property of the editor.
