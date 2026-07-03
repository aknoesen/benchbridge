# Quickstart — finished copy (QS-4)

_The polished, page-by-page text for CC to drop into the paginated Quickstart, replacing the reused QS-1/QS-2
content. **Course-neutral** (no course/lab names). **One action per page.** **Every instrument step is a
do-this / watch-that loop** — no passive "go look." **Simulation-honest, neutral voice.** Button labels in
`[brackets]` are the load-example / open-instrument actions; `[← Back to the tour]` is the return-pulse._

---

## Page 1 — Welcome (orientation)
**BenchBridge is a real electronics bench — simulated.**
Design a circuit, measure it on a full set of instruments, build it on a breadboard, and check your wiring,
all in your browser, nothing to install. It runs a fast, faithful simulation (real SPICE under the hood), so
what you learn here transfers straight to the hardware. A place to design, learn, and prepare — not a
replacement for the bench.
`[Take the 5-minute tour →]`   `[Jump to an instrument →]`
*(visual: signal flow — the sources (W1/W2, supply) drive your circuit; the scope and meter read it back.)*

## Page 2 — The bench at a glance
Every panel here mirrors a real instrument:
*(instrument-map table — Signal Generator (W1/W2) · Oscilloscope · Spectrum · Network analyzer · Voltmeter ·
Power supply · Breadboard, each with an `Open`.)*
Signals flow one way: the **sources** drive your circuit, the **scope and meter** read it back. You wire your
circuit in between. Ready? `[Start the tour →]`

## Page 3 — Build a flashlight  *(~2 min)*
The simplest useful circuit: the **power supply**, a resistor, an LED — steady DC.
`[Load the flashlight →]`  → opens the **Breadboard**, already built, with the **LED lit** on the real board.
**Now make it a measurement, not just a light.** How bright *is* really how much **current** — but the bench
never hands you current directly, only **voltages**. **Try it: hover around the board** and watch each node's
voltage pop up, like touching a DMM probe there. Current you can't probe — so to get the resistor's drop
precisely, use the Voltmeter.
- **Read the resistor's voltage on the Voltmeter.** `[Open the Voltmeter →]` — **CH1 is already wired across
  the resistor**; read the drop (about **3 V**). (Both of CH1's leads sit on live nodes, neither at ground —
  that's a *differential* measurement, and the Voltmeter does it for you. Single- vs differential is next page.)
- **Calculate the current.** Ohm's law: **I = V / R ≈ 3 V / 470 Ω ≈ 6 mA**. **That current is what lights the
  LED.** You've tied a glowing LED to a number you read and computed.
`[← Back to the tour]`
*(It's steady DC — no signal generator, and the scope would just show a flat line, so we use the Voltmeter.
Live "turn it down and watch it dim" is the animated-glow enhancer GLOW-1 — post-beta.)*

## Page 4 — The voltage divider  *(~2 min)*
Two equal resistors split the supply in half.
`[Load the divider →]`  → V+ reads **5 V**, the midpoint reads **2.5 V**.
**Why 2.5 V?** Equal resistors share the 5 V equally — each drops 2.5 V, so the midpoint sits exactly halfway.
**The same 2.5 V, measured two ways** — your first real look at single-ended vs differential:
- **CH1 across the top resistor (differential):** probes on V+ and the midpoint → 5 − 2.5 = **2.5 V**. Neither
  probe at ground.
- **CH2 across the bottom resistor (single-ended):** probe on the midpoint, reference to GND → **2.5 V**. One
  end at ground.
Same number, two styles. **Differential** reads the drop across a floating part; **single-ended** reads a node
against ground. `[Open the Voltmeter →]`   `[← Back to the tour]`

## Page 5 — Make a signal, see it in frequency  *(~2 min)*
`[Load a signal →]`  → a clean sine on the scope, one trace. (The signal is already live — the Signal
Generator's button just toggles Stop/Run. **W1** is your signal; **W2** is the second source, idle here.)
- **Change it and watch.** Drag the frequency up — the wave's period shrinks. Switch to a square wave.
  `[Open the Signal Generator →]`
- **See it in frequency.** A sine is a single peak; a square wave sprouts a comb of harmonics.
  `[Open the Spectrum →]`
- **How the bench digitizes.** The instrument samples with a 12-bit ADC; those finite steps set a **noise
  floor** — the flat "grass" near the bottom of the plot. Drop the bit depth and watch the floor rise. (dBFS
  = decibels below full-scale.)
`[← Back to the tour]`

## Page 6 — An RC, in time  *(~2 min)*
Now a part whose behaviour depends on *how fast* the signal changes.
`[Load the RC →]`  → a square wave in, a **rounded** output on the scope (two traces: the drive and the output).
- **Watch the lag.** The output can't jump — it charges and discharges. Slow the frequency and the curve fills
  out; speed it up and the output barely moves. `[Open the Oscilloscope →]`
- The time it takes is the **time constant, τ = R·C** — the circuit's memory, seen in time.
`[← Back to the tour]`

## Page 7 — The same RC, in frequency  *(~2 min)*
The exact same circuit, now swept across frequency.
`[Load the RC sweep →]`  → a Bode plot: flat, then rolling off.
- **Find the corner.** Low frequencies pass, high ones are cut. The knee — the **−3 dB cutoff** — is where τ
  shows up as a frequency: **f_c = 1 / (2πRC).** `[Open the Network analyzer →]`
- Same circuit, two views: **τ in time, f_c in frequency — the same fact.**
`[← Back to the tour]`

## Page 8 — An op-amp  *(~2 min)*
An op-amp trades a resistor ratio for gain.
`[Load the inverting amp →]`  → a small input, a bigger, flipped output (two traces).
- **Read the gain.** It's set by two resistors: **−Rf/Rin.** Change Rin and watch the output grow or shrink.
  Push the input too far and the output flattens — it's hit the supply rails. `[Open the Oscilloscope →]`
`[← Back to the tour]`

## Page 9 — I-V curves  *(~2 min)*
Not every part obeys Ohm's law. See a device's character directly.
`[Load the diode I-V →]`  → in **XY mode** the scope plots current vs voltage: a diode's forward knee, a
Zener's reverse breakdown.
- A resistor's I-V is a straight line; a diode's bends. **That shape *is* the device.**
  `[Open the Oscilloscope (XY) →]`   `[Open the Curve Tracer →]`
`[← Back to the tour]`

## Page 10 — Build it for real  *(the capstone)*
Everything so far was a schematic. Now bridge to hardware.
`[Open the Breadboard →]`  → place the same parts, wire them, and press **Check** — the board tells you
whether your wiring is electrically the schematic. *Practice* mode colours the nodes as you go; *Bench* mode
hides them so you build from your own understanding, then verify.
**This is the part no simulator does: design it, then build it and prove your board matches.**
`[← Back to the tour]`

## Page 11 — Where next
You've seen the whole bench. Now make something yours.
`[Open the Circuit editor →]` — draw your own, or load any example to explore.   `[About / credits]`

---

## Notes for CC
- **Example probe configs needed:** the **flashlight** (page 3) needs **CH1 differential across the resistor**;
  the **divider** (page 4) needs **CH1 differential across the top R + CH2 single-ended across the bottom R**;
  page 5 needs the **neutral single-signal example** (one trace). See the QS-4 accuracy-fixes handoff.
- Keep numbers as written (Ohm's law / gain are exact); the dBFS floor is qualitative ("near the bottom").
- Every page ends with a return-to-tour; the flashlight + divider are the two consecutive differential
  lessons (in action, then by name) — don't merge or reorder them.
