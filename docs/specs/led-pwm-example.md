# SPEC — Example: PWM-driven LED (illustrates the ARB-2 board glow)

**Goal:** add one built-in example, `led-pwm`, that gives the ARB-2 "active board" LED glow a home in
the Examples menu. A student loads it, transfers it to the Breadboard, runs, and watches a real LED
light up; sweeping the W1 duty cycle dims/brightens it smoothly. Today the glow is only reachable if a
student happens to draw an LED + resistor by hand — this makes the marquee ARB-2 demo one click away.

Follows the existing examples pattern exactly: a schematic object + a `w1` generator preset, added to
`EXAMPLES` in `src/core/examples.ts`. No new mechanism, no core-math change.

---

## Why this circuit

The glow quantity is `ledBrightness(avgForwardCurrent)` (`core/partvisuals.ts`): invisible at ≤ 0.1 mA,
dim near 1 mA, full at 20 mA, **log-scaled** so a PWM duty sweep dims smoothly instead of snapping.
`core/boardsim.ts` derives the LED's time-averaged forward current from the existing `.tran` result
(no new analysis). So the example just needs a classic **W1 → current-limit R → LED → GND** loop
driven by a **square wave**, which is exactly the "driving an LED with PWM" lab in
`docs/private/LAB-LIBRARY.md` and the topology the ARB-2 end-to-end test already exercises
(0/5 V square through 470 Ω → ~3 mA average = half the on-current, at 50 % duty).

Numbers (red LED, Vf ≈ 1.8 V, R = 470 Ω, 0–5 V drive):
- On-state current ≈ (5 − 1.8) / 470 ≈ **6.8 mA** → clearly glowing.
- 50 % duty → time-average ≈ **3.4 mA** → mid glow. Sweep duty 10 %→90 % and the glow tracks it.
- Well inside the LED's rating and the M2K W1 ±5 V range.

---

## What to build

Add this entry to the `EXAMPLES` array in `src/core/examples.ts` (group `'Passive'` — it has no
op-amp, matching where `diode-iv`/`zener-iv` live). Coordinates below are a concrete starting point;
**verify the nets resolve and it simulates** (the example test suite will catch a mis-wire), and adjust
if the layout reads better.

```ts
{
  id: 'led-pwm', name: 'PWM-driven LED (breadboard glow)', group: 'Passive',
  blurb: 'A red LED and a 470 Ω current-limiting resistor driven by W1 as a 0–5 V square wave — the ' +
    'classic "dim an LED with PWM" demo. Load it, open the Breadboard, transfer the parts, and run: ' +
    'the LED lights up. Its brightness follows the TIME-AVERAGE forward current, so change the W1 duty ' +
    'cycle (Signal Generator) and the glow dims/brightens smoothly — perceived brightness is log-scaled, ' +
    'so 50 % duty is mid-glow, not half-off. CH1 shows the PWM drive square. The glow is a Breadboard-view ' +
    'feature (ARB-2): it reads the live sim current, so nothing lights until the parts are on the board and ' +
    'a valid circuit is simulating. Boards as a through-hole 5 mm LED + a 470 Ω resistor.',
  w1: { waveType: 'square', frequency: 1000, amplitude: 2.5, offset: 2.5, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
  ch1Vdiv: 1,
  schematic: {
    components: [
      { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },                        // W1 output = node 'in' at (2,4)
      { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 470 },         // a=(4,4) b=(6,4) — current limit
      { id: 'D1', kind: 'led', gx: 6, gy: 4, value: 1.8 },              // anode=(6,4)=R1.b  cathode=(8,4); Vf 1.8 → red
      { id: 'G1', kind: 'ground', gx: 8, gy: 6 },                       // LED cathode → GND
      { id: 'P1', kind: 'scope1', gx: 2, gy: 2 },                       // 1+ on the W1 node (see the PWM square)
      { id: 'A1', kind: 'adc1n', gx: 10, gy: 6 },                       // 1- to ground (single-ended CH1)
    ],
    wires: [
      { x1: 2, y1: 4, x2: 4, y2: 4 },   // W1 → R1.a  (R1.b at (6,4) is coincident with D1 anode → connected)
      { x1: 8, y1: 4, x2: 8, y2: 6 },   // D1 cathode → ground
      { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input → 1+
      { x1: 8, y1: 6, x2: 10, y2: 6 },  // ground → 1-
    ],
  },
},
```

