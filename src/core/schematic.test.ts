import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { Schematic, toCircuit, terminalsOf, ampCategory } from './schematic'
import { buildNetlist } from './netlist'
import { normalizeResult, transferFunction } from './spice'

// V(0,0)+ —wire→ R(4,0); R.b(6,0)=C.a(6,0)=probe → out; C.b(8,0)=ground; V.b(2,0)—wire→ground
const rcSchematic: Schematic = {
  components: [
    { id: 'V1', kind: 'vsource', gx: 0, gy: 0 },
    { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
    { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 159.155e-9 },
    { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
    { id: 'P1', kind: 'probe', gx: 6, gy: 0 },
  ],
  wires: [
    { x1: 0, y1: 0, x2: 4, y2: 0 }, // V+ to R.a → 'in'
    { x1: 2, y1: 0, x2: 8, y2: 0 }, // V- to ground → '0'
  ],
}

describe('schematic toCircuit', () => {
  it('converts an RC low-pass to the expected SPICE circuit', () => {
    const { circuit, warnings } = toCircuit(rcSchematic, 'RC')
    expect(warnings).toEqual([])
    const r = circuit.components.find((c) => c.kind === 'resistor' && (c as { ohms: number }).ohms === 1000)!
    const c = circuit.components.find((x) => x.kind === 'capacitor')!
    const v = circuit.components.find((x) => x.kind === 'vsource')!
    expect((r as any).nodes).toEqual(['in', 'out'])
    expect((c as any).nodes).toEqual(['out', '0'])
    expect((v as any).nodes).toEqual(['in', '0'])
  })

  it('simulates the converted circuit to -3 dB near 1 kHz', async () => {
    const { circuit } = toCircuit(rcSchematic, 'RC')
    const nl = buildNetlist(circuit, { kind: 'ac', sweep: 'dec', points: 50, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const tf = transferFunction(normalizeResult(await sim.runSim()), 'out', 'in')
    let cutoff = NaN
    for (let i = 1; i < tf.magDb.length; i++) {
      if (tf.magDb[i - 1] >= -3 && tf.magDb[i] < -3) { cutoff = tf.freq[i]; break }
    }
    expect(cutoff).toBeGreaterThan(900)
    expect(cutoff).toBeLessThan(1100)
  }, 30000)
})

describe('schematic validation', () => {
  it('warns when ground is missing', () => {
    const noGround: Schematic = {
      components: [
        { id: 'V1', kind: 'vsource', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
        { id: 'P1', kind: 'probe', gx: 6, gy: 0 },
      ],
      wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }],
    }
    const { warnings } = toCircuit(noGround)
    expect(warnings.some((w) => w.toLowerCase().includes('ground'))).toBe(true)
  })

  it('warns when the source output is floating', () => {
    const floating: Schematic = {
      components: [
        { id: 'V1', kind: 'vsource', gx: 0, gy: 0 }, // + at (0,0), not wired anywhere
        { id: 'G1', kind: 'ground', gx: 2, gy: 0 },  // wired to V- at (2,0)
        { id: 'R1', kind: 'resistor', gx: 8, gy: 4, value: 1000 },
        { id: 'P1', kind: 'probe', gx: 8, gy: 4 },
      ],
      wires: [],
    }
    const { warnings } = toCircuit(floating)
    expect(warnings.some((w) => w.toLowerCase().includes('not connected'))).toBe(true)
  })
})

describe('breadboard ports (WIRE-1)', () => {
  it('W1 + Scope1 ports build the RC and simulate to ~1 kHz', async () => {
    const sch: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 159.155e-9 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
        { id: 'P1', kind: 'scope1', gx: 6, gy: 0 },
        { id: 'G2', kind: 'ground', gx: 6, gy: 2 }, // 1− → GND (single-ended, Rule 2)
      ],
      wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }], // W1 → R.a → 'in'
    }
    const { circuit, warnings } = toCircuit(sch)
    expect(warnings).toEqual([])
    const r = circuit.components.find((c) => c.kind === 'resistor' && (c as { ohms: number }).ohms === 1000)!
    expect((r as { nodes: string[] }).nodes).toEqual(['in', 'out'])

    const nl = buildNetlist(circuit, { kind: 'ac', sweep: 'dec', points: 50, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const tf = transferFunction(normalizeResult(await sim.runSim()), 'out', 'in')
    let cutoff = NaN
    for (let i = 1; i < tf.magDb.length; i++) {
      if (tf.magDb[i - 1] >= -3 && tf.magDb[i] < -3) { cutoff = tf.freq[i]; break }
    }
    expect(cutoff).toBeGreaterThan(900)
    expect(cutoff).toBeLessThan(1100)
  }, 30000)
})

describe('scope probe mapping (WIRE-3)', () => {
  it('maps 1+ to its node and 2+ to the input it is wired to', () => {
    const sch: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 159.155e-9 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
        { id: 'S1', kind: 'scope1', gx: 6, gy: 0 }, // 1+ on the R-C junction → 'out'
        { id: 'S2', kind: 'scope2', gx: 0, gy: 0 }, // 2+ on the W1 input node → 'in'
        // Rule 2: single-ended reads wire the − explicitly to GND (no auto-ground any more).
        { id: 'G2', kind: 'ground', gx: 6, gy: 2 }, // 1− → GND
        { id: 'G3', kind: 'ground', gx: 0, gy: 2 }, // 2− → GND
      ],
      wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }], // W1 → R.a → 'in'
    }
    const { warnings, probes } = toCircuit(sch)
    expect(warnings).toEqual([])
    expect(probes.ch1).toBe('out')
    expect(probes.ch2).toBe('in')
    expect(probes.ch1n).toBe('0') // single-ended: − on GND
    expect(probes.ch2n).toBe('0')
  })
})

