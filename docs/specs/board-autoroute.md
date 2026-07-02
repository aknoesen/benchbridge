# SPEC — F-7: Breadboard auto-routing (manual / hint / auto)

Read `docs/CONVENTIONS.md`, `docs/specs/breadboard.md`, and `docs/PROGRESS.md` first. Board/UI only —
**no `core/signal.ts` change** (12-bit canary untouched). This phase **supersedes the deferred F-4b**
"show one valid layout" hint (that hint is the `hint` state here).

Decided with andre (2026-06-30): the breadboard's **inter-column jumper routing** becomes a
three-state, later-instructor-gated control. Placement stays the student's job (the design decision,
PCB-like); the board already auto-commons within a column/rail (`boardNets` group seeding), so the only
thing on the table is the jumpers that tie columns into the schematic's nets.

---

## Why

On the breadboard the student currently places parts **and** draws every inter-column jumper, then
Check verifies the jumpers reproduce the schematic nets (`checkEquivalence`). Translating schematic nets
into physical jumpers, and debugging a wrong/missing one, is the transfer skill the board view exists to
teach — valuable for a first-year who must wire the real bench. But once a student understands it, hand-
drawing each jumper is tedium. So make the wiring effort a dial the course can fade as competence grows:
full manual early, a check/reveal in the middle, done-for-you later.

**This is the first toggle of what becomes a general feature-toggle framework** (the final objective:
a teacher turns features off per assignment). So the setting is built now as a single named,
serializable key so the future assignment layer only adds a default + a lock, not a rewrite.

---

## The three states (`boardRouting`)

- **`manual`** (default, today's behaviour): student places parts and draws every inter-column jumper;
  Check verifies. Full transfer-and-debug practice. No behaviour change from today.
- **`hint`**: student still draws the jumpers themselves, but a **"Show a valid wiring"** action
  reveals a generated jumper set as a **non-committing overlay** (distinct styling — dashed/ghosted),
  annotated per net with *why* each jumper exists (e.g. "these two columns are the summing node"). It is
  a reference to reproduce, NOT filled into the student's `board.jumpers`. Toggle the overlay off again.
- **`auto`**: given the placed parts, the jumper set is generated and shown as **read-only** wiring; the
  student places parts only. Placement stays manual; the routing is done for them. The generated jumpers
  render in a "generated" style (not editable), and Check passes by construction.

All three ride one pure engine function (below). `manual` ignores it, `hint` reveals it on demand,
`auto` applies it as read-only.

---

## What to build

### 1. `core/breadboard.ts` — the pure engine (the testable core)

```ts
// Given the schematic and the current placement, return a valid inter-column jumper set that makes
// checkEquivalence pass. Pure: no DOM, no React. Deterministic.
export function autoRouteJumpers(
  s: Schematic,
  board: BoardLayout,   // parts/dips/transistors/ports already placed, with hole positions
  holes: Hole[],
): Jumper[]
```

Algorithm:
- Build the per-net required-column set: for each schematic net (from `schematicExpectation(s)` /
  `computeNets`), collect the distinct board **columns/rails** that already carry a terminal of that net
  (part legs, DIP/TO-92 pins, and the fixed M2K terminal strips from F-5).
- For each net spanning ≥ 2 distinct groups, emit a **spanning tree** of jumpers (n−1 jumpers for n
  groups) tying those groups together. A net already common through one column needs no jumper.
- **Power/ground nets** route to the correct pre-wired rail (GND → a GND rail, V+ → top-inner, V− →
  bottom-inner) rather than star-wiring part-to-part, matching how a student actually powers the board.
- Readability heuristic (nice-to-have, not required for correctness): prefer short jumpers (nearest
  adjacent free column) so the result isn't a rats-nest. Correctness is defined by Check, not aesthetics.
- **Correctness contract:** `checkEquivalence(s, { ...board, jumpers: autoRouteJumpers(...) }, holes)`
  must return OK for every example that is manually solvable. This is the core test.

### 2. The setting (`boardRouting`) — the toggle-framework seed

- Add `boardRouting: 'manual' | 'hint' | 'auto'` (default `'manual'`) to a **single App-level settings
  object** (a new `uiSettings`/`featureToggles` object in `App.tsx`, sitting alongside the existing
  workspace/layout presets). This one object is the seed of the future feature-toggle framework — keep
  each toggle a named key with a default in one place, so the assignment layer later adds only a
  per-key default + `locked` flag. **Do not scatter booleans through components.**
- Persist it with the existing workspace/localStorage mechanism so a session remembers it.

### 3. UI (`Breadboard.tsx`)

- A three-way control (segmented control / select) for `boardRouting: Manual / Hint / Auto`.
- **Manual:** unchanged.
- **Hint:** a "Show a valid wiring" button that overlays `autoRouteJumpers(...)` in a ghosted style with
  the per-net annotations; it never writes to `board.jumpers`. The student's own Check is unaffected.
- **Auto:** render `autoRouteJumpers(...)` as read-only generated jumpers; suppress manual jumper
  drawing (or mark the generated set clearly non-editable); Check reflects the generated wiring.
- Keep the annotation copy short and net-focused (the teaching payload of `hint`).

---

## Out of scope / explicitly not changing

- **No instructor gating / per-assignment locking yet** — that is the later assignment-layer objective
  this seeds. Build only the student-facing three-state toggle now (the `locked`/assignment-default
  fields are a future phase, noted below).
- **Placement stays manual** — auto-routing never places or moves parts.
- **No change to `checkEquivalence`, `boardNets`, or the schematic→expectation logic** — the router is a
  new producer of `Jumper[]` that must satisfy the *existing* Check, not a change to it.
- No `core/signal.ts` change; no new dependency.

## Definition of Done

- `npm run build` clean; `npm test` green.
- New `core/breadboard.test.ts` cases: `autoRouteJumpers` produces a **Check-passing** jumper set for a
  spread of the built examples (a 2-pin passive net, an op-amp feedback net, a power/ground-to-rail net,
  and a DIP multi-pin case); a net already common needs no jumper; the result is deterministic.
- Live in Chrome: `Manual` unchanged; `Hint` reveals an annotated ghost wiring that does **not** alter
  the student's board or Check; `Auto` shows read-only generated jumpers and Check passes. Setting
  persists across reload.
- `boardRouting` lives as one named key in the App settings object (framework seed), default `manual`.
- No `core/signal.ts` change (canary intact). PROGRESS + ROADMAP (F-7 → DONE, and mark F-4b subsumed);
  one focused commit.

## Files: allowed / forbidden

**Allowed:** `src/core/breadboard.ts` (new `autoRouteJumpers` only — do NOT alter `boardNets` /
`checkEquivalence` behaviour), `src/core/breadboard.test.ts`, `src/components/Breadboard.tsx`,
`src/App.tsx` (the settings object + wiring the control), `docs/PROGRESS.md`, `docs/ROADMAP.md`, this
spec.

**Forbidden:** `core/signal.ts`; the `checkEquivalence` / `boardNets` / expectation semantics; the
schematic model. If the router seems to need any of those changed, stop and flag it in PROGRESS.

---

## Forward note — the toggle framework (future, do NOT build now)

The end state andre described: a teacher configures an assignment by turning features off. That layer is
**a saved preset of the settings object + a per-key `locked` flag** (and, under assessment, a hard lock
so a student can't re-enable a graded step). `boardRouting` is the first key; later keys (schematic
visibility, the Cf hint, measurement readouts, example-loading) join the same object. Keys may declare
dependencies (an "auto only" assignment presupposes the router exists). This connects directly to the
assessment-platform direction. Building `boardRouting` as one named key now is the down payment.