Notes for the implementer:
- `amplitude: 2.5, offset: 2.5` gives a 0–5 V square under the repo's convention (amplitude = peak, so
  the swing is `offset ± amplitude`; cross-check against the `integrator` example, whose `amplitude: 2`
  is documented as "4 Vpp"). If the convention differs, adjust to land a clean 0–5 V drive.
- LED terminal names are anode `a` / cathode `c` (`baseTerminals` in `schematic.ts`). Current must flow
  W1 → R → **anode → cathode** → GND. Confirm the orientation so the LED is forward-biased (a reversed
  LED simulates fine but never glows — good gotcha to avoid in the shipped example).
- `value: 1.8` puts the lens in the red band of `ledColor` (`< 2.0 → #ff4433`). Pick a different Vf if
  you'd rather ship green/amber/blue.

---

## Optional stretch (only if andre asks) — glow on load

Every example is schematic-only; the student must transfer parts to the Breadboard to see the glow.
If we want this example to land **already placed** on the board so it glows immediately, that needs a
new optional `board?: Board` preset field on `Example` and load-time wiring in `App.tsx` — a real
feature, not a one-line example. Leave it out of this phase; note it in PROGRESS as a follow-up idea.

---

## Acceptance criteria (Definition of Done)

1. `led-pwm` appears in the Examples menu under **Passive** and loads without error.
2. Loading it applies the square-wave W1 preset; **CH1 shows a 0–5 V PWM square** on the scope.
3. Transferring the LED + resistor to the Breadboard and running the sim makes the **LED glow**, and
   changing the **W1 duty cycle visibly dims/brightens** it (higher duty → brighter). Reversing the LED
   → no glow.
4. The example passes the existing `examples.test.ts` sweep automatically: nets resolve with no
   "not connected" warning, `probes.ch1` is defined, CH1 is single-ended (`ch1n === '0'`), and a W1
   node is probed by a scope channel (`probes.ch1 === 'in'`). Add a small dedicated test if useful
   (e.g. assert an `led` component exists and a `.tran`/`.op` gives a forward-biased LED with
   `avg current` in the glowing range), mirroring the `TIA-3 photodiode example` block.
5. `npm run build` clean; `npm test` green.
6. **12-bit canary unaffected** — this touches no signal path, but confirm the canary test stays green
   (an example addition must not perturb `core/signal.ts` or the FFT/window/noise math).

---

## Files: allowed / forbidden

**Allowed:** `src/core/examples.ts` (the new entry), `src/core/examples.test.ts` (optional dedicated
test), `docs/PROGRESS.md`, `docs/ROADMAP.md` (if a row tracks this).
**Forbidden:** `core/signal.ts` and the protected FFT/window/noise math; `checkEquivalence`/`boardNets`
semantics; the ARB-2 glow logic in `core/boardsim.ts`/`core/partvisuals.ts` (this example *uses* it,
does not change it). If the example seems to need any of these, stop and flag in PROGRESS.

---

## Verification checklist for CC

- [ ] `npx vitest run src/core/examples.test.ts` — new example passes the FB-2 sweep.
- [ ] `npm run dev` → load **PWM-driven LED**, confirm CH1 PWM square, transfer to board, run, LED
      glows; sweep W1 duty 10 %→90 % and confirm smooth dimming; reverse LED → dark.
- [ ] `npm run build` && `npm test` green, incl. the 12-bit canary.
- [ ] Update `docs/PROGRESS.md`; append the commit hash to `docs/private/AGENT-HANDOFF.md`.
