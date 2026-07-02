# SPEC — Example: AC / time-domain transimpedance amp (current in → voltage out)

**Goal:** add a second TIA example, `tia-ac`, that is **excited in the time domain** so the scope shows
a live modulated output — the complement to the existing `tia-photodiode`, which is a DC-operating-point
demo (its only AC story is the Network Analyzer's `.ac` transimpedance sweep). A student loads it, runs,
and sees a clean amplified waveform on CH1, with the injected "photocurrent" set by W1.

Ships as **just an example** in `src/core/examples.ts` — a schematic object + a `w1` sine preset.
**No model change, no `core/signal.ts`, no netlist change.** (Approach chosen by andre 2026-07-01: emulate
the modulated photocurrent with W1 through a series resistor, rather than adding a time-varying photocurrent
source to the photodiode model.)

---

## The idea — emulate a modulated photocurrent with W1 + a series R

A photodiode's small-signal output is a **current**. Rather than modulate the photodiode's `iphoto`
(which is a fixed DC source in `.tran` — only its `iphotoAc` term appears under `.ac`), we inject a known
modulated current into the op-amp's **virtual-ground summing node** with W1 through a series resistor
`Rin`:

```
   I_in  ≈  V_W1 / Rin           (the − input is a virtual ground at 0 V on the ±5 V OP484)
   V_out = − I_in · Rf  =  − (Rf / Rin) · V_W1
```

So the current through `Rin` is exactly what a photodiode would deliver, and the amp converts it to a
voltage with **transimpedance Rf (ohms)**. In the time domain the scope shows `I_in → V_out` live; crank
W1's frequency toward the `Cf·Rf` corner and the output rolls off (the same bandwidth the Network Analyzer
shows). This is the standard bench way to test a TIA — drive a known current source into the input.

Honesty note for the blurb: this is an **emulated** modulated photocurrent (W1 + Rin), not the photodiode
device itself. It pairs with `tia-photodiode` (the real device, DC/illumination + `.ac` Bode).

---

## Verified behaviour (simulated in-repo before speccing)

With the schematic below driven by a 0.2 V, 1 kHz sine on W1, a real ngspice `.tran` gives:

- `probes = { ch1: 'out', ch1n: '0', ch2: 'in', ch2n: '0' }`, no "not connected" warnings.
- **V_out = ±1.99 V sine, centred on 0 V, not railed** (range −1.986 … +1.986 V).
- **Gain = 9.98 ≈ Rf/Rin = 100 k / 10 k = 10** → transimpedance Rf = 100 kΩ turns the 20 µA injected
  current amplitude (0.2 V / 10 kΩ) into a 2 V output amplitude. Matches theory.

So the values below are known-good; CC should still re-verify on the host per DoD.

---

## What to build

Add to the `EXAMPLES` array in `src/core/examples.ts`, group `'Amplifiers'` (next to `tia-photodiode`).