describe('transistor toCircuit (SCH-8)', () => {
  it('maps placed BJT/MOSFET to circuit components with the kit part model', () => {
    const s: Schematic = {
      components: [
        { id: 'Q1', kind: 'bjt', gx: 2, gy: 0, part: '2N3906' },      // c (4,0), b (2,1), e (4,2)
        { id: 'M1', kind: 'mosfet', gx: 6, gy: 0, part: 'ZVN2110A' }, // d (8,0), g (6,1), s (8,2)
        { id: 'G1', kind: 'ground', gx: 0, gy: 4 },
      ],
      wires: [],
    }
    const { circuit } = toCircuit(s)
    const q = circuit.components.find((c) => c.kind === 'bjt') as any
    const m = circuit.components.find((c) => c.kind === 'mosfet') as any
    expect(q.polarity).toBe('pnp')        // 2N3906 is PNP
    expect(q.model).toContain('BF=180')
    expect(m.channel).toBe('nmos')        // ZVN2110A is N-channel
    expect(m.model).toContain('VTO=1.5')
  })
})

import { attachedWireEnds, moveComponentWithWires, rotateComponentWithWires, computeNets } from './schematic'

describe('rubber-band wires (EDIT-1)', () => {
  it('moving a component carries attached wire endpoints by the same delta', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 }],
      wires: [
        { x1: 2, y1: 0, x2: 4, y2: 0 }, // end2 on R.a (4,0)
        { x1: 6, y1: 0, x2: 8, y2: 0 }, // end1 on R.b (6,0)
      ],
    }
    const attached = attachedWireEnds(s, s.components[0])
    expect(attached).toEqual([{ index: 0, end: 2 }, { index: 1, end: 1 }])
    const moved = moveComponentWithWires(s, 'R1', 4, 3, attached) // drag down 3
    expect(moved.components[0]).toMatchObject({ gx: 4, gy: 3 })
    expect(moved.wires[0]).toEqual({ x1: 2, y1: 0, x2: 4, y2: 3 }) // attached end followed
    expect(moved.wires[1]).toEqual({ x1: 6, y1: 3, x2: 8, y2: 0 }) // fixed ends stayed put
  })

  it('rotating a component carries attached endpoints to the rotated terminals; stays connected', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 4, gy: 4, rotation: 0 }],
      wires: [{ x1: 8, y1: 4, x2: 6, y2: 4 }], // end2 on R.b (6,4)
    }
    const r = rotateComponentWithWires(s, 'R1')
    // R.b rotates (6,4) → (4,6); the wire end follows so the connection is preserved
    expect(r.wires[0]).toEqual({ x1: 8, y1: 4, x2: 4, y2: 6 })
    const nets = computeNets(r)
    expect(nets.get('4,6')).toBe(nets.get('8,4'))
  })
})

import { nodeVoltage } from './spice'
import { applyGeneratorParams } from './netlist'

describe('AWG output impedance (49.9 Ohm, R132)', () => {
  it('loading W1 with 49.9 Ohm halves the amplitude', async () => {
    // W1 at (0,0); a 49.9 Ohm load from (0,0) to GND at (2,0). Series R132 (49.9) + load (49.9)
    // form a 2:1 divider, so V(in) = half the source.
    const sch: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 0, gy: 0, value: 49.9 },
        { id: 'G1', kind: 'ground', gx: 2, gy: 0 },
      ],
      wires: [],
    }
    const drawn = toCircuit(sch)
    const ckt = applyGeneratorParams(drawn.circuit, {
      waveType: 'sine', frequency: 1000, amplitude: 0, offset: 1, dutyCycle: 50,
      samplingRate: 100000, duration: 0.016,
    }, undefined)
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(ckt, { kind: 'op' }))
    const r = normalizeResult(await sim.runSim())
    expect(nodeVoltage(r, 'in')).toBeCloseTo(0.5, 2)
  }, 30000)
})

describe('multi-ground (toCircuit)', () => {
  it('every ground symbol normalises to 0', () => {
    const sch: Schematic = {
      components: [
        { id: 'U1', kind: 'opamp', gx: 6, gy: 2 }, // inP(6,2) inN(6,4) out(10,3)
        { id: 'G1', kind: 'ground', gx: 4, gy: 2 }, // wired to inP
        { id: 'G2', kind: 'ground', gx: 8, gy: 9 }, // a SECOND, separate ground
      ],
      wires: [{ x1: 6, y1: 2, x2: 4, y2: 2 }], // inP -> G1
    }
    const d = toCircuit(sch, 't')
    const op = d.circuit.components.find((c) => c.kind === 'opamp') as { nodes: { inP: string } }
    expect(op.nodes.inP).toBe('0') // grounded via G1 even though G2 is the last ground seen
  })
})

