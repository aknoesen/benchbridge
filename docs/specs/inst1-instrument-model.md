# INST-1 — Enforce the M2K instrument model (no scope − auto-ground; singleton I/O)

**Status:** spec (Cowork, 2026-07-06) — ready for Claude Code. **PRIORITY** (andre hit both live).
**Authority:** implements `docs/reference/m2k-instrument-model.md` (read it first — it is the settled
decision record). **Scope:** `src/components/SchematicEditor.tsx` + core helper + tests. **No
`core/signal.ts`** (12-bit canary untouched). Not a sim change — the − single-ended sim behavior and
the source/supply grounds are unchanged.

andre, 2026-07-06: "if I place CH1 it automatically draws a ground to 1− — NO, the user decides
differential vs single-ended," and "one can add many CH1 on the same schematic." Both violate the
instrument model. These are two facets of one model, not separate issues.

---

## Part A — The scope − is explicit: no inferred ground, in the drawing OR the sim (Rule 2 + completeness corollary)

**Principle (andre, 2026-07-06): the schematic is complete; there are no inferred connections.** So
single-ended is not "leave − open and infer a ground" — single-ended is the designer **explicitly
wiring − to GND**. This has two sub-parts: A1 (drawing) and A2 (sim). Both inferred grounds go.

### A2 — `toCircuit` must not infer a ground on an unwired − (`core/schematic.ts` ~553)
Today: `if (connected(ts[1])) outRefNet = …` else the channel is sampled single-ended against implicit
ground (unwired − ⇒ ground reference). That silent reference is an inferred connection — remove it:
- **− wired to GND** → `outRefNet`/`scope2RefNet` = the ground net (node 0). Single-ended, explicit,
  same numbers as before (`ch1 = outNet − 0`).
- **− wired to another node** → differential (unchanged).
- **− unwired** → the channel is **incomplete/floating**: do not set a ref, do not sample it against
  implicit ground. Surface it (a "CH1 − is unconnected" flag in the editor / no trace), rather than
  silently grounding. Keep the sim well-posed (don't feed ngspice a floating probe).
- **Example audit (required):** every example that was single-ended via an *unwired* − must add an
  **explicit − → GND wire** in `core/examples.ts` (e.g. signal-sine, rc-lp, amp CH2, and any other
  A1/A2-marked single-ended channel). With the explicit wire the sim result is **identical**, so the
  sim-equivalence baseline stays byte-identical — that is the pass criterion for the migration. List
  the touched examples for andre.
- `isPointConnected` / the `connected(ts[1])` test stays; what changes is that "unwired" no longer
  means "grounded," it means "incomplete."

### A1 — Remove the auto-ground glyph on the scope − (drawing)

Today `renderSymbol` draws the catalog ground glyph on a scope − whenever it is unwired:

```ts
// SchematicEditor.tsx ~1379
function scopeNegUnwired(c, s) { /* true when scope1/scope2 − terminal is not connected */ }
// ~1481
const drawReturnGround = c.kind === 'awg1' || c.kind === 'awg2' ||
  ((c.kind === 'scope1' || c.kind === 'scope2') && showNegGround)   // ← the offending branch
```

**Change:** the scope branch goes away. `drawReturnGround` becomes **`awg1`/`awg2` only**. Remove the
`scopeNegUnwired` call site (the `showNegGround` arg passed at ~975) and the helper if now unused. A
placed CH1/CH2 renders its 1+ and 1− as plain terminals; the − shows a ground **only if the designer
wired one there**.

**DO NOT TOUCH — same function, must stay (Rule 1):**
- `awg1`/`awg2` return ground (`drawReturnGround` keeps the AWG condition).
- `vplus`/`vminus`/`dcrail` reference-pole ground (the `else if (c.kind === 'dcrail' || …)` branch,
  ~1525). These are fixed internal bonds and are always drawn. **This is the crux of "not separate
  issues": the scope fix must be surgical and leave every source/supply ground intact.**

**Sim:** handled by A2 above — the drawn glyph (A1) and the inferred sim ground (A2) both go. Once
single-ended examples carry an explicit − → GND wire, the sim-equivalence baseline is byte-identical;
that is the migration's pass criterion.

## Part B — M2K I/O are singletons (Rule 3)

The place path (`SchematicEditor.tsx` ~496) appends any tool's kind with no guard, so N copies of
CH1/W1/… are possible. Enforce **at most one** of each: `scope1`, `scope2`, `awg1`, `awg2`, `vplus`,
`vminus`. **GND (`ground`) stays repeatable.**

Add a core predicate (near the kind sets) so both the editor and any future caller share it:

```ts
export const SINGLETON_KINDS = new Set<SchKind>(['scope1','scope2','awg1','awg2','vplus','vminus'])
export const hasKind = (s: Schematic, k: SchKind) => s.components.some(c => c.kind === k)
```

Enforce at **two** points:
1. **Placement guard** (~496): if `SINGLETON_KINDS.has(kind) && hasKind(sch, kind)`, do not place;
   show a brief status/toast ("Only one CH1 — the M2K has one ADC channel", etc.) and no-op.
2. **Palette affordance:** the palette item for an already-placed singleton is **disabled + greyed**
   with a tooltip, so the user sees why. (Paste/duplicate must respect it too — `duplicatePart` and
   `pasteClipboard` must not clone a singleton kind; drop it from the pasted set with a note.)

Load path: pre-existing/example schematics are assumed valid (one each). If a legacy file somehow
carries two, keep the first and drop extras on load with a console note (do not hard-fail).

## Part C — Scope ⇄ voltmeter are mutually exclusive per channel (Rule 4)

The measurement device already carries `view: 'scope' | 'voltmeter'` (per-channel, presentational,
same pins/nets/sim). On the schematic the exclusion is inherent once Part B enforces one CH1/CH2. The
gap is the **runtime panels**: `App.tsx` treats `scope` and `voltmeter` as independent panels (e.g.
the `bench` preset shows both), so both can display the same channel at once — which the hardware
cannot do.

**Change:** drive panel channel availability from each channel's `view`.
- **Oscilloscope panel** shows a channel only when its measurement `view` is `scope` (undefined =
  scope default); a channel whose view is `voltmeter` renders **unavailable** (greyed trace slot /
  "CH1 in use by the voltmeter"), not a live trace.
- **Voltmeter panel** shows a channel only when its view is `voltmeter`; a `scope`-view channel shows
  **unavailable** ("CH1 in use by the scope").
- Independent per channel; CH1 and CH2 can differ.

Source of truth = the schematic's CH1/CH2 `view` (App already threads the drawn circuit/probes to
both panels). Do **not** add a second, separate toggle — one place decides. Exact greyed-slot styling
is a UX detail; confirm with andre before polishing. If no measurement device is placed for a
channel, that channel is simply absent in both panels (unchanged).

