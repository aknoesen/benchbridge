import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { EXAMPLES } from './examples'
import { toCircuit } from './schematic'
import { buildNetlist } from './netlist'
import { normalizeResult, nodeVoltage } from './spice'
import { schematicExpectation } from './breadboard'

// FB-2: single-ended examples wire 1−/2− to GND and probe the input (2+). The diode/Zener I-V examples
// are deliberately DIFFERENTIAL (CH1 = anode−cathode via 1−), so they are exempt from the 1−@GND rule.
const DIFFERENTIAL = new Set(['diode-iv', 'zener-iv'])

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