```ts
{
  id: 'tia-ac', name: 'Transimpedance amp — AC (current → voltage, OP484)', group: 'Amplifiers',
  blurb: 'A transimpedance amplifier excited in the TIME DOMAIN — the AC complement to the ' +
    '"Photodiode TIA" example (which is a DC operating point + Network-Analyzer Bode). A photodiode’s ' +
    'signal is a current, so here W1 through a 10 k resistor (Rin) injects a known modulated current ' +
    'I ≈ V_W1 / Rin into the op-amp’s virtual-ground summing node — an EMULATED modulated ' +
    'photocurrent. The kit OP484 (rail-to-rail, auto ±5 V) converts it to a voltage: ' +
    'V_out = −(Rf/Rin)·V_W1, i.e. transimpedance Rf = 100 kΩ. With the default 0.2 V 1 kHz ' +
    'sine, CH1 (out) is a clean inverted ±2 V sine and CH2 shows the drive. Raise W1’s frequency ' +
    'toward the Cf·Rf corner (≈ 16 kHz, Cf 100 pF) and the output rolls off; open the Network ' +
    'Analyzer to see the same −20 dB/decade band-limit. Boards as an OP484 DIP.',
  w1: { waveType: 'sine', frequency: 1000, amplitude: 0.2, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
  ch1Vdiv: 1, ch2Vdiv: 0.1,
  schematic: {
    components: [
      { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
      { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },     // W1 -> summing node: I = V_W1/Rin (emulated photocurrent)
      { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'op484' },        // inP(10,4) inN(10,6) out(14,5)
      { id: 'Cf', kind: 'capacitor', gx: 10, gy: 8, value: 100e-12 },   // feedback cap: sets ~16 kHz bandwidth
      { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 100000 },    // feedback R = transimpedance (100 kΩ)
      { id: 'G1', kind: 'ground', gx: 8, gy: 4 },                       // inP -> ground (virtual ground = 0 V)
      { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },                      // 1+ on out
      { id: 'P2', kind: 'scope2', gx: 2, gy: 8 },                       // 2+ on the W1 drive
      { id: 'A1', kind: 'adc1n', gx: 6, gy: 4 },                        // 1- to ground (single-ended CH1)
      { id: 'A2', kind: 'adc2n', gx: 6, gy: 2 },                        // 2- to ground (single-ended CH2)
    ],
    wires: [
      { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Rin.a
      { x1: 2, y1: 6, x2: 2, y2: 8 },    // input -> 2+
      { x1: 6, y1: 6, x2: 10, y2: 6 },   // Rin.b -> inN (summing node)
      { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
      { x1: 10, y1: 6, x2: 10, y2: 8 },  // inN -> Cf.a
      { x1: 10, y1: 8, x2: 10, y2: 10 }, // Cf.a -> Rf.a (parallel feedback, summing-node side)
      { x1: 14, y1: 5, x2: 14, y2: 8 },  // out -> down
      { x1: 14, y1: 8, x2: 12, y2: 8 },  // -> Cf.b (out side)
      { x1: 12, y1: 8, x2: 12, y2: 10 }, // Cf.b -> Rf.b
      { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
      { x1: 6, y1: 4, x2: 8, y2: 4 },    // 1- -> ground (inP node)
      { x1: 6, y1: 2, x2: 6, y2: 4 },    // 2- -> ground
    ],
  },
},
```

This is structurally the inverting-amp skeleton + a feedback `Cf`, reframed as a current-input TIA — the
values (Rin 10 k, Rf 100 k, Cf 100 p, 0.2 V drive) are what make the transimpedance framing and the clean
±2 V trace work, and are the ones simulated above.

---

## Acceptance criteria (Definition of Done)

1. `tia-ac` appears under **Amplifiers** and loads without error; the sine W1 preset applies.
2. On the scope: **CH1 = a clean inverted ±2 V sine** (gain ≈ 10 = Rf/Rin), **CH2 = the 0.2 V drive**,
   output centred on 0 V and not railed.
3. Raising W1 toward ~16 kHz visibly attenuates CH1 (Cf·Rf band-limit); the Network Analyzer shows the
   matching −20 dB/decade roll-off.
4. Passes the existing `examples.test.ts` sweep automatically: nets resolve (no "not connected"),
   `probes.ch1` defined, CH1 single-ended (`ch1n === '0'`), and a W1 node is probed by a scope channel.
   Optionally add a dedicated `.tran` test asserting `Vout` amplitude ∈ [1.6, 2.4] V and gain ≈ 10
   (mirrors the `TIA-3 photodiode example` block; the throwaway test used to verify this is reproduced in
   this spec's "Verified behaviour" section).
5. `npm run build` clean; `npm test` green; **12-bit canary confirmed unaffected** (no signal-path change).

---

## Files: allowed / forbidden

**Allowed:** `src/core/examples.ts` (new entry), `src/core/examples.test.ts` (optional dedicated test),
`docs/PROGRESS.md`, `docs/ROADMAP.md` (if tracked).
**Forbidden:** `core/signal.ts` and the protected FFT/window/noise math; the photodiode/netlist model
(`core/netlist.ts`, `core/schematic.ts`) — this example deliberately needs none of it. If it seems to,
stop and flag in PROGRESS (that would mean we drifted toward the "time-varying photocurrent" approach,
which andre deferred).

## Verification checklist for CC

- [ ] `npx vitest run src/core/examples.test.ts` — new example passes the FB-2 sweep.
- [ ] `npm run dev` → load **Transimpedance amp — AC**, confirm ±2 V inverted sine on CH1, 0.2 V on CH2;
      raise W1 frequency and watch CH1 roll off; Network Analyzer shows the band-limit.
- [ ] `npm run build` && `npm test` green, incl. the 12-bit canary.
- [ ] Update `docs/PROGRESS.md`; append the commit hash to `docs/private/AGENT-HANDOFF.md`.
