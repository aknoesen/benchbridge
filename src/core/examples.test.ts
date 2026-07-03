import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { EXAMPLES } from './examples'
import { toCircuit } from './schematic'
import { buildNetlist, applyGeneratorParams } from './netlist'
import { normalizeResult, nodeVoltage, sampleNodeTransient } from './spice'
import { schematicExpectation, checkEquivalence, buildHoles } from './breadboard'
import { ledAverageCurrents } from './boardsim'

// FB-2: single-ended examples wire 1−/2− to GND and probe the input (2+). The diode/Zener I-V examples
// are deliberately DIFFERENTIAL (CH1 = anode−cathode via 1−), so they are exempt from the 1−@GND rule.
// QS-4 copy: the flashlight (CH1 across the resistor) and the divider (CH1 across the top R — the
// "same 2.5 V two ways" lesson) are deliberately differential too.
const DIFFERENTIAL = new Set(['diode-iv', 'zener-iv', 'flashlight', 'divider'])

describe('FB-2: examples ground 1−/2− (single-ended) and probe the input', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: nets resolve — CH1 output probe, every port connected`, () => {
      const { warnings, probes } = toCircuit(ex.schematic)
      expect(probes.ch1).toBeDefined()
      // Any added 1−/2−/2+ port that failed to land on its net shows up as a "not connected" warning.
      expect(warnings.filter((w) => /not connected/i.test(w))).toEqual([])
    })

    if (!DIFFERENTIAL.has(ex.id)) {
      it(`${ex.id}: CH1 is single-ended (1− at ground)`, () => {
        expect(toCircuit(ex.schematic).probes.ch1n).toBe('0')
      })
    }

    if (ex.schematic.components.some((c) => c.kind === 'awg1')) {
      it(`${ex.id}: a W1 input node is probed by a scope channel`, () => {
        const { probes } = toCircuit(ex.schematic)
        expect(probes.ch1 === 'in' || probes.ch2 === 'in').toBe(true)
      })
    }
  }
})

describe('Quickstart examples (QS-4 finished copy: flashlight / divider probes / signal-sine)', () => {
  it('flashlight: CH1 differential across the 470 Ω reads ≈3 V (I ≈ 6 mA) at the default +5 V', async () => {
    const ex = EXAMPLES.find((e) => e.id === 'flashlight')!
    const { circuit, warnings, probes } = toCircuit(ex.schematic)
    expect(warnings.filter((w) => /not connected/i.test(w))).toEqual([])
    expect(probes.ch1n).not.toBe('0') // differential — 1− on the R/LED junction
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(circuit, { kind: 'op' }))
    const r = normalizeResult(await sim.runSim())
    const vR = nodeVoltage(r, probes.ch1!) - nodeVoltage(r, probes.ch1n!)
    expect(vR).toBeGreaterThan(2.7)  // ≈ 5 − Vf ≈ 3.2 V across the resistor
    expect(vR).toBeLessThan(3.6)     // → I = V/R ≈ 6–7 mA, the copy's numbers
  }, 30000)

  it('flashlight: ships a pre-built board that passes Check, so the LED is lit on load', () => {
    const ex = EXAMPLES.find((e) => e.id === 'flashlight')!
    expect(ex.board).toBeDefined()
    expect(ex.board!.parts.map((p) => p.id).sort()).toEqual(['D1', 'R1'])
    expect(ex.board!.jumpers.length).toBeGreaterThan(0)
    expect(checkEquivalence(ex.schematic, ex.board!, buildHoles()).ok).toBe(true)
  })

  it('divider: CH1 differential across the top R and CH2 single-ended midpoint (same 2.5 V two ways)', () => {
    const ex = EXAMPLES.find((e) => e.id === 'divider')!
    const { probes } = toCircuit(ex.schematic)
    expect(probes.ch1).toBeDefined()
    expect(probes.ch1n).not.toBe('0')          // differential across R1
    expect(probes.ch2).toBeDefined()
    expect(probes.ch2n ?? '0').toBe('0')       // single-ended across R2
    expect(probes.ch2).toBe(probes.ch1n)       // both land on the midpoint node
  })

  it('signal-sine: one clean trace — W1 to a single-ended CH1 through only the scope-input load', () => {
    const ex = EXAMPLES.find((e) => e.id === 'signal-sine')!
    // the sole passive is the scope's 1 MΩ input impedance, drawn explicitly (no filtering)
    const passives = ex.schematic.components.filter((c) => ['resistor', 'capacitor', 'inductor'].includes(c.kind))
    expect(passives.map((p) => p.value)).toEqual([1e6])
    const { probes } = toCircuit(ex.schematic)
    expect(probes.ch1).toBe('in')  // the W1 node itself
    expect(probes.ch1n).toBe('0')
    expect(probes.ch2).toBeUndefined()
  })
})

describe('TIA-3 photodiode example', () => {
  const ex = EXAMPLES.find((e) => e.id === 'tia-photodiode')!

  it('exists in the Amplifiers group with no W1 source (transimpedance mode works directly)', () => {
    expect(ex).toBeTruthy()
    expect(ex.group).toBe('Amplifiers')
    expect(ex.schematic.components.some((c) => c.kind === 'awg1' || c.kind === 'awg2')).toBe(false)
    expect(ex.schematic.components.some((c) => c.kind === 'photodiode')).toBe(true)
    expect(ex.schematic.components.some((c) => c.kind === 'opamp' && c.part === 'tlv9062')).toBe(true)
  })

  it('single-supply DC operating point: Vout rests above Vref and stays inside 0–5 V under light', async () => {
    const { circuit } = toCircuit(ex.schematic)
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(circuit, { kind: 'op' }))
    const r = normalizeResult(await sim.runSim())
    const vout = nodeVoltage(r, 'out')
    // Vref ≈ 5·1k/(10k+1k) ≈ 0.45 V; Vout = Vref + Iph·Rf ≈ 0.45 + 80µA·33k ≈ 3.09 V.
    expect(vout).toBeGreaterThan(2.4)  // driven UP from Vref (correct photodiode orientation)
    expect(vout).toBeLessThan(3.8)     // …and not railed
    expect(vout).toBeGreaterThan(0.6)  // clearly above Vref (not pinned at the bottom rail)
    expect(vout).toBeLessThan(4.99)    // inside the +5 V rail (not railed high)
  }, 30000)

  it('boards single-supply: the op-amp V− pin Check targets GND, not a −rail', () => {
    const exp = schematicExpectation(ex.schematic)
    const opDip = exp.dips.find((d) => d.id === 'U1')!
    expect(opDip.kind).toBe('opamp-soic-adapter') // TLV9062 SOIC-on-adapter footprint
    expect(opDip.rails?.vnegTo).toBe('GND')       // single-supply → V− pin to GND
  })
})

describe('PWM-LED example (led-pwm — the ARB-2 board-glow demo)', () => {
  const ex = EXAMPLES.find((e) => e.id === 'led-pwm')!

  it('exists in Passive: red LED + 470 Ω current limit, 0–5 V square W1 preset', () => {
    expect(ex).toBeTruthy()
    expect(ex.group).toBe('Passive')
    const led = ex.schematic.components.find((c) => c.kind === 'led')!
    expect(led.value).toBeLessThan(2.0) // red band of ledColor (< 2.0 → #ff4433)
    expect(ex.schematic.components.some((c) => c.kind === 'resistor' && c.value === 470)).toBe(true)
    expect(ex.w1).toMatchObject({ waveType: 'square', amplitude: 2.5, offset: 2.5, dutyCycle: 50 })
  })

  it('end-to-end .tran: LED forward-biased, ~3 mA average at 50 % duty (mid-glow)', async () => {
    const { circuit, warnings } = toCircuit(ex.schematic)
    expect(warnings).toEqual([])
    const ckt = applyGeneratorParams(circuit, ex.w1) // stamp the example's W1 square, as App does
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(ckt, { kind: 'tran', step: 2e-6, stop: 8e-3 }))
    const r = normalizeResult(await sim.runSim())
    const d = ckt.components.find((c) => c.kind === 'diode') as
      { nodes: string[]; is: number; n?: number; rs?: number }
    const iAvg = ledAverageCurrents(
      [{ id: 'D1', anode: d.nodes[0], cathode: d.nodes[1], is: d.is, n: d.n ?? 1, rs: d.rs ?? 0 }],
      ckt, r, 4e-3, // settled back half: 4 whole periods
    ).get('D1')!
    // On-current ≈ (5 − 1.8 V) / (470 + 49.9 AWG out-Z + RS) ≈ 6 mA; 50 % duty → ≈ 3 mA average —
    // squarely mid-glow on ledBrightness's log 0.1–20 mA curve. Reversed LED would read ~0 here.
    expect(iAvg).toBeGreaterThan(2.2e-3)
    expect(iAvg).toBeLessThan(4.2e-3)
  }, 30000)
})

describe('TIA-AC example (tia-ac — time-domain current → voltage)', () => {
  const ex = EXAMPLES.find((e) => e.id === 'tia-ac')!

  it('exists in Amplifiers: OP484, Rin 10 k, Rf 100 k, Cf 100 p, 0.2 V sine W1 preset', () => {
    expect(ex).toBeTruthy()
    expect(ex.group).toBe('Amplifiers')
    expect(ex.schematic.components.some((c) => c.kind === 'opamp' && c.part === 'op484')).toBe(true)
    expect(ex.schematic.components.some((c) => c.kind === 'resistor' && c.value === 10000)).toBe(true)
    expect(ex.schematic.components.some((c) => c.kind === 'resistor' && c.value === 100000)).toBe(true)
    expect(ex.schematic.components.some((c) => c.kind === 'capacitor' && c.value === 100e-12)).toBe(true)
    expect(ex.w1).toMatchObject({ waveType: 'sine', frequency: 1000, amplitude: 0.2, offset: 0 })
  })

  it('end-to-end .tran: inverted ±2 V sine out, gain ≈ 10 = Rf/Rin, centred and not railed', async () => {
    const { circuit, warnings, probes } = toCircuit(ex.schematic)
    expect(warnings).toEqual([])
    expect(probes).toMatchObject({ ch1: 'out', ch1n: '0', ch2: 'in', ch2n: '0' })
    const ckt = applyGeneratorParams(circuit, ex.w1) // stamp the 0.2 V 1 kHz sine, as App does
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(ckt, { kind: 'tran', step: 2e-6, stop: 4e-3 }))
    const r = normalizeResult(await sim.runSim())
    // Sample the settled back half (2–4 ms = 2 whole periods) on a uniform grid.
    const tGrid = Float64Array.from({ length: 400 }, (_, i) => 2e-3 + (i * 2e-3) / 400)
    const out = sampleNodeTransient(r, 'out', tGrid)!
    const vin = sampleNodeTransient(r, 'in', tGrid)!
    const ampOf = (x: Float64Array) => (Math.max(...x) - Math.min(...x)) / 2
    const mid = (x: Float64Array) => (Math.max(...x) + Math.min(...x)) / 2
    // Spec's verified numbers: Vout ±1.99 V, gain 9.98 ≈ Rf/Rin = 10, centred on 0, not railed.
    expect(ampOf(out)).toBeGreaterThan(1.6)
    expect(ampOf(out)).toBeLessThan(2.4)
    expect(Math.abs(mid(out))).toBeLessThan(0.2)
    expect(ampOf(out) / ampOf(vin)).toBeGreaterThan(9)
    expect(ampOf(out) / ampOf(vin)).toBeLessThan(11)
    // Inverted: out and in move opposite ways (negative correlation).
    let dot = 0
    for (let i = 0; i < tGrid.length; i++) dot += out[i] * vin[i]
    expect(dot).toBeLessThan(0)
  }, 30000)
})