> Note: this part touches `App.tsx` + `Oscilloscope.tsx` + `Voltmeter.tsx` (panels), whereas A/B are
> the schematic editor. If cleaner to ship as its own commit/phase, split it out as **INST-2** and do
> A+B first — but it is the same model (Rule 4) and must not be dropped.

---

## Acceptance criteria / tests

Editor-level (jsdom/RTL where the suite already does component tests) + core-level where possible:

1. **No auto-ground on placement, no inferred sim ground.** Place a fresh CH1, nothing wired → no
   ground glyph on 1− (ground-symbol group count for that part = 0) AND `toCircuit` sets no
   `ch1n`/ref for it (the channel is flagged incomplete, not silently ground-referenced). Same CH2.
2. **Single-ended = explicit − → GND.** Wire 1− to a GND symbol → ground renders (designer drew it),
   `toCircuit` sets `ch1n` = node 0, and the reading equals the old single-ended value.
3. **Differential still works.** Wire 1− to another node → differential; no spurious ground.
3b. **Example migration is result-neutral.** After adding explicit − → GND wires to the formerly
   unwired-single-ended examples, `sch11-sim-baseline` / sim-equivalence tests are byte-identical.
4. **Source/supply grounds intact (Rule 1 guard).** W1, W2, V+, V− each still render their internal
   ground with nothing else wired. (This test is the regression tripwire for Part A being too broad.)
5. **Singletons.** With a CH1 present, attempting to place a second CH1 is a no-op and the palette
   item is disabled; repeat for W1, W2, V+, V−. A second GND **is** allowed. Duplicate/paste of a
   singleton is dropped.
6. **Sim/baseline unchanged.** `sch11-sim-baseline` / sim-equivalence tests byte-identical; canary
   untouched; every existing example still loads and checks/simulates as before.

## Definition of Done
- Part A + Part B implemented per the model; source/supply grounds provably untouched (test #4).
- New tests 1–6 green; `npm test` all green; `tsc && vite build` clean; **no `core/signal.ts` diff**.
- Live in Chrome: place CH1 → no ground on 1−; wire 1− to GND → ground appears; try to add a 2nd CH1
  → blocked + palette greyed; confirm W1/W2/V+/V− still show their grounds.
- Update `ROADMAP.md` (INST-1 → DONE), `PROGRESS.md`, handoff log with the commit hash. If any
  single-ended example needs an explicit − ground wire, list them for andre first.
