// Built-in example circuit library (loadable from the Schematic editor's Examples menu).
// Each schematic is pre-wired with a W1 source, a 1+ (scope CH1) probe on the output, grounds,
// and — for the op-amp versions — V+/V- rails, so a student can load it and immediately run the
// Network Analyzer (Bode) or the scope. Component values are chosen for clean, readable plots and
// (for the amps) gains small enough not to clip at the default 1 V input.
//
// Grid notes: parts are 2 units long (a at (gx,gy), b at (gx+2,gy)); rotation:1 makes them vertical
// (b at (gx,gy+2)). Op-amp (kind 'opamp') pins unrotated at (gx,gy): inP (gx,gy), inN (gx,gy+2),
// out (gx+4,gy+1); with opModel 'lmc662' it also exposes vpos (gx+2,gy-1) and vneg (gx+2,gy+3).
import type { Schematic } from './schematic'
import type { SignalParams } from './signal'
import { type BoardLayout, autoRouteJumpers, materializeAutoJumpers, buildHoles } from './breadboard'

export interface Example {
  id: string
  name: string
  group: 'Passive' | 'Amplifiers'
  blurb: string
  schematic: Schematic
  // Optional pre-built, Check-passing breadboard applied on load (QS-4 flashlight: the user lands
  // on a board that is already placed + wired, so the ARB-2 LED glow is immediately visible).
  board?: BoardLayout
  // Optional generator presets applied on load — e.g. an I-V curve needs a triangle SWEEP, not the
  // default square; the summing amp needs both W1 and W2. Loading any example with a w1 resets the
  // generators (W2 back to default unless w2 is given) so there is no carryover from a prior example.
  w1?: SignalParams
  w2?: SignalParams
  // Optional scope mode applied on load: xy:true puts the oscilloscope in XY mode (I-V curves);
  // omitted/false loads in normal time (YT) mode.
  xy?: boolean
  // Optional: open the Curve Tracer (SWEEP-1) on load instead of the scope — a transistor
  // characteristic-curve family (W1 sweeps Vds/Vce, W2 steps the control, scope XY via Rsense).
  tracer?: boolean
  // Optional scope Volts/div presets so an example frames its curve without manual scaling
  // (must be one of the scope's steps: 0.05, 0.1, 0.2, 0.5, 1, 2, 5).
  ch1Vdiv?: number
  ch2Vdiv?: number
}

// A clean sine generator preset (most examples just want a steady tone to frame on the scope).
const sine = (frequency: number, amplitude = 1): SignalParams =>
  ({ waveType: 'sine', frequency, amplitude, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 })

// --- shared amp skeletons (inverting / non-inverting) — kit OP484 (rail-to-rail), auto ±5 V rails --

