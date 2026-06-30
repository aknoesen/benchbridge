# SPEC — Track J: Transimpedance amplifiers (photodiode front-end)

Read `docs/CONVENTIONS.md`, `CLAUDE.md` ("Things NOT to change without understanding the math"),
`docs/PROGRESS.md`, and `docs/specs/schematic-ngspice.md` first. This track builds **on top of** the
BPW 34 photodiode part (branch `photodiode-bpw34`, commit `9c32d17`). **TIA-1 depends on that branch
being merged to `main` first** — do not start until the photodiode part is on `main`.

Decisions **locked with andre (2026-06-30):** the transimpedance magnitude is plotted in **both dBΩ
and linear Ω** (TIA-2 offers a toggle, not dBΩ-only), and the **compensation helper (TIA-3) ships**
(a pure `core/tia.ts`, not deferred to a TIA-4).

---

## Why

A transimpedance amplifier (TIA) converts a photodiode's current into a voltage. The photodiode part
already gives the **DC** half: wire the photodiode anode into an op-amp's inverting (virtual-ground)
input, a feedback resistor Rf from output to that node, op-amp `+` to ground, and `.op` already
produces `Vout = −Iph·Rf` with the correct polarity (the existing `Iph` source sources current out of
the anode — see `netlist.ts` ~line 396). The op-amp kit (SCH-9, GBW/slew/clip macromodels), the kit
passives (SCH-10, the Rf/Cf values), and the schematic/breadboard wiring are all already in place, so
a student can build the topology today and read the DC transimpedance gain.

**What is missing is the frequency-domain behaviour, which is the whole point of TIA design:**

- bandwidth set by Rf and the total input capacitance (the photodiode junction `CJO = 72 pF` already
  in the `.model`, plus the op-amp input capacitance);
- the noise-gain peaking / stability problem from that Cin–Rf pole interacting with the op-amp GBW;
- the feedback capacitor Cf added to tame it (`Cf ≈ √(Cin / (2π·Rf·GBW))`), and the bandwidth/peaking
  trade it sets.