describe('op-amp is always a packaged LMC662', () => {
  it('op-amp schematic symbol exposes only inP/inN/out (power implied)', () => {
    const op = terminalsOf({ id: 'U1', kind: 'opamp', gx: 0, gy: 0 })
    expect(op.map((t) => t.name).sort()).toEqual(['inN', 'inP', 'out'])
  })

  it('op-amp netlist is the LMC662 model, auto-powered (no wired rails)', () => {
    const sch: Schematic = { components: [{ id: 'U1', kind: 'opamp', gx: 6, gy: 2 }], wires: [] }
    const op = toCircuit(sch, 't').circuit.components.find((c) => c.kind === 'opamp') as
      { model?: string; nodes: { vpos?: string; vneg?: string } }
    expect(op.model).toBe('lmc662')
    expect(op.nodes.vpos).toBeUndefined()
    expect(op.nodes.vneg).toBeUndefined()
  })

  it('every op-amp / amp is a buildable part', () => {
    expect(ampCategory({ id: 'a', kind: 'opamp', gx: 0, gy: 0 })).toBe('build')
    expect(ampCategory({ id: 'a', kind: 'lmc662', gx: 0, gy: 0 })).toBe('build')
    expect(ampCategory({ id: 'a', kind: 'ina125', gx: 0, gy: 0 })).toBe('build')
    expect(ampCategory({ id: 'a', kind: 'resistor', gx: 0, gy: 0 })).toBeNull()
  })
})

describe('LMC662 dual DIP (toCircuit)', () => {
  it('expands to two LMC662 sections sharing the V+/V- rails', () => {
    const sch: Schematic = {
      components: [
        { id: 'U1', kind: 'lmc662', gx: 10, gy: 4 },
        { id: 'G1', kind: 'ground', gx: 8, gy: 6 },
      ],
      wires: [{ x1: 10, y1: 6, x2: 8, y2: 6 }],
    }
    const d = toCircuit(sch, 'dip')
    const ops = d.circuit.components.filter((c) => c.kind === 'opamp') as
      Array<{ id: string; model?: string; nodes: { vpos?: string; vneg?: string } }>
    expect(ops.length).toBe(2)
    expect(ops.every((o) => o.model === 'lmc662')).toBe(true)
    expect(ops[0].nodes.vpos).toBe(ops[1].nodes.vpos)
    expect(ops[0].nodes.vneg).toBe(ops[1].nodes.vneg)
    expect(ops[0].nodes.vpos).not.toBe(ops[0].nodes.vneg)
  })
})

import { moveComponentsBy } from './schematic'
describe('moveComponentsBy (group drag)', () => {
  it('translates selected parts and their attached wire ends; stretches links to non-selected', () => {
    const s: Schematic = {
      components: [
        { id: 'R1', kind: 'resistor', gx: 2, gy: 2, value: 1 },
        { id: 'R2', kind: 'resistor', gx: 6, gy: 2, value: 1 },
      ],
      wires: [
        { x1: 4, y1: 2, x2: 6, y2: 2 }, // R1.b -> R2.a (both selected)
        { x1: 8, y1: 2, x2: 12, y2: 2 }, // R2.b -> external (only R2 selected)
      ],
    }
    const out = moveComponentsBy(s, new Set(['R1', 'R2']), 0, 3)
    expect(out.components.find((c) => c.id === 'R1')!.gy).toBe(5)
    expect(out.components.find((c) => c.id === 'R2')!.gy).toBe(5)
    expect(out.wires[0]).toEqual({ x1: 4, y1: 5, x2: 6, y2: 5 })
    expect(out.wires[1]).toEqual({ x1: 8, y1: 5, x2: 12, y2: 2 }) // stretched
  })
})

import { moveSelectionBy } from './schematic'
describe('moveSelectionBy (box group move incl. loose wires)', () => {
  it('moves listed wire ends (loose segments) and terminal-attached ends', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 2, gy: 2, value: 1 }],
      wires: [
        { x1: 10, y1: 10, x2: 14, y2: 10 }, // loose wire, both ends boxed
        { x1: 2, y1: 2, x2: 5, y2: 2 }, // one end on R1.a, far end not boxed
      ],
    }
    const out = moveSelectionBy(s, new Set(['R1']), new Set(['0:1', '0:2']), 0, 3)
    expect(out.wires[0]).toEqual({ x1: 10, y1: 13, x2: 14, y2: 13 }) // loose wire moved whole
    expect(out.wires[1]).toEqual({ x1: 2, y1: 5, x2: 5, y2: 2 }) // R1 end follows, far end stays
    expect(out.components[0].gy).toBe(5)
  })
})

import { bridgeWiresForMove, deleteComponentsWithWires } from './schematic' // (moveComponentWithWires/attachedWireEnds/computeNets already imported above)
describe('touch-connections rubber-band into a wire on move (no silent break)', () => {
  // R1.b and R2.a touch at (6,2) with NO wire between them.
  const base: Schematic = {
    components: [
      { id: 'R1', kind: 'resistor', gx: 2, gy: 2, value: 1 }, // a=(2,2) b=(4,2)
      { id: 'R2', kind: 'resistor', gx: 4, gy: 2, value: 1 }, // a=(4,2) b=(6,2)
      { id: 'R3', kind: 'resistor', gx: 6, gy: 2, value: 1 }, // a=(6,2) b=(8,2) — touches R2.b
    ],
    wires: [],
  }
  const net = (s: Schematic, x: number, y: number) => computeNets(s).get(`${x},${y}`)

  it('dragging R3 keeps it tied to R2 via an auto-inserted wire', () => {
    const att = attachedWireEnds(base, base.components.find((c) => c.id === 'R3')!)
    const out = moveComponentWithWires(base, 'R3', 6, 8, att) // drag down by 6
    expect(out.wires.length).toBe(1) // one bridge wire appeared
    expect(net(out, 6, 2)).toBe(net(out, 6, 8)) // R2.b still connected to R3.a's new spot
  })

  it('bridgeWiresForMove only bridges to stationary (non-moved) terminals', () => {
    // Moving R2 and R3 together: their shared (6,2) touch is internal, but R2.a@(4,2) touches the
    // stationary R1.b → exactly one bridge.
    const b = bridgeWiresForMove(base, new Set(['R2', 'R3']), 0, 6)
    expect(b).toEqual([{ x1: 4, y1: 2, x2: 4, y2: 8 }])
  })

  it('a zero move adds no wire', () => {
    expect(bridgeWiresForMove(base, new Set(['R3']), 0, 0)).toEqual([])
  })
})