// Two-terminal instruments (SCH-11): W1 carries its own drawn ground return (gy+2); the
// scopes' − leads (gy+2) stay unwired = single-ended. P2 sits at (0,6) so W1's return pin
// at (2,8) has its grid point to itself.
function invertingAmp(): Schematic {
  return {
    components: [
      { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
      { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },
      { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'op484' },
      { id: 'Rf', kind: 'resistor', gx: 10, gy: 8, value: 20000 },
      { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
      { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },  // 1+ on out; 1− (16,7) unwired = single-ended
      { id: 'P2', kind: 'scope2', gx: 0, gy: 6 },   // 2+ on the input (CH2 = drive), single-ended
    ],
    wires: [
      { x1: 2, y1: 6, x2: 4, y2: 6 },   // W1 -> Rin.a
      { x1: 0, y1: 6, x2: 2, y2: 6 },   // 2+ -> input
      { x1: 6, y1: 6, x2: 10, y2: 6 },  // Rin.b -> inN (summing node)
      { x1: 10, y1: 4, x2: 8, y2: 4 },  // inP -> ground
      { x1: 10, y1: 6, x2: 10, y2: 8 }, // inN -> Rf.a
      { x1: 14, y1: 5, x2: 14, y2: 8 }, // out -> down
      { x1: 14, y1: 8, x2: 12, y2: 8 }, // -> Rf.b  (feedback)
      { x1: 14, y1: 5, x2: 16, y2: 5 }, // out -> 1+
    ],
  }
}

function nonInvertingAmp(): Schematic {
  return {
    components: [
      { id: 'W1', kind: 'awg1', gx: 6, gy: 4 },
      { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'op484' },
      { id: 'Rf', kind: 'resistor', gx: 12, gy: 6, value: 10000 },
      { id: 'Rg', kind: 'resistor', gx: 10, gy: 6, rotation: 1, value: 10000 },
      { id: 'G1', kind: 'ground', gx: 10, gy: 10 },
      { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },  // 1+ on out; 1− unwired = single-ended
      { id: 'P2', kind: 'scope2', gx: 4, gy: 2 },   // 2+ on the input; 2− (4,4) unwired = single-ended
    ],
    wires: [
      { x1: 6, y1: 4, x2: 10, y2: 4 },  // W1 -> inP
      { x1: 6, y1: 4, x2: 6, y2: 2 },   // input -> up
      { x1: 6, y1: 2, x2: 4, y2: 2 },   // -> 2+
      { x1: 10, y1: 6, x2: 12, y2: 6 }, // inN -> Rf.a (Rg.a shares inN at 10,6)
      { x1: 14, y1: 6, x2: 14, y2: 5 }, // Rf.b -> out
      { x1: 14, y1: 5, x2: 16, y2: 5 }, // out -> 1+
      { x1: 10, y1: 8, x2: 10, y2: 10 },// Rg.b -> ground (explicit, so moves follow)
    ],
  }
}

// --- the flashlight (QS-4 page 3): schematic + a PRE-BUILT board -----------------------------
// V+ (Power Supply, default +5 V) → R 470 → LED → GND. CH1 differential across R: 1+ on the
// V+ node, 1− on the R/LED junction. Drop ≈ 5 − 1.8 ≈ 3.2 V → I ≈ 6.8 mA.
const FLASHLIGHT_SCHEMATIC: Schematic = {
  components: [
    { id: 'VP', kind: 'vplus', gx: 2, gy: 4 },
    { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 470 },  // a=(4,4) b=(6,4)
    { id: 'D1', kind: 'led', gx: 6, gy: 4, value: 1.8 },       // anode=(6,4)=R1.b  cathode=(8,4); Vf 1.8 → red
    { id: 'G1', kind: 'ground', gx: 8, gy: 6 },
    // Two-terminal scope: 1+ (4,0) on the V+ end, 1− (4,2) wired to the R/LED junction —
    // the differential read across R1, now visibly two leads of ONE instrument.
    { id: 'P1', kind: 'scope1', gx: 4, gy: 0 },
  ],
  wires: [
    { x1: 2, y1: 4, x2: 4, y2: 4 },   // V+ -> R1.a
    { x1: 4, y1: 0, x2: 2, y2: 0 },   // 1+ -> left
    { x1: 2, y1: 0, x2: 2, y2: 4 },   // -> V+ node
    { x1: 4, y1: 2, x2: 6, y2: 2 },   // 1− -> right
    { x1: 6, y1: 2, x2: 6, y2: 4 },   // -> R1.b / LED anode (differential across R1)
    { x1: 8, y1: 4, x2: 8, y2: 6 },   // LED cathode -> ground
  ],
}
// The pre-built board: parts placed, wiring generated by the F-7 router and materialised to plain
// student jumpers — Check-passing by construction, and it works in every routing mode. Loading the
// flashlight lands the user on a board where the ARB-2 glow is already lit (steady DC drive).
const FLASHLIGHT_BOARD: BoardLayout = (() => {
  const base: BoardLayout = {
    parts: [
      { id: 'R1', kind: 'resistor', aHole: 'b10', bHole: 'b15', value: 470, seq: 0 },
      { id: 'D1', kind: 'led', aHole: 'c20', bHole: 'c24', value: 1.8, seq: 1 },
    ],
    jumpers: [], ports: [],
  }
  return { ...base, jumpers: materializeAutoJumpers(autoRouteJumpers(FLASHLIGHT_SCHEMATIC, base, buildHoles())) }
})()

// --- the library ----------------------------------------------------------------------------

export const EXAMPLES: Example[] = [
  {
    id: 'flashlight', name: 'Flashlight (supply → resistor → LED)', group: 'Passive',
    blurb: 'The simplest useful circuit: the V+ supply pushes current through a 470 Ω resistor into a ' +
      'red LED. It loads with the breadboard already built — the LED is LIT with the simulated current ' +
      '(hover it: ≈6 mA). Channel 1 reads ACROSS the resistor (a differential measurement — neither ' +
      'probe at ground): ≈3 V drop, so I = V/R ≈ 6 mA, the same current the LED shows. Brightness, ' +
      'connected to a number you measured.',
    ch1Vdiv: 1,
    schematic: FLASHLIGHT_SCHEMATIC,
    board: FLASHLIGHT_BOARD,
  },
  {
    id: 'divider', name: 'Voltage divider (10 kΩ : 20 kΩ)', group: 'Passive',
    blurb: 'Two resistors in series split the supply — the bigger one drops more. The bottom resistor ' +
      'is twice the top (20 kΩ over 10 kΩ), and the two channels are already wired to read it two ways: ' +
      'Channel 2 single-ended (midpoint against ground, ≈2/3 of the supply) and Channel 1 differential ' +
      '(across the top resistor, ≈1/3 of it). Open the Voltmeter and read them — two DIFFERENT numbers, ' +
      'because they are two different kinds of measurement. Unequal on purpose: equal resistors would ' +
      'make both channels agree and hide the point.',
    // V+ rail (Power Supply, default +5 V) drives the divider. UNEQUAL on purpose (QS-4 page 4):
    // CH1 = V+ − midpoint (differential across R1) ≈ 1.7 V; CH2 = midpoint (single-ended across
    // R2) ≈ 3.3 V — different numbers make single-vs-differential visible. 2 V/div frames both.
    ch1Vdiv: 2, ch2Vdiv: 2,
    schematic: {
      // Every connection is an explicit wire (not a coincidence of two legs at one grid point), so a
      // student can drag any part and its wires follow — R1 and R2 behave the same.
      components: [
        { id: 'VP', kind: 'vplus', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 10000 },              // a=(4,4) b=(6,4)
        { id: 'R2', kind: 'resistor', gx: 8, gy: 4, rotation: 1, value: 20000 }, // a=(8,4) b=(8,6)
        { id: 'G1', kind: 'ground', gx: 8, gy: 8 },
        // Two-terminal scopes: CH1's two leads read ACROSS R1 (1+ on V+, 1− wired to the
        // midpoint = differential); CH2's − lead stays unwired = single-ended across R2.
        { id: 'P1', kind: 'scope1', gx: 4, gy: 0 },   // 1+ (4,0) → V+; 1− (4,2) → midpoint
        { id: 'P2', kind: 'scope2', gx: 10, gy: 4 },  // 2+ on the midpoint; 2− (10,6) unwired
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },   // V+ -> R1.a (applied)
        { x1: 4, y1: 0, x2: 2, y2: 0 },   // 1+ -> left
        { x1: 2, y1: 0, x2: 2, y2: 4 },   // -> V+ node
        { x1: 6, y1: 4, x2: 8, y2: 4 },   // R1.b -> R2.a (the midpoint link)
        { x1: 8, y1: 4, x2: 10, y2: 4 },  // midpoint -> 2+
        { x1: 4, y1: 2, x2: 10, y2: 2 },  // 1− -> right
        { x1: 10, y1: 2, x2: 10, y2: 4 }, // -> midpoint (differential across R1)
        { x1: 8, y1: 6, x2: 8, y2: 8 },   // R2.b -> ground
      ],
    },
  },
  {
    id: 'signal-sine', name: 'A signal (W1 → scope)', group: 'Passive',
    blurb: 'One clean signal, no circuit to speak of: W1 drives channel 1 of the scope directly (the ' +
      '1 MΩ resistor is the scope\'s own input impedance, drawn explicitly). Change the wave shape, ' +
      'frequency, and amplitude on the Signal Generator and watch the trace follow — then open the ' +
      'Spectrum Analyzer to see the same signal as frequencies (a sine is one peak; a square wave is ' +
      'a comb of odd harmonics).',
    w1: sine(1000), ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 1e6 }, // the scope's 1 MΩ input; a=(6,4) b=(6,6)
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },   // 1+ straight on W1; 1− (8,6) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 6, y2: 4 },   // W1 -> R1.a
        { x1: 6, y1: 4, x2: 8, y2: 4 },   // -> 1+
        { x1: 6, y1: 6, x2: 6, y2: 8 },   // R1.b -> ground
      ],
    },
  },
  {
    id: 'rc-lp', name: 'RC low-pass (~1 kHz)', group: 'Passive',
    blurb: 'Series R, shunt C. −3 dB near 1 kHz, −20 dB/decade. The square drive makes the time ' +
      'constant visible: the output rounds every edge as the capacitor charges (τ = RC). Slow the ' +
      'frequency and the curve fills out; speed it up and the output barely moves.',
    // Square drive (not sine) so the scope shows charging curves — τ in time; the Network Analyzer's
    // .ac sweep is unaffected by the W1 shape.
    w1: { waveType: 'square', frequency: 1000, amplitude: 1, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 }, ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 1500 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 4, rotation: 1, value: 1e-7 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the W1 input; 2− (0,4) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 6, x2: 6, y2: 8 },   // shunt leg -> ground (explicit, so moves follow)
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },   // -> 2+
      ],
    },
  },
  {
    id: 'rc-hp', name: 'RC high-pass (~1 kHz)', group: 'Passive',
    blurb: 'Series C, shunt R. −3 dB near 1 kHz, +20 dB/decade below.',
    w1: sine(1000), ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'C1', kind: 'capacitor', gx: 4, gy: 4, value: 1e-7 },
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 1500 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the W1 input; 2− (0,4) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 6, x2: 6, y2: 8 },   // shunt leg -> ground (explicit, so moves follow)
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },   // -> 2+
      ],
    },
  },
  {
    id: 'lc-lp', name: 'LC low-pass (~1.6 kHz)', group: 'Passive',
    blurb: 'Series L, shunt C. 2nd-order: resonant peak then −40 dB/decade.',
    w1: sine(500), ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'L1', kind: 'inductor', gx: 4, gy: 4, value: 1e-2 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 4, rotation: 1, value: 1e-6 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the W1 input; 2− (0,4) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 6, x2: 6, y2: 8 },   // shunt leg -> ground (explicit, so moves follow)
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },   // -> 2+
      ],
    },
  },
  {
    id: 'lc-hp', name: 'LC high-pass (~1.6 kHz)', group: 'Passive',
    blurb: 'Series C, shunt L. 2nd-order high-pass with a resonant peak.',
    w1: sine(5000), ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'C1', kind: 'capacitor', gx: 4, gy: 4, value: 1e-6 },
        { id: 'L1', kind: 'inductor', gx: 6, gy: 4, rotation: 1, value: 1e-2 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the W1 input; 2− (0,4) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 6, x2: 6, y2: 8 },   // shunt leg -> ground (explicit, so moves follow)
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },   // -> 2+
      ],
    },
  },
  {
    id: 'rl-lp', name: 'RL low-pass (~16 kHz)', group: 'Passive',
    blurb: 'Series L, shunt R (output across R). 1st-order: −3 dB near 16 kHz, −20 dB/decade. f_c = R/2πL (1 kΩ, 10 mH — both kit values; R ≫ the M2K\'s 50 Ω output resistance so the textbook corner holds).',
    w1: sine(16000), ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'L1', kind: 'inductor', gx: 4, gy: 4, value: 1e-2 },
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 1000 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the W1 input; 2− (0,4) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 6, x2: 6, y2: 8 },   // shunt leg -> ground (explicit, so moves follow)
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },   // -> 2+
      ],
    },
  },
  {
    id: 'rl-hp', name: 'RL high-pass (~16 kHz)', group: 'Passive',
    blurb: 'Series R, shunt L (output across L). 1st-order: −3 dB near 16 kHz, +20 dB/decade below. f_c = R/2πL (1 kΩ, 10 mH — both kit values; R ≫ the M2K\'s 50 Ω output resistance so the textbook corner holds).',
    w1: sine(16000), ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 1000 },
        { id: 'L1', kind: 'inductor', gx: 6, gy: 4, rotation: 1, value: 1e-2 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 8, gy: 4 },
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the W1 input; 2− (0,4) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 6, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 6, x2: 6, y2: 8 },   // shunt leg -> ground (explicit, so moves follow)
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },   // -> 2+
      ],
    },
  },
  {
    id: 'inv-amp', name: 'Inverting amp ×−2 (OP484)', group: 'Amplifiers',
    blurb: 'Kit OP484 (rail-to-rail) op-amp on ±5 V rails. Gain −Rf/Rin = −2 (Rf 20 kΩ, Rin 10 kΩ — both kit values; CH2 in, CH1 out, note the inversion). Buildable on the breadboard as a DIP.',
    w1: sine(1000), ch1Vdiv: 1, ch2Vdiv: 1,
    schematic: invertingAmp(),
  },
  {
    id: 'noninv-amp', name: 'Non-inverting amp ×2 (OP484)', group: 'Amplifiers',
    blurb: 'Kit OP484 (rail-to-rail) op-amp on ±5 V rails. Gain 1 + Rf/Rg = 2 (CH2 in, CH1 out — same phase, 2× taller). Buildable on the breadboard as a DIP.',
    w1: sine(1000), ch1Vdiv: 1, ch2Vdiv: 1,
    schematic: nonInvertingAmp(),
  },
  {
    id: 'tia-photodiode', name: 'Photodiode TIA (TLV9062, single-supply)', group: 'Amplifiers',
    blurb: 'A photodiode transimpedance amplifier on the course TLV9062 — running SINGLE-SUPPLY (+5 V, V− → GND), because the TLV9062 maxes at 5.5 V so the M2K\'s ±5 V cannot cross it. The + input sits at a small Vref (≈0.45 V from the 10 k/1 k divider off V+), NOT ground, so the output has room to swing UP. Dark: the output rests at Vref. Light: the 80 µA photocurrent drives it up to Vout = Vref + Iph·Rf ≈ 3 V (Rf 33 kΩ, well inside the 0–5 V rails). There is no negative swing — flip the photodiode and the output pins at a rail and looks "dead". Open the Network Analyzer and switch to Transimpedance mode: |Z| is flat at Rf then rolls off (Cf 1 nF sets the corner). Contrast with the ±5 V OP484 inverting amp, whose output can swing both ways. Boards as a SOIC-8-on-adapter with V− on the GND rail.',
    ch1Vdiv: 1,
    schematic: {
      // Single-supply TIA. Photodiode CATHODE → op-amp inverting input (summing node at Vref),
      // ANODE → GND, so the photocurrent pulls the summing node and drives Vout UP from Vref.
      components: [
        { id: 'VP', kind: 'vplus', gx: 2, gy: 4 },
        { id: 'Rt', kind: 'resistor', gx: 4, gy: 4, value: 10000 },              // V+ → Vref (divider top)
        { id: 'Rb', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 1000 },  // Vref → GND (divider bottom)
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'tlv9062' },             // inP(10,4) inN(10,6) out(14,5)
        { id: 'D1', kind: 'photodiode', gx: 8, gy: 6, value: 80e-6 },            // anode(8,6) cathode(10,6)=inN
        { id: 'Cf', kind: 'capacitor', gx: 10, gy: 8, value: 1e-9 },             // feedback cap (a(10,8) b(12,8))
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 33000 },           // feedback R (a(10,10) b(12,10))
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },                              // divider bottom → GND
        { id: 'G2', kind: 'ground', gx: 8, gy: 8 },                              // photodiode anode → GND
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },                             // 1+ on the output; 1− (16,7) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },    // V+ → Rt.a
        { x1: 6, y1: 4, x2: 10, y2: 4 },   // Vref (Rt.b = Rb.a) → inP
        { x1: 6, y1: 6, x2: 6, y2: 8 },    // Rb.b → ground
        { x1: 8, y1: 6, x2: 8, y2: 8 },    // photodiode anode → ground
        { x1: 10, y1: 6, x2: 10, y2: 8 },  // inN (= photodiode cathode) → Cf.a
        { x1: 10, y1: 8, x2: 10, y2: 10 }, // Cf.a → Rf.a (parallel feedback, summing-node side)
        { x1: 14, y1: 5, x2: 14, y2: 8 },  // out → down
        { x1: 14, y1: 8, x2: 12, y2: 8 },  // → Cf.b (out side)
        { x1: 12, y1: 8, x2: 12, y2: 10 }, // Cf.b → Rf.b
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out → 1+
      ],
    },
  },
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
        { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },      // W1 -> summing node: I = V_W1/Rin (emulated photocurrent)
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'op484' },        // inP(10,4) inN(10,6) out(14,5)
        { id: 'Cf', kind: 'capacitor', gx: 10, gy: 8, value: 100e-12 },   // feedback cap: sets ~16 kHz bandwidth
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 100000 },    // feedback R = transimpedance (100 kΩ)
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },                       // inP -> ground (virtual ground = 0 V)
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },                      // 1+ on out; 1− unwired = single-ended
        { id: 'P2', kind: 'scope2', gx: 0, gy: 6 },                       // 2+ on the W1 drive; 2− unwired
      ],
      wires: [
        { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Rin.a
        { x1: 0, y1: 6, x2: 2, y2: 6 },    // 2+ -> input
        { x1: 6, y1: 6, x2: 10, y2: 6 },   // Rin.b -> inN (summing node)
        { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
        { x1: 10, y1: 6, x2: 10, y2: 8 },  // inN -> Cf.a
        { x1: 10, y1: 8, x2: 10, y2: 10 }, // Cf.a -> Rf.a (parallel feedback, summing-node side)
        { x1: 14, y1: 5, x2: 14, y2: 8 },  // out -> down
        { x1: 14, y1: 8, x2: 12, y2: 8 },  // -> Cf.b (out side)
        { x1: 12, y1: 8, x2: 12, y2: 10 }, // Cf.b -> Rf.b
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
      ],
    },
  },
  {
    id: 'rlc-bandpass', name: 'RLC band-pass (~1.6 kHz)', group: 'Passive',
    blurb: 'Series L-C with output across R. Peaks at resonance (Q ≈ 10). Note: the 100 mH inductor is above the kit\'s 10 mH max, so the inspector flags it "not in your parts kit" — a simulation-only demo (everything else loads as kit values).',
    w1: sine(1600), ch1Vdiv: 0.2,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'L1', kind: 'inductor', gx: 4, gy: 4, value: 0.1 },           // a=(4,4) b=(6,4)
        { id: 'C1', kind: 'capacitor', gx: 8, gy: 4, value: 1e-7 },         // a=(8,4) b=(10,4)
        { id: 'R1', kind: 'resistor', gx: 10, gy: 4, rotation: 1, value: 100 }, // a=(10,4) b=(10,6)
        { id: 'G1', kind: 'ground', gx: 10, gy: 8 },
        { id: 'P1', kind: 'scope1', gx: 12, gy: 4 },  // 1+ across R; 1− (12,6) unwired = single-ended
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the W1 input; 2− (0,4) unwired
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },    // W1 -> L.a
        { x1: 6, y1: 4, x2: 8, y2: 4 },    // L.b -> C.a (series link, explicit)
        { x1: 10, y1: 4, x2: 12, y2: 4 },  // node (across R) -> 1+
        { x1: 10, y1: 6, x2: 10, y2: 8 },  // R.b -> ground (explicit, so moves follow)
        { x1: 2, y1: 4, x2: 2, y2: 2 },    // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },    // -> 2+
      ],
    },
  },
  {
    id: 'integrator', name: 'Integrator (OP484)', group: 'Amplifiers',
    blurb: 'Kit OP484 (rail-to-rail) op-amp on ±5 V rails. Inverting integrator (Rf bounds DC gain, ~80 Hz corner). Drive well above the corner and a triangle integrates to a parabolic wave (CH2 in, CH1 out). Buildable on the breadboard as a DIP.',
    // Drive at 1 kHz, ~12× above the ~80 Hz corner, so it integrates cleanly: output extrema land on
    // the input zero-crossings. (τ = RfCf = 2 ms stays under the sim window, so it settles with no
    // offset drift.) CH1 = output (~0.5 Vpp, 100 mV/div), CH2 = input (4 Vpp, 1 V/div).
    w1: { waveType: 'triangle', frequency: 1000, amplitude: 2, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    ch1Vdiv: 0.1, ch2Vdiv: 1,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
        { id: 'Rin', kind: 'resistor', gx: 4, gy: 6, value: 10000 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'op484' },
        { id: 'Cf', kind: 'capacitor', gx: 10, gy: 8, value: 1e-7 },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 20000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },  // 1+ on out; 1− unwired = single-ended
        { id: 'P2', kind: 'scope2', gx: 0, gy: 6 },   // 2+ on the W1 drive; 2− unwired
      ],
      wires: [
        { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Rin.a
        { x1: 0, y1: 6, x2: 2, y2: 6 },    // 2+ -> input (probe the drive)
        { x1: 6, y1: 6, x2: 10, y2: 6 },   // Rin.b -> inN
        { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
        { x1: 10, y1: 6, x2: 10, y2: 8 },  // inN -> Cf.a
        { x1: 10, y1: 8, x2: 10, y2: 10 }, // Cf.a -> Rf.a (parallel feedback)
        { x1: 12, y1: 8, x2: 12, y2: 10 }, // Cf.b -> Rf.b
        { x1: 14, y1: 5, x2: 14, y2: 8 },  // out -> down
        { x1: 14, y1: 8, x2: 12, y2: 8 },  // -> feedback (out side)
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
      ],
    },
  },
  {
    id: 'differentiator', name: 'Differentiator (OP484)', group: 'Amplifiers',
    blurb: 'Kit OP484 (rail-to-rail) op-amp on ±5 V rails. Inverting differentiator, +20 dB/decade (0 dB near 160 Hz): a triangle differentiates to a square (CH2 in, CH1 out). Buildable on the breadboard as a DIP.',
    // Triangle in -> square out (derivative of constant slopes). With the real OP484 the square has
    // some peaking at the corners (a practical differentiator), so the output runs a few volts.
    // CH1 = output (~±3 V, 1 V/div), CH2 = input (4 Vpp, 1 V/div).
    w1: { waveType: 'triangle', frequency: 200, amplitude: 2, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    ch1Vdiv: 1, ch2Vdiv: 1,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },
        { id: 'Cin', kind: 'capacitor', gx: 4, gy: 6, value: 1e-7 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'op484' },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 8, value: 10000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },  // 1+ on out; 1− unwired = single-ended
        { id: 'P2', kind: 'scope2', gx: 0, gy: 6 },   // 2+ on the W1 drive; 2− unwired
      ],
      wires: [
        { x1: 2, y1: 6, x2: 4, y2: 6 },    // W1 -> Cin.a
        { x1: 0, y1: 6, x2: 2, y2: 6 },    // 2+ -> input (probe the drive)
        { x1: 6, y1: 6, x2: 10, y2: 6 },   // Cin.b -> inN
        { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
        { x1: 10, y1: 6, x2: 10, y2: 8 },  // inN -> Rf.a
        { x1: 14, y1: 5, x2: 14, y2: 8 },  // out -> down
        { x1: 14, y1: 8, x2: 12, y2: 8 },  // -> Rf.b (feedback)
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
      ],
    },
  },
  {
    id: 'summing', name: 'Summing amp (OP484)', group: 'Amplifiers',
    blurb: 'Kit OP484 (rail-to-rail) op-amp on ±5 V rails. Inverting summer: out = −(W1 + W2). Both generators are preset (1 kHz + 2 kHz); the scope shows the composite sum, and you can see/edit W1 and W2 in the Signal Generator. Buildable on the breadboard as a DIP.',
    w1: sine(1000), w2: sine(2000), ch1Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 6 },     // return (2,8) — its own drawn ground
        { id: 'Ra', kind: 'resistor', gx: 6, gy: 6, value: 10000 },
        { id: 'W2', kind: 'awg2', gx: 2, gy: 10 },    // below W1's return; its own return (2,12)
        { id: 'Rb', kind: 'resistor', gx: 6, gy: 8, value: 10000 },
        { id: 'U1', kind: 'opamp', gx: 10, gy: 4, part: 'op484' },
        { id: 'Rf', kind: 'resistor', gx: 10, gy: 10, value: 10000 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
        { id: 'P1', kind: 'scope1', gx: 16, gy: 5 },  // 1+ on out; 1− unwired = single-ended
        { id: 'P2', kind: 'scope2', gx: 0, gy: 4 },   // 2+ on the W1 input; 2− (0,6) unwired
      ],
      wires: [
        { x1: 2, y1: 6, x2: 6, y2: 6 },    // W1 -> Ra.a
        { x1: 8, y1: 6, x2: 10, y2: 6 },   // Ra.b -> inN
        { x1: 2, y1: 10, x2: 6, y2: 10 },  // W2 -> right
        { x1: 6, y1: 10, x2: 6, y2: 8 },   // -> Rb.a
        { x1: 8, y1: 8, x2: 8, y2: 6 },    // Rb.b -> summing node (Ra.b)
        { x1: 10, y1: 4, x2: 8, y2: 4 },   // inP -> ground
        { x1: 10, y1: 6, x2: 10, y2: 10 }, // inN -> Rf.a
        { x1: 14, y1: 5, x2: 14, y2: 10 }, // out -> down
        { x1: 14, y1: 10, x2: 12, y2: 10 },// -> Rf.b (feedback)
        { x1: 14, y1: 5, x2: 16, y2: 5 },  // out -> 1+
        { x1: 0, y1: 4, x2: 2, y2: 4 },    // 2+ -> right
        { x1: 2, y1: 4, x2: 2, y2: 6 },    // -> W1 input
      ],
    },
  },
  {
    id: 'ina125-amp', name: 'INA125 in-amp ×10', group: 'Amplifiers',
    blurb: 'INA125 instrumentation amp, gain 10 set by R_G = 10 kΩ (G = 4 + 60 kΩ/R_G). A tiny differential input becomes a big output (CH2 in, CH1 out). Builds on the breadboard as a 16-pin DIP.',
    w1: sine(1000, 0.3), ch1Vdiv: 1, ch2Vdiv: 0.2,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'U1', kind: 'ina125', gx: 8, gy: 4 },           // pins: VIN+ (8,4) VIN− (8,6) VO (15,5) RG (10,8)(12,8) IAREF (14,8)
        { id: 'RG', kind: 'resistor', gx: 10, gy: 10, value: 10000 }, // R_G, wired to the RG pins
        { id: 'G1', kind: 'ground', gx: 8, gy: 8 },           // VIN− to ground
        { id: 'G2', kind: 'ground', gx: 14, gy: 10 },         // IAREF to ground
        { id: 'P1', kind: 'scope1', gx: 17, gy: 5 },  // 1+ on VO; 1− unwired = single-ended
        { id: 'P2', kind: 'scope2', gx: 0, gy: 2 },   // 2+ on the input; 2− unwired
      ],
      // NOTE (two-terminal migration, deliberate FIX): the old "ground -> 1-/2-" stub wires ran
      // along y=8 straight THROUGH the RG pins at (10,8)/(12,8), grounding and shorting the gain
      // network — the example clipped at the +5 V rail instead of showing its stated ×10. With
      // the reference stubs gone, RG carries only R_G and the amp reads gain 10 as documented.
      wires: [
        { x1: 2, y1: 4, x2: 8, y2: 4 },    // W1 -> VIN+
        { x1: 2, y1: 4, x2: 2, y2: 2 },    // input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },    // -> 2+
        { x1: 8, y1: 6, x2: 8, y2: 8 },    // VIN− -> ground
        { x1: 10, y1: 8, x2: 10, y2: 10 }, // RG pin 8 -> R_G.a
        { x1: 12, y1: 8, x2: 12, y2: 10 }, // RG pin 9 -> R_G.b
        { x1: 14, y1: 8, x2: 14, y2: 10 }, // IAREF -> ground
        { x1: 15, y1: 5, x2: 17, y2: 5 },  // VO -> 1+
      ],
    },
  },
  {
    id: 'diode-iv', name: 'Diode I-V curve (XY)', group: 'Passive',
    blurb: 'Switch the scope to XY mode to see the curve. CH1 (X) = voltage across the diode, CH2 (Y) = current (I·Rsense). W1 is preset to a triangle sweep.',
    w1: { waveType: 'triangle', frequency: 200, amplitude: 2, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    xy: true, ch1Vdiv: 0.5, ch2Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'D1', kind: 'diode', gx: 4, gy: 4 },               // anode (4,4) → cathode (6,4)
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 470 }, // sense R to ground
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        // Two-terminal scopes, rotated horizontal (rotation 3: − lead 2 cells RIGHT of +):
        // CH1 reads ACROSS the diode (1+ anode, 1− cathode); CH2 single-ended on the cathode.
        { id: 'S1', kind: 'scope1', gx: 4, gy: 2, rotation: 3 }, // 1+ (4,2) anode; 1− (6,2) cathode
        { id: 'S2', kind: 'scope2', gx: 8, gy: 2, rotation: 3 }, // 2+ (8,2) cathode; 2− (10,2) unwired
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },  // W1 -> anode
        { x1: 4, y1: 4, x2: 4, y2: 2 },  // anode -> 1+
        { x1: 6, y1: 4, x2: 6, y2: 2 },  // cathode -> 1-  (differential across the diode)
        { x1: 6, y1: 4, x2: 8, y2: 4 },  // cathode -> right
        { x1: 8, y1: 4, x2: 8, y2: 2 },  // -> 2+
        { x1: 6, y1: 6, x2: 6, y2: 8 },  // sense R -> ground (explicit, so moves follow)
      ],
    },
  },
  {
    id: 'zener-iv', name: 'Zener I-V curve (XY)', group: 'Passive',
    blurb: 'In XY mode you see the forward knee (~0.7 V) AND the reverse breakdown near −3.3 V. W1 is preset to a ±4 V triangle sweep; if the forward current runs off the top, set CH2 to a coarser Volts/div.',
    w1: { waveType: 'triangle', frequency: 200, amplitude: 4, offset: 0, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    xy: true, ch1Vdiv: 2, ch2Vdiv: 1,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'Z1', kind: 'zener', gx: 4, gy: 4, value: 3.3 },
        { id: 'R1', kind: 'resistor', gx: 6, gy: 4, rotation: 1, value: 470 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
        // Two-terminal scopes, rotated horizontal (rotation 3: − lead right of +):
        { id: 'S1', kind: 'scope1', gx: 4, gy: 2, rotation: 3 }, // 1+ anode; 1− (6,2) cathode = across the Zener
        { id: 'S2', kind: 'scope2', gx: 8, gy: 2, rotation: 3 }, // 2+ cathode; 2− (10,2) unwired
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },
        { x1: 4, y1: 4, x2: 4, y2: 2 },  // anode -> 1+
        { x1: 6, y1: 4, x2: 6, y2: 2 },  // cathode -> 1-  (differential across the Zener)
        { x1: 6, y1: 4, x2: 8, y2: 4 },  // cathode -> right
        { x1: 8, y1: 4, x2: 8, y2: 2 },  // -> 2+
        { x1: 6, y1: 6, x2: 6, y2: 8 },  // sense R -> ground (explicit, so moves follow)
      ],
    },
  },
  {
    id: 'led-pwm', name: 'PWM-driven LED (breadboard glow)', group: 'Passive',
    blurb: 'A red LED and a 470 Ω current-limiting resistor driven by W1 as a 0–5 V square wave — the ' +
      'classic "dim an LED with PWM" demo. Load it, open the Breadboard, transfer the parts, and run: ' +
      'the LED lights up. Its brightness follows the TIME-AVERAGE forward current, so change the W1 duty ' +
      'cycle (Signal Generator) and the glow dims/brightens smoothly — perceived brightness is log-scaled, ' +
      'so 50 % duty is mid-glow, not half-off. CH1 shows the PWM drive square. The glow is a Breadboard-view ' +
      'feature: it reads the live sim current, so nothing lights until the parts are on the board and ' +
      'a valid circuit is simulating. Boards as a through-hole 5 mm LED + a 470 Ω resistor.',
    // 0–5 V square (amplitude = peak → swing is offset ± amplitude). On-current ≈ (5 − 1.8)/470 ≈ 6.8 mA;
    // 50 % duty → ~3.4 mA average = mid-glow on the log brightness curve. 1 V/div frames the 5 V square.
    w1: { waveType: 'square', frequency: 1000, amplitude: 2.5, offset: 2.5, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    ch1Vdiv: 1,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 470 },  // a=(4,4) b=(6,4) — current limit
        { id: 'D1', kind: 'led', gx: 6, gy: 4, value: 1.8 },       // anode=(6,4)=R1.b  cathode=(8,4); Vf 1.8 → red
        { id: 'G1', kind: 'ground', gx: 8, gy: 6 },
        { id: 'P1', kind: 'scope1', gx: 0, gy: 2 },                // 1+ on the W1 node; 1− (0,4) unwired = single-ended
      ],
      wires: [
        { x1: 2, y1: 4, x2: 4, y2: 4 },   // W1 -> R1.a (R1.b at (6,4) coincides with the LED anode)
        { x1: 8, y1: 4, x2: 8, y2: 6 },   // LED cathode -> ground
        { x1: 2, y1: 4, x2: 2, y2: 2 },   // W1 input -> up
        { x1: 2, y1: 2, x2: 0, y2: 2 },   // -> 1+
      ],
    },
  },
  {
    id: 'nmos-output-xy', name: 'MOSFET output curve (XY)', group: 'Amplifiers',
    blurb: 'A ZVN2110A NMOS with the gate held at V+ (on). W1 sweeps the drain; in XY mode CH1 (X) ≈ Vds, CH2 (Y) = drain current (I·Rsense). This is one Vgs output characteristic — load "MOSFET curve family" to let the SWEEP-1 Curve Tracer step W2 on the gate and draw the whole family.',
    w1: { waveType: 'triangle', frequency: 200, amplitude: 2.5, offset: 2.5, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    xy: true, ch1Vdiv: 1, ch2Vdiv: 0.5,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 12, gy: 4 },   // return (12,6) — its own drawn ground
        { id: 'M1', kind: 'mosfet', gx: 6, gy: 4, part: 'ZVN2110A' }, // drain (8,4), gate (6,5), source (8,6)
        { id: 'Vp', kind: 'vplus', gx: 4, gy: 5 },
        { id: 'R1', kind: 'resistor', gx: 8, gy: 6, rotation: 1, value: 100 }, // source -> sense R (a (8,6) b (8,8))
        { id: 'G1', kind: 'ground', gx: 8, gy: 10 },
        { id: 'S1', kind: 'scope1', gx: 8, gy: 2, rotation: 3 }, // 1+ on the drain (≈ Vds); 1− (10,2) unwired
        { id: 'S2', kind: 'scope2', gx: 10, gy: 6 }, // 2+ on the source node (I·Rsense); 2− (10,8) unwired
      ],
      wires: [
        { x1: 8, y1: 4, x2: 10, y2: 4 },  // drain -> right
        { x1: 10, y1: 4, x2: 12, y2: 4 }, // -> W1
        { x1: 4, y1: 5, x2: 6, y2: 5 },   // V+ -> gate (Vgs = +5, on)
        { x1: 8, y1: 4, x2: 8, y2: 2 },   // drain -> 1+
        { x1: 8, y1: 8, x2: 8, y2: 10 },  // sense R -> ground
        { x1: 8, y1: 6, x2: 10, y2: 6 },  // source node -> 2+
      ],
    },
  },
  {
    id: 'nmos-curve-family', name: 'MOSFET curve family (ZVN2110A)', group: 'Amplifiers',
    blurb: 'The full output-characteristic family on the Curve Tracer (SWEEP-1). W1 sweeps the drain (Vds); W2 steps the gate (Vgs) over several values; the device current is read across the 10 Ω sense resistor. Press ▶ Run family to trace Id-vs-Vds for each Vgs — the hardware-faithful M2K curve-tracer procedure (W1 sweep + W2 step + scope XY).',
    // W1 = a Vds ramp; W2 = a steady gate level for the background sim (the Curve Tracer overrides
    // both per step). Opens the Curve Tracer instrument on load.
    w1: { waveType: 'triangle', frequency: 200, amplitude: 2.5, offset: 2.5, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    w2: { waveType: 'sine', frequency: 1000, amplitude: 0, offset: 3, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    tracer: true, xy: true, ch1Vdiv: 1, ch2Vdiv: 0.2,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 12, gy: 4 },   // return (12,6) — its own drawn ground
        { id: 'M1', kind: 'mosfet', gx: 6, gy: 4, part: 'ZVN2110A' }, // drain (8,4) gate (6,5) source (8,6)
        { id: 'W2', kind: 'awg2', gx: 4, gy: 5 },                      // -> gate (steps Vgs); return (4,7)
        { id: 'R1', kind: 'resistor', gx: 8, gy: 6, rotation: 1, value: 10 }, // sense R, source -> gnd
        { id: 'G1', kind: 'ground', gx: 8, gy: 10 },
        { id: 'S1', kind: 'scope1', gx: 8, gy: 2, rotation: 3 }, // 1+ on the drain (X ≈ Vds); 1− (10,2) unwired
        { id: 'S2', kind: 'scope2', gx: 10, gy: 6 }, // 2+ on the source node (Id·Rsense); 2− (10,8) unwired
      ],
      wires: [
        { x1: 8, y1: 4, x2: 10, y2: 4 },  // drain -> right
        { x1: 10, y1: 4, x2: 12, y2: 4 }, // -> W1 (Vds sweep)
        { x1: 4, y1: 5, x2: 6, y2: 5 },   // W2 -> gate (Vgs step)
        { x1: 8, y1: 4, x2: 8, y2: 2 },   // drain -> 1+
        { x1: 8, y1: 8, x2: 8, y2: 10 },  // sense R -> ground
        { x1: 8, y1: 6, x2: 10, y2: 6 },  // source node -> 2+
      ],
    },
  },
  {
    id: 'bjt-curve-family', name: 'BJT curve family (2N3904)', group: 'Amplifiers',
    blurb: 'NPN output characteristics on the Curve Tracer (SWEEP-1). W1 sweeps the collector (Vce); W2 steps the base voltage, which sets the base current Ib through the 100 kΩ base resistor (Ib ≈ (V(W2)−Vbe)/Rb) — the hardware-faithful way to step Ib with no current source. Collector current is read across the 100 Ω emitter sense resistor. Press ▶ Run family.',
    w1: { waveType: 'triangle', frequency: 200, amplitude: 2.5, offset: 2.5, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    w2: { waveType: 'sine', frequency: 1000, amplitude: 0, offset: 2, dutyCycle: 50, samplingRate: 100000, duration: 0.016 },
    tracer: true, xy: true, ch1Vdiv: 1, ch2Vdiv: 0.2,
    schematic: {
      components: [
        { id: 'W1', kind: 'awg1', gx: 12, gy: 4 },   // return (12,6) — its own drawn ground
        { id: 'Q1', kind: 'bjt', gx: 6, gy: 4, part: '2N3904' }, // collector (8,4) base (6,5) emitter (8,6)
        { id: 'W2', kind: 'awg2', gx: 2, gy: 5 },                 // -> Rb -> base (steps Ib); return (2,7)
        { id: 'Rb', kind: 'resistor', gx: 4, gy: 5, value: 100000 }, // base resistor, a (4,5) b (6,5)
        { id: 'R1', kind: 'resistor', gx: 8, gy: 6, rotation: 1, value: 100 }, // emitter sense R -> gnd
        { id: 'G1', kind: 'ground', gx: 8, gy: 10 },
        { id: 'S1', kind: 'scope1', gx: 8, gy: 2, rotation: 3 }, // 1+ on the collector (X ≈ Vce); 1− (10,2) unwired
        { id: 'S2', kind: 'scope2', gx: 10, gy: 6 }, // 2+ on the emitter node (Ic·Rsense); 2− (10,8) unwired
      ],
      wires: [
        { x1: 8, y1: 4, x2: 10, y2: 4 },  // collector -> right
        { x1: 10, y1: 4, x2: 12, y2: 4 }, // -> W1 (Vce sweep)
        { x1: 2, y1: 5, x2: 4, y2: 5 },   // W2 -> Rb.a (Rb.b at (6,5) coincides with the base)
        { x1: 8, y1: 4, x2: 8, y2: 2 },   // collector -> 1+
        { x1: 8, y1: 8, x2: 8, y2: 10 },  // emitter sense R -> ground
        { x1: 8, y1: 6, x2: 10, y2: 6 },  // emitter node -> 2+
      ],
    },
  },
]
