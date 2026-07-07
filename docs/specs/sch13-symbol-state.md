# SCH-13 — Schematic symbols reflect part state (use the already-rendered glyphs)

**Status:** spec (Cowork, 2026-07-06) — ready for Claude Code. **Small follow-on to SCH-11.**
**Scope:** `src/core/symbolArt.ts` (kind→glyph mapping) + tests. Visual only, **no `core/signal.ts`**,
no netlist change. The SVGs already exist in `core/symbolCatalog.ts` (rendered in the SCH-11 Tikz→SVG
pass); this phase just maps them.

andre, 2026-07-06: we rendered the full circuitikz catalog but a few glyphs sit unused — wire the
ones that carry real meaning.

## What to map

`symbolFor()` (`core/symbolArt.ts`) currently hardcodes:
- `awg1`/`awg2` → `vsource_sin` regardless of the selected waveform.
- `capacitor` → `capacitor` even for the SCH-10 polarized electrolytic.

Change:

1. **W1/W2 (and `vsource`) show the actual wave shape.** Pick the catalog glyph from the source's
   `waveType`: sine → `vsource_sin`, square → `vsource_square`, triangle → `vsource_tri`, sawtooth →
   `vsource_saw`. (All four are already in the catalog.) The pin ids/order are unchanged (`p0`,`p1`),
   so nets, the drawn ground return, and the sim are untouched. If a source has no waveType (or an
   unmapped shape), fall back to `vsource_sin`.
2. **Polarized electrolytic uses `polarized_cap`, drawn WITH its polarity (andre, 2026-07-06 — there
   is a polarity to respect).** A polarized electrolytic maps to `polarized_cap`; plain ceramic stays
   `capacitor`. The `polarized_cap` glyph must render with the **+ terminal marked** and a fixed
   orientation, and its two leads are **NOT interchangeable** — the + lead is a specific terminal.
   - **Distinction mechanism (shared with ARB-7):** the model currently has no polarized marker. SCH-10
     documented the kit rule — electrolytics are the caps **≥ 1 µF** (1/4.7/10/22/47/220 µF), ceramics
     are **< 1 µF**. Implement one shared `isPolarizedCap(c)` (kit rule: `value ≥ 1e-6`), used by BOTH
     this glyph mapping and ARB-7's `isSymmetric`. If andre prefers an **explicit `polarized` flag** on
     the component over the value threshold, add it and derive the default from the value — confirm
     with andre. Do not leave polarity unmodeled; it must be respected.
   - **Terminal semantics:** ensure the polarized cap's terminal A = **+** consistently (like the diode
     anode), so ARB-7's board Check enforces correct orientation and the glyph's + matches the netlist
     node the designer thinks is +. Coordinate with ARB-7 (same `isPolarizedCap`).

Leave `current_source`, `dc_source`, `njfet`, `pjfet` unused — no matching part kind exists (no
discrete JFET or current-source part). Note them as available-if-a-part-is-ever-added.

## Acceptance / DoD
- A square-wave W1 renders the square-source glyph; changing waveType re-renders the matching glyph;
  a polarized cap renders `polarized_cap`. Pin anchors/wire-attach/rotate/flip/PNG export unchanged.
- Unit test on `symbolFor()` for each waveType→glyph and the polarized-cap case; `npm test` green;
  `tsc && vite build` clean; **no `core/signal.ts` diff**; sim baseline untouched.
- Update ROADMAP (SCH-13 → DONE), PROGRESS, handoff hash.
