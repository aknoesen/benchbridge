# SPEC — Tester-feedback punch-list (Peggy Zhu review, 2026-06-30)

Source: Peggy Zhu's review of the deployed BenchBridge (`bridgem2k.onrender.com`), forwarded by andre.
Overall verdict was positive (intuitive, Quickstart clear, schematic→board transfer flow holds up); this
is a punch-list, not a redesign. **Sequencing (andre 2026-06-30): do this AFTER Track J (TIA-2 + TIA-3)
is complete.** Work the four buckets in priority order FB-1 → FB-4. None of this touches
`core/signal.ts` (the correctness bug is a UI-layer measurement-window issue, not the signal math), so
the 12-bit canary stays intact throughout. Each bucket can be its own commit.

---

## FB-1 — Correctness bugs (scope measurement) — **highest priority**

Two symptoms that look like one root cause: the oscilloscope's per-channel measurement window.

### (a) Vpp reads half (shows amplitude, not peak-to-peak)
- **Repro:** display a signal of amplitude 2 V (Vpp should be 4 V); the SCOPE Vpp field shows ~2 V.
- **Diagnosis (already traced):** `core/scope.ts` `measureTrace` is **correct** — `vpp = vmax − vmin`
  (scope.ts ~L150), verified. The display path `Oscilloscope.tsx` (~L243 / L280 / L358) calls
  `measureTrace(ch1src.x.subarray(startIdx, startIdx + winSamples), 1/Fs).vpp`. So the defect is in the
  **window fed to `measureTrace`** — `startIdx` / `winSamples` almost certainly span less than one full
  period for the tested timebase, so `vmax − vmin` misses the true extremes. Fix so the measured window
  covers **≥ 1 full cycle** (or the full captured record) for a stable peak-to-peak, on **both**
  channels. Do not change `measureTrace`'s math.

### (b) RC low-pass output Vpp > input Vpp on the SCOPE (while the Bode is correct)
- **Repro:** Quickstart → "Load RC low-pass → Network Analyzer →". NETWORK Bode is accurate; but on
  SCOPE the output reads ~3 Vpp while the input is ~2 Vpp. A passive RC low-pass output cannot exceed
  its input, so this is a credibility bug a student will spot.
- **Likely the same root cause as (a):** an inconsistent per-channel measurement window gives each
  channel a different fraction of a cycle. **Fix (a) first, then re-verify (b).** If it persists after
  (a), investigate the input channel's probe node (the AWG's 49.9 Ω series output impedance means the
  "input" node sits after that resistor) and the per-channel capture alignment. Document the resolution.
- **DoD:** for the RC low-pass example, scope input Vpp ≈ generator Vpp and **output Vpp ≤ input Vpp**;
  a plain sine of amplitude A reads Vpp = 2A on both channels across the timebase presets. Add a
  regression test where practical (a measure-window unit test in `scope.test.ts` asserting `vpp = 2A`
  for a sub-period vs multi-period window).

---

## FB-2 — Examples: ground 1− / 2− on single-ended examples

- **Feedback:** across the examples, `1−` and `2−` (the ADC negative inputs) aren't wired, which is
  confusing and unlike the real single-ended M2K setup (1−/2− → GND).
- **Nuance — do NOT blanket-apply to all 19.** Ground `1−`/`2−` only on the **single-ended** examples.
  The deliberately **differential** examples (e.g. the diode I-V that uses the 1−/2− probes to read a
  differential node, per CLAUDE.md) must keep their differential wiring. Audit `core/examples.ts`: for
  each single-ended example add an `adc1n` (and `adc2n` where CH2 is used) port tied to GND; leave the
  differential ones untouched.
- **DoD:** single-ended examples show `1−`/`2−` at GND and still load/scope/Check correctly; differential
  examples unchanged; no scope-reading regressions. Note in PROGRESS which examples were treated as
  differential and skipped.

---

## FB-3 — UI polish

- **"LOOP-1" leaks into the UI.** `SchematicEditor.tsx:933` — "Probe on the output. **LOOP-1** plots the
  result in the Network Analyzer." Replace the internal phase ID with plain user text (e.g. "The Network
  Analyzer plots the result."). Grep the components for any other user-facing `LOOP-/SCH-/OSC-` leaks
  while here (only fix strings actually rendered to users, not code comments).
- **Clear-canvas confirmation.** The Circuit tab "Clear" wipes the canvas with no confirm. Add a
  confirmation ("Clear the entire circuit?") before clearing. (Undo already exists, but a guard is
  cheap and expected.)
- **Check-error placement.** After BOARD → Check, error messages render center-screen and are hard to
  read on small monitors. Move them to a side/right panel (or a docked list) so they don't overlay the
  board. Keep the existing message content; this is placement/layout only.
- **DoD:** no internal IDs shown in the UI; Clear prompts before wiping; Check errors read in a side
  panel without covering the board. Build clean.

---

## FB-4 — Quickstart content

- **Three missing spaces:** rendered as "signaloutputs", "Bodeplot", "W2set" (should be "signal
  outputs", "Bode plot", "W2 set"). **Note:** the literal strings are **not** present in
  `Quickstart.tsx`, so these are almost certainly **JSX whitespace-adjacency** issues — a tag/line
  boundary between the two words is eating the space (e.g. `signal<…>outputs` across lines, or
  `{x}outputs`). Locate by the surrounding words and add an explicit space (`{' '}` or restructure), not
  by string-search. Re-check the rendered page.
- **Digital-twin clarity.** First-years may not know "digital twin" and could think the app talks to a
  physical M2K or replaces Scopy. Add one plain line early in Quickstart: it **simulates** the M2K's
  behaviour in the browser, it is **not** connected to physical hardware and **not** a Scopy replacement.
- **Signal-Generator + Oscilloscope flow gap.** At the "Next: Signal Generator + Oscilloscope" step the
  voltage divider is still loaded (no W1/W2 input), so the user must build their own circuit to proceed.
  Insert a step (above "Set a signal") that **loads an example with a W1/W2 input** (an existing example
  with a generator drive, or a minimal new one), matching the load-and-go pattern the other Quickstart
  steps use.
- **DoD:** the three spacings render correctly; the twin note is present; following the Quickstart
  Signal-Gen/Scope section works end-to-end without the user hand-building a circuit.

---

## Files: allowed / forbidden

**Allowed:** `src/components/Oscilloscope.tsx` + `src/core/scope.ts` **only for the measurement window**
(not `measureTrace`'s math) + `src/core/scope.test.ts` (FB-1); `src/core/examples.ts` (FB-2);
`src/components/SchematicEditor.tsx`, `src/components/Breadboard.tsx`, `src/App.tsx` as needed for the
FB-3 polish; `src/components/Quickstart.tsx` (+ `examples.ts` if a new demo example is needed) (FB-4);
`docs/PROGRESS.md`, `docs/ROADMAP.md` (if tracked there), this spec.

**Forbidden:** `core/signal.ts` and the protected FFT/window/noise math; `measureTrace`'s `vmax/vmin/vpp`
formulas (the bug is the window, not the formula); the `checkEquivalence`/`boardNets` semantics. If a fix
seems to need any of these, stop and flag it in PROGRESS.

---

## Not bugs — acknowledged positives (context)

Interface intuitive (esp. for Scopy users); Quickstart + M2K mapping clear for a first-timer; the
schematic → simulate → breadboard-Check flow holds up and reads like a PCB workflow. Keep these intact.
