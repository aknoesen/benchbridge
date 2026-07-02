# SPEC — ARB-2b: Drag to reposition a placed breadboard part

Read `docs/CONVENTIONS.md` and `docs/specs/breadboard.md` first. **Board / UI only — no `core/signal.ts`,
no `checkEquivalence`/`boardNets` *behaviour* change** (12-bit canary untouched). Sequenced **after
ARB-2 commits.** Small, self-contained interaction win.

## Problem
Repositioning a placed part on the breadboard today means **delete → re-place → re-jumper**. There is
no way to nudge a part that landed in an awkward spot. Placement already exists (`placePart` in
`Breadboard.tsx`, click-to-set holes); this phase adds *move* on top of it.

## Decision locked (andre, 2026-07-02 — supersedes the earlier 2026-07-01 "leave jumpers" call)
**On move, REMOVE the part's associated jumpers.** No jumper-follow / rubber-band logic. On a committed
drop we relocate the part's legs AND delete every jumper whose endpoint sat on the part's OLD holes, so
the move leaves no dangling or mismatched wires and the student re-wires the moved part from a clean
slate. (This overrides any "leave `board.jumpers` untouched" / "Check reports a mismatch until re-run"
language elsewhere in this doc — treat those as: delete the old-hole jumpers on a committed move.)
Jumpers that do NOT touch the moved part are unaffected.

**Staging (andre, 2026-07-02):** ship this MOVE interaction FIRST (stage 1) so we can see it in action.
Drag-to-place from the chip tray, drag-to-swap/replace, and a routing-quality metric (jumper length /
crossing count, to teach placement-drives-routing) are LATER stages — see `docs/specs/board-drag.md`.

## Scope
All placed part classes, reusing each one's existing placement geometry/validation:
- **2-pin parts** (resistor, capacitor, diode/LED/Zener/photodiode): `{aHole, bHole}`.
- **DIP ICs** (op-amp single/quad, INA125): straddle the center channel per `DIP_DEFS`.
- **TO-92 transistors**: three adjacent columns on a term row (`to92PinHoles`, row-aware).

## Interaction
1. In the board's Select/Practice interaction, **pointer-down on a placed part body starts a move
   drag** (distinguish from a click; a click still selects/inspects as today). Show a ghost/preview of
   the part following the cursor, snapped to the nearest valid hole set.
2. **On drop, snap and validate** against the *same* rules placement uses:
   - 2-pin: preserve the part's leg-span vector (a→b); translate both legs; enforce
     `MIN_RESISTOR_HOLES` (and any existing per-kind span floor). Reject a drop that violates the floor
     with the existing "too tight" style message.
   - DIP: keep the pin block; require it to straddle the channel with all pins on free holes.
   - TO-92: keep the 3-adjacent-column leg pattern on a valid term row.
   - **Occupied holes:** reject a drop where any target hole is already taken by another part's leg
     (snap back to the original position with a short message). Jumper endpoints do **not** block.
3. **On a valid drop:** update the part's `aHole`/`bHole` (or DIP anchor / TO-92 anchor) in `board`
   state via `setBoard`, take an undo `snapshot` first, and **leave `board.jumpers` untouched**.
4. **Re-run Check** (or let the existing live Practice colouring / Check surface the now-broken nets).
   No connectivity is auto-repaired — that's the locked decision.

## Model / helpers
- Reuse `pos(hole)` for hit-testing and ghost placement, and the existing hole grid (`holes`).
- Factor the leg-snap + validity test out of `placePart` into a **pure helper** so move and place share
  one validator (e.g. `snapPartToHoles(part, targetHole, holes) → {aHole,bHole}|null` and the DIP/TO-92
  equivalents). Put pure geometry in `core/breadboard.ts`; keep pointer handling in `Breadboard.tsx`.
- **Do not change** `checkEquivalence` / `boardNets` semantics; move only edits `board.parts` positions.

## Files
**Allowed:** `src/components/Breadboard.tsx` (drag handlers + ghost render), `src/core/breadboard.ts`
(pure snap/validate helpers shared with placement), tests, `docs/*`.
**Forbidden:** `core/signal.ts`; the protected FFT/window/noise math; changing
`checkEquivalence`/`boardNets` behaviour.

## Definition of Done
- A placed 2-pin part, a DIP, and a TO-92 can each be **dragged to a new valid location**; illegal drops
  (too-tight span, bad straddle, occupied hole, off-grid) snap back with a clear message.
- Existing jumpers are unchanged by a move; a move that orphans a jumper makes **Check report the
  mismatch** (and Practice colouring reflects the broken net); re-running the jumper fixes it.
- Move is undoable (one `snapshot` per drag).
- `npm run build` clean; tests cover the pure snap/validate helper (valid move, too-tight reject,
  occupied-hole reject); **12-bit canary confirmed −104 dBFS** (no signal path touched).

## Sequencing / canary
After ARB-2 (active board) commits. None of this touches `core/signal.ts`; confirm the no-circuit
12-bit floor stays −104 dBFS.
