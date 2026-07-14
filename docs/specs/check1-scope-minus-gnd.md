# CHECK-1 — Board Check must not flag an explicit scope-−→GND wire as an error

**Goal:** the board **Check** currently reports a *false failure* on a correctly-built single-ended measurement. On the RC low-pass example, the scope CH2 minus (`1−`) is wired to `GND` in the schematic, and the breadboard connects them too — schematic and board **agree** — yet Check says:

> ✗ Check — GND and 1- are different nodes, but your board connects them.

This is wrong. Per the settled M2K instrument model, a scope minus **explicitly wired to GND is the correct, required way to express a single-ended measurement** (`docs/reference/m2k-instrument-model.md`, COMPLETENESS COROLLARY). Tying `1−` to `GND` is not a short — it *is* the circuit. Check must treat `1−` and `GND` as the same node here and pass, while still catching genuine board/schematic mismatches.

Sits directly on **INST-1** / the instrument-model decision record. Same governing principle: *schematic follows the designer → board follows the schematic*. Check compares the two; it must use the **same net model** on both sides.

---

## Design decisions (locked with André)

1. **An explicit `scope−` → `GND` wire makes `1−` and `GND` the same net — on both the schematic side and the board side of Check.** A connection that is present in *both* the schematic and the board is, by definition, correct and must never be reported as an error.
2. **This is the single-ended case, and it is explicit, not inferred.** The fix does **not** re-introduce any auto-grounding of the minus (that was rejected in the instrument-model record — commit `a752c72` REJECTED, `toCircuit` `else`-branch REJECTED). We are honoring a wire the *student drew*, not inventing one.
3. **Floating-minus detection stays.** An **unwired** `1−`/`2−` must still be flagged as incomplete/floating (per the completeness corollary). CHECK-1 only stops flagging the case where the minus is *explicitly* tied to GND. Wired-to-GND ⇒ single-ended (OK); wired-to-a-node ⇒ differential (OK); unwired ⇒ still flagged.
4. **Symmetric comparison.** Check reports a real problem only when the schematic net-partition and the board net-partition genuinely disagree (a node connected on one side but not the other). Two terminals that land in the same equivalence class on both sides are never a finding, regardless of which named net (`GND`, `1−`, `2−`, `W1`, …) they carry.

---

## Root-cause hypothesis (for CC to confirm in the repo)

The Check message "GND and 1- are **different nodes**, but your board connects them" reveals that **the schematic-side net model used by Check kept `1−` separate from `GND`** even though the schematic has an explicit `1− → GND` wire. So when the board correctly ties them, the comparator sees the board merging two nets its schematic model held apart, and reports a spurious extra-connection.

Two candidate causes — CC should determine which (or both) applies:

- **(a) The Check comparator does not run the same net-extraction / union-find as `toCircuit`.** If Check builds its "expected" nets from a path that doesn't fold explicit wires into net 0 (GND) the way `toCircuit` does, an explicit `1−→GND` wire won't collapse `1−` into the GND net. Fix: derive **both** the schematic partition and the board partition through the *same* union-find that treats a wire to a GND terminal as membership in net 0, then compare partitions as equivalence classes.
- **(b) The comparator special-cases instrument reference terminals** (`1−`,`2−`, and/or the fixed instrument grounds) as "must stay distinct from GND," i.e. it has a rule that forbids merging a minus with ground. That rule is wrong for the *explicit* single-ended case and must be removed/narrowed so an explicitly-wired minus merges normally, while an *unwired* minus is still reported by the floating-terminal check (a separate rule).

The correct mental model: Check is a **net-partition equivalence test**, not a comparison against a hardcoded expectation that `1− ≠ GND`. Build net partitions on both sides with the one shared union-find; a difference exists only when some pair of terminals is same-net on one side and different-net on the other.

---

## What to build

1. **Single net model for Check.** Route the schematic side of Check through the same net-extraction used to build the simulation circuit (the `toCircuit` union-find), so an explicit `1−→GND` (or any explicit wire to a GND terminal) collapses into net 0 identically for *both* simulation and Check. No second, divergent notion of "the nets."
2. **Compare partitions, not names.** The board↔schematic comparison should be: for every pair of terminals, are they in the same equivalence class on the schematic and on the board? Report only genuine disagreements (connected on one side, separated on the other). Same-on-both — including `1−`≡`GND` — is silent.
3. **Preserve floating detection.** Keep the existing "unwired instrument minus is incomplete/floating" flag exactly as-is. Confirm it is a *distinct* rule from the net-equivalence comparison, so narrowing (b) does not weaken it.
4. **Keep the diagnostic quality.** Genuine mismatches must still produce their clear message (e.g. a node the schematic separates but the board shorts, or vice-versa). Only the false positive on explicit `1−≡GND` (and the symmetric `2−≡GND`) disappears.

No changes to `signal.ts` / FFT / the `Analysis` union / ngspice directives — this is editor/board-check logic only.

---

## Out of scope / explicitly not changing

- **No re-introduction of scope-minus auto-grounding** in drawing or in `toCircuit`. INST-1 rejected that; CHECK-1 does not touch it. We only honor an explicit, student-drawn wire.
- **No change to floating-terminal detection** other than confirming it stays independent and intact.
- **No change to the differential case** (`1−` wired to a real node): already correct, must stay correct.
- **No signal-path / simulation changes.** 12-bit canary must be untouched.

---

## Definition of Done

- `npm run build` clean (tsc + Vite); `npm test` green.
- **New/updated test on the exact reported case:** the RC low-pass with scope CH2 single-ended (`W1 → R1 → C1`, output to scope CH2, `2−`/`1−` **explicitly** wired to `GND`) — matching the failing screenshot — runs **Check with NO error**. (Use the actual instrument/channel the screenshot uses; the point is scope-minus-wired-to-GND.)
- **Regression tests that Check still catches real problems:** (i) an instrument minus wired to the *wrong* node vs the board; (ii) a board that shorts two nodes the schematic keeps separate; (iii) an **unwired** minus is still flagged as floating/incomplete (completeness corollary intact).
- Symmetric coverage: the same pass/behavior for `2−≡GND` as for `1−≡GND`.
- Live app verified in Chrome: rebuild the screenshot circuit, press **Check**, get a pass (green), not the "GND and 1- are different nodes" error. Break one board wire and confirm Check *does* report it.
- 12-bit canary unaffected (`signal.ts`/FFT untouched — spectrum floor ≈ −104 dBFS unchanged).
- PROGRESS.md + ROADMAP.md updated (CHECK-1 → DONE); one focused commit routed through Claude Code (sandbox git is unreliable — do not commit from the sandbox).

## Suggested allowed-files list

The board/breadboard **Check** comparator module (the net-equivalence logic that emits the "different nodes … board connects them" message), the shared net-extraction/union-find used by `toCircuit` (read/reuse — do not fork), the floating-terminal check (confirm-only, likely no edit), the relevant test file(s), `PROGRESS.md`, `ROADMAP.md`. Anything beyond this set gets flagged in PROGRESS with a reason. **CC to confirm exact paths** — memory names `toCircuit` as the sim-side net builder; the Check comparator's file is to be located in the repo.

---

## Why this matters (pedagogy + trust)

The board Check is a teaching signal: a student trusts it to tell them whether their breadboard matches their design. A **false failure on a correctly-built single-ended scope** teaches the wrong lesson — it tells a student who did everything right that they made a mistake, and it undermines confidence in every subsequent Check. Single-ended measurement (scope minus to ground) is the most common thing a student will build; Check has to get it right.
