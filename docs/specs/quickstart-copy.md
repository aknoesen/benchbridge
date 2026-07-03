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
Two resistors in series split the supply — the bigger one drops more.
`[Load the divider →]`  → here the **bottom** resistor is **twice** the top one (e.g. 20 kΩ over 10 kΩ).
`[Open the Voltmeter →]`  and read the two channels — they're already wired:
- **CH2 — single-ended** (the midpoint, referenced to GND): about **3.3 V**. That's the divider's output — the
  bottom resistor is 2/3 of the total resistance, so it drops 2/3 of the 5 V. One lead sits at ground.
- **CH1 — differential** (across the *top* resistor: V+ minus the midpoint): about **1.7 V** — the drop across
  the top resistor. Both leads sit on live nodes, neither at ground.
**Two different numbers, because they're two different kinds of measurement:** single-ended reads a node
*against ground*; differential reads the *difference between two live nodes*. (We used **unequal** resistors on
purpose — equal ones make both channels read the same and hide the whole point.)
`[← Back to the tour]`

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
`[Load the RC →]`  → a **square wave** drives it.  `[Open the Oscilloscope →]` — two traces: the sharp square
**input** and a **rounded output**.
- **See the lag.** The output can't jump — it charges and discharges toward each new level, so its edges round
  off. That rounding is the circuit's **memory**, seen in time.
- How long it takes is the **time constant, τ = R·C**.
`[← Back to the tour]`

## Page 7 — The same RC, in frequency  *(~2 min)*
The exact same circuit, now swept across frequency.
`[Load the RC sweep →]`  → a Bode plot: flat, then rolling off.
- **Find the corner.** Low frequencies pass, high ones are cut. The knee — the **−3 dB cutoff** — is where τ
  shows up as a frequency: **f_c = 1 / (2πRC).** `[Open the Network analyzer →]`
- Same circuit, two views: **τ in time, f_c in frequency — the same fact.**
`[← Back to the tour]`

## Page 8 — An op-amp  *(~2 min)*
An op-amp turns a resistor ratio into gain.
`[Load the inverting amp →]`  `[Open the Oscilloscope →]` — two traces: a small **input** and a bigger,
**flipped output**.
- **Read the gain off the screen.** The output is about **2× the input, and inverted** — that's the gain the
  two resistors set: **−Rf/Rin** (here −20 kΩ / 10 kΩ = −2). Count the divisions on each trace to confirm.
- Push an amplifier too hard and the output flattens at the supply rails — that's *clipping*. *(Try it later
  in the Circuit editor by raising the input level.)*
`[← Back to the tour]`

## Page 9 — I-V curves  *(~2 min)*
Not every part obeys Ohm's law. A device's **I-V curve** — current vs voltage — is its fingerprint.
`[Load the diode I-V →]`  `[Open the Oscilloscope (XY) →]` — in **XY mode** the scope plots current vs voltage:
a **diode's** forward knee and a **Zener's** reverse breakdown. A resistor would be a straight line; the diode
bends. **That shape *is* the device.**
- **Transistors have a whole *family* of curves** — and a different tool draws those. The **Curve Tracer**
  sweeps a transistor and plots one curve per control step. `[Open the Curve Tracer →]` — heads-up: this shows
  a **transistor** family, *not* the diode. (Two different devices, two different views.)
`[← Back to the tour]`

## Page 10 — Build it for real  *(the capstone)*
Everything so far was a schematic. Now bridge to hardware.
`[Open the Breadboard →]`  — your circuit sits on top, an empty breadboard below.
- **Find your parts.** They're in the **"Place from schematic"** panel on the **right** — **scroll down** if
  you don't see them all. Click a part, then click **two holes** on the board to drop it.
- **Wire and check.** Use the **Jumper** tool to connect the columns, then press **Check** — it tells you if
  your board is electrically the schematic. *Practice* colours the nodes as you go; *Bench* hides them so you
  build from your own understanding.
- **Rotate as you place.** Hover a part and press **R** to turn it — handy for fitting a transistor or an IC.
  *(Good placement is what keeps real boards tidy.)*
**This is the part no simulator does: design it, then build it and prove your board matches.**
`[← Back to the tour]`

## Page 11 — Where next
You've seen the whole bench. Now make something yours.
`[Open the Circuit editor →]` — draw your own, or load any example to explore.   `[About / credits]`

---

## Notes for CC — and the VERIFICATION SWEEP (andre: "carefully check ALL the examples")
**Two principles for every page:** (1) **never assert a reading — send the user to the instrument to read
it** ("open the Voltmeter and read…", not "it reads 5 V"); (2) **the stated number must actually appear** on
that instrument for that example. **Verify each row below on the deployed app** (Cowork + andre will also do a
page-by-page Chrome pass):

| Pg | Example / config | Open… | Should read |
|----|------------------|-------|-------------|
| 3 | flashlight — **supply-driven DC** (V+ → 470 Ω → LED → GND) | Board (LED lit) → **Voltmeter** | hover = node **voltages**; CH1 (diff across R) ≈ **3 V** → I ≈ 6 mA |
| 4 | divider — **UNEQUAL R** (top 10 kΩ, bottom 20 kΩ, V+ 5 V) | **Voltmeter** | CH2 single (midpoint→GND) ≈ **3.3 V**; CH1 diff (across top R) ≈ **1.7 V** — *different* numbers |
| 5 | signal-sine — W1 sine, one trace | Signal Gen → **Spectrum** | one sine peak; square → harmonic comb; 12-bit noise floor |
| 6 | RC low-pass, square drive | **Oscilloscope** | rounded output, 2 traces (drive + output) |
| 7 | same RC, AC sweep | **Network analyzer** | Bode: flat then roll-off; −3 dB corner |
| 8 | inverting amp | **Oscilloscope** | bigger, flipped output; clips at rails when pushed |
| 9 | diode I-V (XY) + MOSFET family | **Scope (XY)** / **Curve Tracer** | I-V knee / breakdown; curve family |
| 10 | (capstone) | **Breadboard** | place → wire → **Check** passes |

- **Divider needs UNEQUAL resistors** (andre): equal Rs make CH1-diff = CH2-single, hiding single-vs-differential.
  Use a **dedicated Quickstart divider** (or change the shared one, but it's named "÷2" — your call) with
  top 10 kΩ / bottom 20 kΩ, **CH1 differential across the top R**, **CH2 single-ended across the bottom R**.
- **Flashlight**: supply-driven DC, **CH1 differential across the resistor** (Voltmeter), pre-built lit board.
- Numbers: Ohm's-law / divider values are exact-ish (round as written); dBFS floor is qualitative.
- Flashlight + divider are the two consecutive differential lessons (in action, then by name) — don't reorder.
