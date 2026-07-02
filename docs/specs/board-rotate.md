# SPEC — ARB-5b: Rotate a placed breadboard part

Read `docs/CONVENTIONS.md`, `docs/specs/board-part-move.md` (ARB-2b move — this reuses its snap/validate
+ jumper-removal helpers), and `docs/PROGRESS.md` first. **Board / UI only — no `core/signal.ts`; no change
to `checkEquivalence` / `boardNets` / geometry behaviour.** Drag-to-move shipped and works; rotation was
explicitly deferred there — this is that follow-on. andre asked for it directly (2026-07-02).

## Interaction
- With a placed part **selected/hovered** (Select tool), pressing **`R`** rotates it — mirroring the
  Schematic editor's "Rotate this part (R)". Optionally also a small rotate affordance in the selection UI.
- Rotation reuses the move pipeline: recompute the part's hole set for the new orientation, **snap +
  validate against the same rules as move** (on-board, free holes ignoring the part's own old holes,
  `MIN_RESISTOR_HOLES` span floor, DIP straddles the channel). **Invalid rotation → reject + snap back**
  with the existing "won't fit" style message.
- **Remove associated jumpers on a committed rotate**, same locked rule as move (andre 2026-07-02): a
  rotate changes which holes the legs occupy, so jumpers on the old holes are dropped; the student re-wires.
  Reuse the ARB-2b jumper-cleanup helper.
- **One undo `snapshot` per rotate.**

## Semantics per part class
- **2-pin parts** (resistor, cap, diode/LED/zener/photodiode): rotate the leg-span vector in **90°
  increments** around the part's anchor leg (so a resistor along a row can "stand up" across rows / the
  channel, and vice-versa, where geometry allows). For **polarized** parts (diode/LED/zener, electrolytic)
  the flip is **electrically meaningful** — it reverses anode/cathode orientation, and **Check must reflect
  it** (the leg→net mapping changes). For symmetric parts it's cosmetic but still useful for tidy layout.
- **DIP ICs** (op-amp single/quad, INA125): **180° rotation** flips the pin-1 end (chip turned end-for-end),
  re-mapping `pinNets` to the mirrored holes; it stays straddling the channel. (90° is not meaningful for a
  channel-straddling DIP — 180° only.)
- **TO-92 transistors**: rotate the 3-leg order/orientation among the valid arrangements on the term row.

## Model / helpers
- Add a **pure `rotatePartOnBoard(board, id, holes)` helper in `core/breadboard.ts`** (additive) that
  returns the part re-oriented to the next valid orientation (or `null` if none fits), reusing the ARB-2b
  snap/validate + `to92PinHoles` / `dipPinHoles` geometry. Keep pointer/key handling in `Breadboard.tsx`.
- **Do not change** `checkEquivalence` / `boardNets` / geometry — rotation only edits a placed part's holes
  (and, for polarized/DIP parts, which net each leg lands on, via placement, exactly as move does).

## Out of scope
- No `core/signal.ts`; no new dependency. No auto-re-route of jumpers (they're removed, per the locked rule).

## Definition of Done
- Select a resistor, a diode, and a DIP; `R` rotates each to the next valid orientation; a diode's reversed
  orientation changes the leg→net mapping and **Check reflects it**; an impossible rotation snaps back with a
  message; associated jumpers are removed on a committed rotate; each rotate is one undo.
- `npm run build` clean; a `core/breadboard.test.ts` case on `rotatePartOnBoard` (valid rotate, no-fit
  reject, polarized-part net swap, determinism). No `core/signal.ts`; 12-bit canary −104 dBFS.
- ROADMAP (ARB-5b → DONE) + PROGRESS note.

## Files
**Allowed:** `src/components/Breadboard.tsx`, `src/core/breadboard.ts` (pure rotate helper only),
`src/core/breadboard.test.ts`, `docs/*`. **Forbidden:** `core/signal.ts`; `checkEquivalence` / `boardNets`
/ geometry semantics; `core/schematic.ts`.