describe('deleteComponentsWithWires', () => {
  // Voltage divider: W1 —w0→ R1(4,0..6,0) —w1→ R2(8,0..10,0) —w2→ GND, probe wired to the midpoint.
  const divider: Schematic = {
    components: [
      { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
      { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
      { id: 'R2', kind: 'resistor', gx: 8, gy: 0, value: 1000 },
      { id: 'G1', kind: 'ground', gx: 12, gy: 0 },
      { id: 'P1', kind: 'scope1', gx: 6, gy: 4 },
    ],
    wires: [
      { x1: 0, y1: 0, x2: 4, y2: 0 },  // w0: W1 → R1.a
      { x1: 6, y1: 0, x2: 8, y2: 0 },  // w1: R1.b → R2.a (midpoint)
      { x1: 10, y1: 0, x2: 12, y2: 0 },// w2: R2.b → GND
      { x1: 6, y1: 0, x2: 6, y2: 4 },  // w3: midpoint → probe
    ],
  }

  it('deleting a resistor takes its hookup wires, keeps the rest', () => {
    const out = deleteComponentsWithWires(divider, new Set(['R1']))
    expect(out.components.map((c) => c.id)).toEqual(['W1', 'R2', 'G1', 'P1'])
    // w0, w1, w3 all had an endpoint on an R1 pin ((4,0) or (6,0)) → gone. Only R2→GND survives.
    expect(out.wires).toEqual([{ x1: 10, y1: 0, x2: 12, y2: 0 }])
  })

  it('keeps a junction wire serving two surviving parts', () => {
    // Delete R2: w1 (R2.a) and w2 (R2.b) go. w3 midpoint→probe survives because its (6,0) end sits
    // on R1.b, a surviving terminal. w0 untouched.
    const out = deleteComponentsWithWires(divider, new Set(['R2']))
    expect(out.wires).toEqual([
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 6, y1: 0, x2: 6, y2: 4 },
    ])
  })

  it('cascades along a multi-segment route but stops at a live junction', () => {
    // R1(0,0..2,0) —a→(4,0) —b→(4,4) bend, and (4,0) —c→ R2.a(6,0): deleting R1 removes a; at the
    // freed (4,0) two survivors (b, c) still meet → both stay (they join the probe stub to R2).
    const sch: Schematic = {
      components: [
        { id: 'R1', kind: 'resistor', gx: 0, gy: 0, value: 1000 },
        { id: 'R2', kind: 'resistor', gx: 6, gy: 0, value: 1000 },
      ],
      wires: [
        { x1: 2, y1: 0, x2: 4, y2: 0 }, // a: R1.b → junction
        { x1: 4, y1: 0, x2: 4, y2: 4 }, // b: junction → elsewhere
        { x1: 4, y1: 0, x2: 6, y2: 0 }, // c: junction → R2.a
      ],
    }
    const out = deleteComponentsWithWires(sch, new Set(['R1']))
    expect(out.wires).toEqual([
      { x1: 4, y1: 0, x2: 4, y2: 4 },
      { x1: 4, y1: 0, x2: 6, y2: 0 },
    ])
    // …but with segment c absent, b is a dead chain hanging off a → both a and b are pruned.
    const noC: Schematic = { components: sch.components, wires: sch.wires.slice(0, 2) }
    const out2 = deleteComponentsWithWires(noC, new Set(['R1']))
    expect(out2.wires).toEqual([])
  })

  it('spares a wire on a touch-connection shared with a survivor', () => {
    // R1.b and R2.a share (2,0) as a touch connection; a wire from (2,0) feeds a probe. Deleting R1
    // must NOT remove that wire — it still serves R2.
    const sch: Schematic = {
      components: [
        { id: 'R1', kind: 'resistor', gx: 0, gy: 0, value: 1000 },
        { id: 'R2', kind: 'resistor', gx: 2, gy: 0, value: 1000 },
        { id: 'P1', kind: 'scope1', gx: 2, gy: 4 },
      ],
      wires: [{ x1: 2, y1: 0, x2: 2, y2: 4 }],
    }
    const out = deleteComponentsWithWires(sch, new Set(['R1']))
    expect(out.wires).toEqual([{ x1: 2, y1: 0, x2: 2, y2: 4 }])
  })

  it('multi-delete removes both parts, their wires, and explicitly selected wires', () => {
    const out = deleteComponentsWithWires(divider, new Set(['R1', 'R2']), new Set([0]))
    expect(out.components.map((c) => c.id)).toEqual(['W1', 'G1', 'P1'])
    expect(out.wires).toEqual([])
  })
})

import { localTerminals, mirrorComponentWithWires, canMirror, orthoRoute } from './schematic'

describe('orthoRoute (pin-magnetic wiring, SCH-11 P3 Stage 3)', () => {
  it('routes horizontal-first with one bend; collinear gives one segment; same point none', () => {
    expect(orthoRoute({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual([
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 4, y1: 0, x2: 4, y2: 2 },
    ])
    expect(orthoRoute({ x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([{ x1: 0, y1: 0, x2: 4, y2: 0 }])
    expect(orthoRoute({ x: 2, y: 3 }, { x: 2, y: 7 })).toEqual([{ x1: 2, y1: 3, x2: 2, y2: 7 }])
    expect(orthoRoute({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([])
  })

  it('committed route electrically connects the two pins', () => {
    const s: Schematic = {
      components: [
        { id: 'R1', kind: 'resistor', gx: 0, gy: 0, value: 1000 },
        { id: 'R2', kind: 'resistor', gx: 6, gy: 4, value: 1000 },
      ],
      wires: [...orthoRoute({ x: 2, y: 0 }, { x: 6, y: 4 })], // R1.b → R2.a, one bend
    }
    const nets = computeNets(s)
    expect(nets.get('2,0')).toBe(nets.get('6,4'))
  })
})

describe('model-space mirror (SCH-11 P3 Stage 2)', () => {
  it('mirrors base offsets across the footprint centerline — terminals swap in place', () => {
    // resistor: a(0,0) ↔ b(2,0); footprint unchanged, part does not translate
    expect(localTerminals({ kind: 'resistor', mirror: true }).map((t) => [t.name, t.gx, t.gy]))
      .toEqual([['a', 2, 0], ['b', 0, 0]])
    // bjt (mirror line x=1): base crosses to the right, collector/emitter to the left
    expect(localTerminals({ kind: 'bjt', mirror: true }).map((t) => [t.name, t.gx, t.gy]))
      .toEqual([['c', 0, 0], ['b', 2, 1], ['e', 0, 2]])
    // opamp (mirror line x=2): inputs land on the right, output on the left
    expect(localTerminals({ kind: 'opamp', mirror: true }).map((t) => [t.name, t.gx, t.gy]))
      .toEqual([['inP', 4, 0], ['inN', 4, 2], ['out', 0, 1]])
    // single-pin parts mirror to themselves
    expect(localTerminals({ kind: 'ground', mirror: true })).toEqual(localTerminals({ kind: 'ground' }))
  })

  it('mirror composes BEFORE rotation in terminalsOf', () => {
    const q: SchComponent = { id: 'Q1', kind: 'bjt', gx: 4, gy: 4, rotation: 1, mirror: true }
    // mirrored offsets c(0,0) b(2,1) e(0,2), then rotated CW: (dx,dy)→(−dy,dx)
    expect(terminalsOf(q).map((t) => [t.name, t.gx, t.gy]))
      .toEqual([['c', 4, 4], ['b', 3, 6], ['e', 2, 4]])
  })

  it('canMirror: multi-pin catalog parts yes; single-pin ports and the inline INA125 no', () => {
    expect(canMirror('resistor')).toBe(true)
    expect(canMirror('opamp')).toBe(true)
    expect(canMirror('lmc662')).toBe(true)
    expect(canMirror('ina125')).toBe(false) // inline render does not honour mirror
    expect(canMirror('ground')).toBe(false)
    expect(canMirror('awg1')).toBe(true) // two-terminal instrument (SCH-11) — mirrorable like any bipole
    // and the model op refuses rather than silently lying about pin positions
    const s: Schematic = { components: [{ id: 'U1', kind: 'ina125', gx: 0, gy: 0 }], wires: [] }
    expect(mirrorComponentWithWires(s, 'U1')).toBe(s)
  })

  it('carries terminal-attached wire endpoints to the mirrored terminals; stays connected', () => {
    const s: Schematic = {
      components: [{ id: 'U1', kind: 'opamp', gx: 0, gy: 0 }],
      wires: [{ x1: 4, y1: 1, x2: 8, y2: 1 }], // end1 on out (4,1)
    }
    const m = mirrorComponentWithWires(s, 'U1')
    // out moves (4,1) → (0,1); the wire end follows so the connection is preserved
    expect(m.wires[0]).toEqual({ x1: 0, y1: 1, x2: 8, y2: 1 })
    const nets = computeNets(m)
    expect(nets.get('0,1')).toBe(nets.get('8,1'))
  })

  it('flipping twice is the identity (terminals, wires, and serialized component)', () => {
    const s: Schematic = {
      components: [{ id: 'Q1', kind: 'bjt', gx: 2, gy: 2, rotation: 3, part: '2N3904' }],
      wires: [{ x1: 3, y1: 2, x2: 0, y2: 3 }], // end1 on the rotated base pin (3,2)
    }
    const twice = mirrorComponentWithWires(mirrorComponentWithWires(s, 'Q1'), 'Q1')
    expect(terminalsOf(twice.components[0])).toEqual(terminalsOf(s.components[0]))
    expect(twice.wires).toEqual(s.wires)
    // mirror clears back to undefined so a round-tripped part serializes like the original
    expect(twice.components[0].mirror).toBeUndefined()
  })
})

import { SINGLETON_KINDS, hasKind, migrateSchematic, type SchComponent } from './schematic'

describe('INST-1: scope − is a designer choice, never auto-grounded (Rule 2)', () => {
  // W1 → R1 → GND; scope1 + sits on the W1/R input node. `extra` lets a test wire the − lead.
  const base = (extra: SchComponent[] = [], moreWires: { x1: number; y1: number; x2: number; y2: number }[] = []): Schematic => ({
    components: [
      { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
      { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 }, // a(4,0) b(6,0)
      { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
      { id: 'S1', kind: 'scope1', gx: 4, gy: 0 }, // + at (4,0), − at (4,2)
      ...extra,
    ],
    wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }, { x1: 6, y1: 0, x2: 8, y2: 0 }, ...moreWires],
  })

  it('unwired − → channel incomplete: no inferred ground, no ref, warned', () => {
    const { probes, warnings } = toCircuit(base())
    expect(probes.ch1).toBeDefined()
    expect(probes.ch1n).toBeUndefined()      // NOT silently referenced to ground
    expect(probes.ch1Incomplete).toBe(true)
    expect(warnings.some((w) => /CH1 . is unconnected/.test(w))).toBe(true)
  })

  it('− wired to GND → single-ended: ch1n = node 0, complete, no warning', () => {
    const { probes, warnings } = toCircuit(base([{ id: 'G2', kind: 'ground', gx: 4, gy: 2 }]))
    expect(probes.ch1n).toBe('0')
    expect(probes.ch1Incomplete).toBe(false)
    expect(warnings.some((w) => /CH1 . is unconnected/.test(w))).toBe(false)
  })

  it('− wired to a node → differential: ch1n is that node, not 0, complete', () => {
    // Two series resistors; the − lands on the midpoint node (not ground) → differential.
    const sch: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'R1', kind: 'resistor', gx: 2, gy: 0, value: 1000 }, // a(2,0) b(4,0)
        { id: 'R2', kind: 'resistor', gx: 4, gy: 0, value: 1000 }, // a(4,0) b(6,0)
        { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
        { id: 'S1', kind: 'scope1', gx: 2, gy: 0 }, // + at (2,0)=R1.a, − at (2,2)
      ],
      wires: [
        { x1: 0, y1: 0, x2: 2, y2: 0 }, // W1 → R1.a
        { x1: 6, y1: 0, x2: 8, y2: 0 }, // R2.b → ground
        { x1: 2, y1: 2, x2: 4, y2: 0 }, // S1− → the R1/R2 midpoint (a node, NOT ground)
      ],
    }
    const { probes } = toCircuit(sch)
    expect(probes.ch1n).toBeDefined()
    expect(probes.ch1n).not.toBe('0')
    expect(probes.ch1Incomplete).toBe(false)
  })
})

describe('INST-1: M2K I/O are singletons (Rule 3)', () => {
  it('SINGLETON_KINDS is the six I/O; GND is repeatable', () => {
    for (const k of ['scope1', 'scope2', 'awg1', 'awg2', 'vplus', 'vminus'] as SchComponent['kind'][]) {
      expect(SINGLETON_KINDS.has(k)).toBe(true)
    }
    expect(SINGLETON_KINDS.has('ground')).toBe(false)
  })

  it('hasKind detects a placed kind', () => {
    const s: Schematic = { components: [{ id: 'W1', kind: 'awg1', gx: 0, gy: 0 }], wires: [] }
    expect(hasKind(s, 'awg1')).toBe(true)
    expect(hasKind(s, 'awg2')).toBe(false)
  })

  it('migrateSchematic keeps the first of a duplicated singleton, drops extras, GND repeatable', () => {
    const s: Schematic = {
      components: [
        { id: 'W1a', kind: 'awg1', gx: 0, gy: 0 },
        { id: 'W1b', kind: 'awg1', gx: 4, gy: 0 }, // duplicate CH — dropped
        { id: 'Ga', kind: 'ground', gx: 2, gy: 2 },
        { id: 'Gb', kind: 'ground', gx: 6, gy: 2 }, // second ground — kept (repeatable)
      ],
      wires: [],
    }
    const m = migrateSchematic(s)
    const w = m.components.filter((c) => c.kind === 'awg1')
    expect(w).toHaveLength(1)
    expect(w[0].id).toBe('W1a') // the first one is kept
    expect(m.components.filter((c) => c.kind === 'ground')).toHaveLength(2)
  })
})

import { clampMoveTarget, rotateComponentInBounds, clampAllInBounds } from './schematic'

describe('SCH-14: parts stay on the (scroll-free) canvas', () => {
  it('clampMoveTarget keeps the whole part on-canvas at every edge', () => {
    const c: SchComponent = { id: 'R1', kind: 'resistor', gx: 0, gy: 0, value: 1000 } // terminals (0,0),(2,0)
    expect(clampMoveTarget(c, -5, 3, 10, 10).gx).toBe(0)   // left edge
    expect(clampMoveTarget(c, 9, 3, 10, 10).gx).toBe(8)    // right: maxx (gx+2) must be ≤ 10
    expect(clampMoveTarget(c, 3, -5, 10, 10).gy).toBe(0)   // top edge
    expect(clampMoveTarget(c, 3, 12, 10, 10).gy).toBe(10)  // bottom edge
    expect(clampMoveTarget(c, 4, 4, 10, 10)).toEqual({ gx: 4, gy: 4 }) // in-bounds → unchanged
  })

  it('rotating a part near the corner never pushes a terminal off-canvas (4 turns)', () => {
    let s: Schematic = { components: [{ id: 'R1', kind: 'resistor', gx: 8, gy: 8, value: 1000 }], wires: [] }
    for (let i = 0; i < 4; i++) {
      s = rotateComponentInBounds(s, 'R1', 10, 10)
      for (const t of terminalsOf(s.components[0])) {
        expect(t.gx).toBeGreaterThanOrEqual(0); expect(t.gx).toBeLessThanOrEqual(10)
        expect(t.gy).toBeGreaterThanOrEqual(0); expect(t.gy).toBeLessThanOrEqual(10)
      }
    }
  })

  it('clampAllInBounds pulls an off-canvas part and its attached wire back into view', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: -3, gy: 2, value: 1000 }], // terminals (-3,2),(-1,2)
      wires: [{ x1: -3, y1: 2, x2: -6, y2: 2 }], // wire endpoint on R1.a
    }
    const r = clampAllInBounds(s, 10, 10)
    for (const t of terminalsOf(r.components[0])) {
      expect(t.gx).toBeGreaterThanOrEqual(0); expect(t.gy).toBeGreaterThanOrEqual(0)
    }
    expect(r.wires[0].x1).toBe(0) // the attached endpoint followed the part in (−3 → 0)
  })

  it('clampAllInBounds is a no-op (same object) when everything is on-canvas', () => {
    const s: Schematic = { components: [{ id: 'R1', kind: 'resistor', gx: 2, gy: 2, value: 1000 }], wires: [] }
    expect(clampAllInBounds(s, 10, 10)).toBe(s)
  })

  // FIT-1: why the editor no longer runs this on mount/open. Clamping into a box SMALLER than the
  // drawing does not translate the circuit, it SHEARS it — each part is pulled in independently, so
  // parts land on top of each other and separate nets merge. The editor used to do exactly this with
  // the mounting pane's height, which in the short stacked Board pane silently rewired every example
  // (rc-lp 6 nets → 4) and autosaved the damage. The viewport frames the drawing now; nothing clamps
  // it. Do not re-wire this to a load path.
  it('clampAllInBounds SHEARS a circuit when the box is smaller than the drawing (nets merge)', () => {
    const s: Schematic = {
      components: [
        { id: 'W1', kind: 'awg1', gx: 2, gy: 4 },
        { id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 1500 },
        { id: 'C1', kind: 'capacitor', gx: 6, gy: 4, rotation: 1, value: 1e-7 },
        { id: 'G1', kind: 'ground', gx: 6, gy: 8 },
      ],
      wires: [{ x1: 2, y1: 4, x2: 4, y2: 4 }, { x1: 6, y1: 6, x2: 6, y2: 8 }],
    }
    const nets = (x: Schematic) => new Set(computeNets(x).values()).size
    const squashed = clampAllInBounds(s, 40, 4) // the short Board pane: only 4 grid rows
    expect(nets(squashed)).toBeLessThan(nets(s)) // the circuit is NOT the one the student drew
  })
})

import { rerouteAttachedWires } from './schematic'
import { EXAMPLES } from './examples'

// DRAG-1: a mouse drag is many mousemoves. The editor MUST apply each one from the schematic as it
// was at mousedown, never incrementally from the previous frame: moveComponentWithWires turns a
// touch-connection into a real bridge wire, and that new wire is not in the `attached` list captured
// at mousedown — so an incremental drag leaves the bridge behind after the first step and the part
// sails away disconnected. This replays the editor's loop both ways and locks the correct one.
describe('DRAG-1: a multi-step drag keeps its connections (the "severed ground" bug)', () => {
  const rc = EXAMPLES.find((e) => e.id === 'rc-lp')!.schematic

  // Is the scope CH1 minus on the same net as some ground symbol?
  const minusGrounded = (s: Schematic): boolean => {
    const nets = computeNets(s)
    const p = s.components.find((c) => c.kind === 'scope1')!
    const nMinus = nets.get(`${terminalsOf(p)[1].gx},${terminalsOf(p)[1].gy}`)
    return s.components.filter((c) => c.kind === 'ground')
      .some((g) => nets.get(`${terminalsOf(g)[0].gx},${terminalsOf(g)[0].gy}`) === nMinus)
  }
  // The editor's drag: `attached` captured once at mousedown, every move applied to `base`.
  const dragFromBase = (base: Schematic, id: string, path: [number, number][]): Schematic => {
    const attached = attachedWireEnds(base, base.components.find((c) => c.id === id)!)
    let s = base
    for (const [gx, gy] of path) s = moveComponentWithWires(base, id, gx, gy, attached)
    return s
  }

  it('rc-lp starts with 1− grounded by a touch-connection (G2 sits on the − pin, no wire)', () => {
    expect(rc.wires.some((w) => (w.x1 === 8 && w.y1 === 6) || (w.x2 === 8 && w.y2 === 6))).toBe(false)
    expect(minusGrounded(rc)).toBe(true)
  })

  it('dragging that ground away over MANY steps keeps 1− grounded (bridges into a real wire)', () => {
    const s = dragFromBase(rc, 'G2', [[8, 7], [7, 8], [6, 9], [5, 10]]) // a real mouse path
    expect(minusGrounded(s)).toBe(true)
    expect(s.wires).toContainEqual({ x1: 8, y1: 6, x2: 5, y2: 10 }) // ONE bridge, the full delta
  })

  it('the old incremental drag severed it — the regression this locks out', () => {
    let s = rc
    const attached = attachedWireEnds(rc, rc.components.find((c) => c.id === 'G2')!)
    for (const [gx, gy] of [[8, 7], [7, 8], [6, 9], [5, 10]] as [number, number][]) {
      s = moveComponentWithWires(s, 'G2', gx, gy, attached) // applied to the CURRENT state — wrong
    }
    expect(minusGrounded(s)).toBe(false)      // ← the reported bug
    expect(s.wires).toContainEqual({ x1: 8, y1: 6, x2: 8, y2: 7 }) // the stranded one-cell stub
  })

  it('a group drag keeps its connections over many steps too', () => {
    const ids = new Set(['G2'])
    const path: [number, number][] = [[1, 1], [2, 2], [3, 3], [-3, 4]] // cumulative deltas
    let s = rc
    for (const [dx, dy] of path) s = moveSelectionBy(rc, ids, new Set(), dx, dy) // always from base
    expect(minusGrounded(s)).toBe(true)
  })
})

import { moveWireEnd, moveWireBy, wireEndsAt } from './schematic'

// SCH-16: re-route a connection without deleting it.
describe('SCH-16: wire endpoint + segment drag', () => {
  //  W1(0,0)--(4,0)R1.a  R1.b(6,0)--(8,0)  ; a wire from R1.b to a probe at (8,0)
  const base: Schematic = {
    components: [
      { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
      { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 }, // a(4,0) b(6,0)
      { id: 'G1', kind: 'ground', gx: 8, gy: 4 },
    ],
    wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }],
  }

  it('wireEndsAt finds the ends the editor can grab', () => {
    expect(wireEndsAt(base, 0, 0)).toEqual([{ index: 0, end: 1 }])
    expect(wireEndsAt(base, 4, 0)).toEqual([{ index: 0, end: 2 }])
    expect(wireEndsAt(base, 2, 0)).toEqual([]) // mid-segment is a body grab, not an end
  })

  it('endpoint drag re-attaches one end and re-nets the circuit (no delete-and-redraw)', () => {
    const before = computeNets(base)
    expect(before.get('0,0')).toBe(before.get('4,0')) // W1.out and R1.a share a net
    const s = moveWireEnd(base, 0, 2, 8, 4)           // drag the R1.a end onto the ground
    const after = computeNets(s)
    expect(after.get('0,0')).toBe(after.get('8,4'))   // now W1.out is tied to GND…
    expect(after.get('0,0')).not.toBe(after.get('4,0')) // …and no longer to R1.a
    expect(s.wires).toHaveLength(1)                   // still ONE wire — it moved, it didn't multiply
  })

  it('endpoint drag refuses to collapse a wire to zero length', () => {
    expect(moveWireEnd(base, 0, 2, 0, 0)).toBe(base)
  })

  it('segment drag slides the run and BRIDGES the ends that were on pins (connection survives)', () => {
    const s = moveWireBy(base, 0, 0, 3) // slide the whole W1→R1 wire down 3 cells
    const nets = computeNets(s)
    expect(nets.get('0,0')).toBe(nets.get('4,0')) // W1.out ↔ R1.a still one node
    expect(s.wires[0]).toEqual({ x1: 0, y1: 3, x2: 4, y2: 3 }) // the run itself moved…
    // …and both pin ends grew an orthogonal stub down to it
    expect(s.wires).toContainEqual({ x1: 0, y1: 0, x2: 0, y2: 3 })
    expect(s.wires).toContainEqual({ x1: 4, y1: 0, x2: 4, y2: 3 })
  })

  it('segment drag of a wire touching no pin just moves it (nothing to bridge)', () => {
    const free: Schematic = { components: [], wires: [{ x1: 1, y1: 1, x2: 3, y2: 1 }] }
    const s = moveWireBy(free, 0, 2, 2)
    expect(s.wires).toEqual([{ x1: 3, y1: 3, x2: 5, y2: 3 }])
  })

  it('a zero delta is a no-op (a click on a wire must not mutate the drawing)', () => {
    expect(moveWireBy(base, 0, 0, 0)).toBe(base)
  })
})

describe('SCH-15: attached wires re-route orthogonally on move (core, testable half)', () => {
  it('replaces a diagonal attached wire with an orthogonal L, keeping the connection', () => {
    // post-move state: the wire's R1 end sits on R1.a (4,4); its far end (0,0) stayed → diagonal.
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 1000 }], // a(4,4) b(6,4)
      wires: [{ x1: 0, y1: 0, x2: 4, y2: 4 }],
    }
    const r = rerouteAttachedWires(s, new Set(['R1']))
    expect(r.wires).toHaveLength(2)                         // one L = two segments
    for (const w of r.wires) expect(w.x1 === w.x2 || w.y1 === w.y2).toBe(true) // each axis-aligned
    // both original endpoints survive → the R1 terminal and the far end stay connected
    const nets = computeNets(r)
    expect(nets.get(keyOf(0, 0))).toBe(nets.get(keyOf(4, 4)))
  })

  it('leaves an already-orthogonal wire and a fully-translated wire alone (same reference)', () => {
    const s: Schematic = {
      components: [{ id: 'R1', kind: 'resistor', gx: 4, gy: 4, value: 1000 }],
      wires: [
        { x1: 0, y1: 4, x2: 4, y2: 4 }, // horizontal into R1.a — already orthogonal
        { x1: 4, y1: 4, x2: 6, y2: 4 }, // both ends on R1 terminals → translated straight
      ],
    }
    expect(rerouteAttachedWires(s, new Set(['R1']))).toBe(s)
  })
})

function keyOf(x: number, y: number): string { return `${x},${y}` }