None of that is observable today, because the photocurrent is emitted **DC-only**
(`netlist.ts`: `Iph${c.id} … DC ${fmt(c.iphoto)}` — the comment even notes "DC only, so it leaves
.ac sweeps untouched"), and the Network Analyzer's Bode is hardwired to a **voltage** ratio
`V(node)/V('in')` (`NetworkAnalyzer.tsx` → `transferFunction(res, node, 'in')`). A TIA's transfer
function is `V(out)/I_in`, a transimpedance in ohms — there is no read path for it.

This track adds the smallest pieces that make TIA frequency response real: an AC photocurrent
stimulus, a transimpedance read in the Network Analyzer, and a guided example (plus an optional
compensation helper). Good fit for the EEC100 analog target.

---

## Phases

Each phase is one CC session, ordered so each builds on the last. Mirror the SIG-1 / SCH-10 pattern:
a pure, tested core change plus thin UI; do not touch the `Analysis` union structure, the ngspice
element/directive layer beyond the one source line below, or `core/signal.ts` (the 12-bit canary).

### TIA-0 — Add the TLV9062 op-amp model (the project's amp)

The summer TIA project uses the **TI TLV9062**, so the student needs it in the op-amp picker. It is a
dual low-voltage CMOS rail-to-rail-I/O part and slots straight into the SCH-9 level-1 macromodel — a
new catalog card in `core/opamps.ts`, no new model machinery.

Verified datasheet params (TI TLV9062, "TLV906xS 10 MHz RRIO CMOS"):

| param | value |
|---|---|
| GBW | 10 MHz |
| slew rate | 6.5 V/µs |
| supply (total) | **1.8 – 5.5 V** |
| rail-to-rail in / out | yes / yes |
| outputHeadroom | ≈ 0.02 V (RR) |
| Vos typ (display only) | ~0.3 mV (2 mV max) |
| Iq | ~0.55 mA/channel |
| channels / package | dual / SOIC-8 (no DIP) |

- **`core/opamps.ts`** — add a `tlv9062` `OpampKind` + `KIT_OPAMPS` card with the params above.
  `buildOpampSubckt` already produces a correct RRIO clamp from `railToRailOut`/`outputHeadroom`, so no
  emitter change. Update `opamps.test.ts` (catalog has the part with these params; `isKitOpamp` true).

**Three decisions for andre — resolve before building (each changes what gets built):**

1. **Off-kit identity.** The library principle is "ADALP2000-kit op-amps only" (SCH-9). The TLV9062 is
   **not** in that kit — it is a course-supplied part for this project. Either reuse the existing
   **"not in your parts kit"** badge path (simplest), or introduce a small **"course parts"** tier
   distinct from off-kit-legacy so a deliberately-provided part doesn't look like a mistake.
2. **Package / breadboard.** The TLV9062 has **no DIP** (SOIC-8). This is the exact reason F-4 pulled
   AD8542 from the library. Options: (a) add a **SOIC-to-DIP adapter** footprint on the breadboard so
   Check still works, or (b) ship it **sim + schematic only** with a "use a breakout adapter on the
   bench" note and skip the board Check for it. Pick one.
3. **Supply voltage — important.** Kit op-amps get **auto ±5 V rails** synthesised in sim
   (`netlist.ts`: `Vvcc … DC 5` / `Vvee … DC -5`). That is **10 V total, which exceeds the TLV9062's
   5.5 V absolute max.** The model would still "run" (the clamp just uses whatever rails it is given),
   but it would misrepresent a real over-voltage condition and an unrealistic output swing. The
   TLV9062 must default to a supply **within 5.5 V** — single **+5 V** (`vee = 0`) or **±2.5 V** — not
   the kit ±5 V. Decide the default and how the auto-rail synthesis is made part-aware (e.g. a
   per-part `supplyDefault` the netlist uses instead of the hardcoded ±5 V). This is the one real
   modelling change in TIA-0; everything else is a catalog card.

**DoD:** build clean; `npm test` green incl. the new catalog test; TLV9062 appears in the op-amp
picker; it simulates a known closed-loop gain with its chosen default supply, and (per decision 2)
either boards via an adapter or shows the sim-only note; existing 5 kit op-amps unchanged; no
`core/signal.ts` change. PROGRESS + ROADMAP (TIA-0 → DONE); one commit. TIA-0 is independent of the
photodiode branch and can land first.

### TIA-1 — AC photocurrent stimulus (the core unblock)

Give the photodiode's parallel photocurrent source an **AC magnitude** so an `.ac` sweep sees it as a
1 A stimulus, exactly as a `VSource` already emits `AC <acMag>` only under `.ac`.

- **`core/netlist.ts`**
  - `Diode` interface gains an optional `iphotoAc?: number` (AC magnitude, A). Default 1 A when
    omitted and the part has `iphoto`.
  - In the diode branch, change the photocurrent emission so it appends an AC term **only in `.ac`
    analysis** (mirror `vsourceSpec`): `Iph${c.id} <cathode> <anode> DC <i> AC <iphotoAc ?? 1>`.
    The `.op` / `.tran` lines stay byte-identical to today (DC term only) so the existing photodiode
    `.op` tests and polarity are unchanged. The source node order (cathode, anode) stays as-is so the
    AC current keeps the same polarity convention as the DC photocurrent.
  - Why AC mag = 1 A by default: with a 1 A stimulus, `V(out)` read by the Network Analyzer **equals
    the transimpedance in ohms** directly (Z = V/I, I = 1 A), which makes TIA-2 trivial.
- **`core/schematic.ts`** — `toCircuit` photodiode mapping: pass `iphotoAc: 1` through (or leave the
  default). No new schematic UI field in this phase; `value` stays the DC illumination knob.
- **Tests (`core/netlist.test.ts`)**: under `.ac`, the `Iph` line carries `AC 1`; under `.op`/`.tran`
  it does **not** (string assertions); and an end-to-end `.ac` run on a minimal TIA (photodiode →
  ideal op-amp → Rf) gives `|V(out)| ≈ Rf` at low frequency (transimpedance = Rf with a 1 A stimulus).

**DoD:** `npm run build` clean; `npm test` green incl. the new cases; **photodiode `.op` behaviour and
all existing tests unchanged**; no `core/signal.ts` change → 12-bit canary untouched. PROGRESS +
ROADMAP (TIA-1 → DONE); one focused commit.

### TIA-2 — Transimpedance read in the Network Analyzer

Let the Bode read a **transimpedance** `Z(f) = V(out)/I_in` instead of only `V(node)/V('in')`.

- The stimulus is the photocurrent (1 A AC from TIA-1), so the denominator is a current of magnitude
  1 A. In transimpedance mode the plotted magnitude is simply `20·log10|V(out)|` labelled **dBΩ**
  (decision for andre: also offer a linear-Ω axis). Phase is `∠V(out)` as today.
- **`core/`**: add a pure `transimpedance(res, node)` helper beside `transferFunction` (denominator =
  the injected current = 1, so it returns `V(node)` as the complex transfer with a dBΩ magnitude
  convention). Keep it pure and unit-tested; the existing voltage `transferFunction` is untouched.
- **`NetworkAnalyzer.tsx`**: a mode toggle **"Voltage gain (dB) / Transimpedance (dBΩ)"**. In
  transimpedance mode, axis title becomes "Transimpedance (dBΩ)", the −3 dB readout is measured off
  |Z| (the existing `BodeFeature` classifier works unchanged on the magnitude array), and the "vs W1
  input" caption is replaced with "vs photocurrent (1 A AC)". **Important:** in transimpedance mode
  there must be no competing AC voltage source — the example/circuit must omit the W1 `vsource` (or
  set its `acMag` to 0) so the photocurrent is the only AC stimulus. Call this out in the UI help text.
- **Tests**: a TIA `.ac` run in transimpedance mode → low-frequency |Z| ≈ Rf (dBΩ = 20·log10 Rf), and
  a single-pole roll-off above the Rf·Cf (or Rf·Cin) corner.

**DoD:** build clean; new core helper tested; live in Chrome: load the TIA example (TIA-3), switch to
transimpedance, see |Z| flat at Rf then roll off, −3 dB readout sensible; voltage-gain mode for all
existing examples unchanged. No `core/signal.ts` change. PROGRESS + ROADMAP (TIA-2 → DONE); one commit.

### TIA-3 — Guided TIA example + (optional) compensation helper

- **Example (`core/examples.ts`) — a single-supply TLV9062 TIA (the teaching centrepiece).** Because
  the TLV9062 maxes at 5.5 V it runs **single-supply** (+5 V, `vee = 0`), which is exactly the
  transition students find rocky. Build the example so it makes that concrete instead of hiding it:
  - Photodiode → **TLV9062** (from TIA-0) inverting input, **Rf** (kit value, e.g. 100 kΩ) feedback,
    optional **Cf** (kit value) in parallel; **1+ probe on the output**, **no W1 source** (so
    transimpedance mode works directly); default illumination at the 80 µA photodiode default.
  - **The `+` input goes to a reference Vref, NOT ground** — a kit resistor divider from +5 V sets a
    small Vref so the output has room to swing toward the positive rail. The virtual ground now sits at
    Vref, so the output **rests at Vref in the dark** and moves toward +5 V under light.
  - **Orient the photodiode so the photocurrent drives the output up from Vref into the 0–5 V range**
    (cathode/anode choice and Vref level interact — CC verifies the exact wiring in sim rather than
    trusting the diagram; the target is a DC operating point that stays inside the rails across the
    illumination range). Document `Vout = Vref ± Iph·Rf` and the −3 dB bandwidth in the blurb.
  - **The rocky points to surface** (blurb / Quickstart note): the dark-state output rests at **Vref,
    not 0 V**; there is **no negative swing**, so a wrong photodiode orientation pins the output at a
    rail and looks "dead"; Vref eats headroom, so `Rf·Iph_max` must fit between Vref and the rail; and
    the bench ±5 V must **not** be wired across the part (TIA-0 decision 3). A one-line
    single-supply-vs-split-supply contrast against the existing ±5 V OP484 inverting-amp example is the
    payoff.
- **Compensation helper (decision for andre: ship now or defer like SWEEP-1's staircase):** a pure,
  tested `core/tia.ts` — given `Cin` (photodiode `CJO` + op-amp input cap), `Rf`, and op-amp `gbwHz`
  (from `opamps.ts`), return the recommended `Cf ≈ √(Cin/(2π·Rf·GBW))`, the predicted closed-loop
  −3 dB bandwidth, and a peaking flag when Cf is absent/too small. Surface it as a read-only hint in
  the photodiode or op-amp inspector ("suggested Cf ≈ … for stable response"). If deferred, write it
  up as a TIA-4 note here and in ROADMAP rather than silently dropping it.

**DoD:** build clean; example loads single-supply and both scope (dark-state output ≈ Vref, swings
toward +5 V under light, stays in-rail) and transimpedance Bode look right in Chrome; if the helper ships, `core/tia.ts` unit tests cover the Cf formula and the peaking
flag against a worked example. No `core/signal.ts` change. PROGRESS + ROADMAP (TIA-3 → DONE); one commit.

---

## Out of scope / explicitly not changing

- The `Analysis` union and the ngspice directive/element **structure** stay untouched (same constraint
  as SIG-1 / SCH-10). The only netlist change is the AC term on the existing `Iph` source line.
- No `core/signal.ts` change anywhere in this track — the 12-bit ADC canary must read −104 dBFS
  throughout (it is independent of these circuit changes; confirm it as the standing invariant).
- No photodiode noise model (shot/Johnson), no temperature drift, no light-wavelength/responsivity
  modelling. Illumination stays a single photocurrent knob (the existing 80 nA/lx framing).
- No transient sinusoidal photocurrent drive (a `SIN(...)` on `Iph`) in this track — `.ac`
  transimpedance is the deliverable. A modulated-light transient view is a possible later add; note it
  rather than building it.

## Files: allowed / forbidden

**Allowed (across the three phases):** `src/core/netlist.ts` (the `Iph` AC term only — flag in
PROGRESS, like SWEEP-1 flagged `netlist.ts`), `src/core/schematic.ts` (photodiode mapping pass-through),
`src/core/netlist.test.ts`, the Network Analyzer transfer-function helper + `src/components/NetworkAnalyzer.tsx`,
`src/core/examples.ts`, `src/core/tia.ts` (+ test, if TIA-3 helper ships), the photodiode/op-amp
inspector component (hint only), `docs/PROGRESS.md`, `docs/ROADMAP.md`, this spec.

**Forbidden:** `core/signal.ts` (protected math + canary), the `Analysis` union structure, and the
op-amp/diode `.model` device fidelity (the macromodels are SCH-8/9 territory — TIA modelling reuses
them as-is). If a phase seems to need any of these, stop and flag it in PROGRESS.

---

## Sources / reference

- TIA stability & Cf: the classic photodiode-amplifier compensation result `Cf ≈ √(Cin/(2π·Rf·GBW))`
  (sets the feedback zero at the geometric mean of the noise-gain pole and the closed-loop bandwidth).
- BPW 34 datasheet params already encoded in `schematic.ts` (IS=1e-10, N=1, RS=10, BV=32, CJO=72 pF,
  80 µA at 1000 lx).
- Op-amp GBW values: `core/opamps.ts` (kit catalog).
