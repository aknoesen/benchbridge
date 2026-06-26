import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { buildNetlist, makeInputSource, type Circuit } from './netlist'

// RC low-pass: fc = 1/(2*pi*R*C) = 1/(2*pi*1k*159.155n) ≈ 1000 Hz.
const rc: Circuit = {
  title: 'RC low-pass (SPICE-2 test)',
  components: [
    { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 0, acMag: 1 },
    { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
    { kind: 'capacitor', id: '1', nodes: ['out', '0'], farads: 159.155e-9 },
    { kind: 'ground', id: '0', node: '0' },
  ],
}

type Complex = { real: number; img: number }

describe('buildNetlist', () => {
  it('emits the expected RC .ac netlist', () => {
    const nl = buildNetlist(rc, { kind: 'ac', sweep: 'dec', points: 20, fStart: 10, fStop: 1e6 })
    expect(nl).toContain('V1 in 0 DC 0 AC 1')
    expect(nl).toContain('R1 in out 1000')
    expect(nl).toContain('C1 out 0 1.59155e-7')
    expect(nl).toContain('.ac dec 20 10 1000000')
    expect(nl.trimEnd().endsWith('.end')).toBe(true)
  })

  it('normalises ground aliases and emits .op / .tran directives', () => {
    const g: Circuit = {
      title: 't',
      components: [
        { kind: 'resistor', id: '1', nodes: ['a', 'gnd'], ohms: 10 },
        { kind: 'ground', id: '0', node: 'gnd' },
      ],
    }
    expect(buildNetlist(g, { kind: 'op' })).toContain('R1 a 0 10')
    expect(buildNetlist(g, { kind: 'op' })).toContain('.op')
    const tnl = buildNetlist(
      { title: 't', components: [makeInputSource('1', 'in', '0', {
        waveType: 'sine', frequency: 1000, amplitude: 1, offset: 0, dutyCycle: 50,
        samplingRate: 100000, duration: 0.016,
      })] },
      { kind: 'tran', step: 1e-5, stop: 1e-2 },
    )
    expect(tnl).toContain('SIN(0 1 1000)')
    expect(tnl).toContain('.tran 0.00001 0.01')
  })

  it('simulates to a -3 dB cutoff near 1000 Hz', async () => {
    const nl = buildNetlist(rc, { kind: 'ac', sweep: 'dec', points: 50, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = await sim.runSim()
    const fi = r.variableNames.findIndex((nm) => nm.toLowerCase() === 'frequency')
    const oi = r.variableNames.findIndex((nm) => nm.toLowerCase().includes('out'))
    const fvals = r.data[fi].values as Complex[]
    const ovals = r.data[oi].values as Complex[]
    const db = ovals.map((c) => 20 * Math.log10(Math.hypot(c.real, c.img)))
    let cutoff: number | null = null
    for (let i = 1; i < db.length; i++) {
      if (db[i - 1] >= -3 && db[i] < -3) {
        cutoff = fvals[i].real
        break
      }
    }
    expect(db[0]).toBeGreaterThan(-0.5) // flat passband
    expect(cutoff).not.toBeNull()
    expect(cutoff as number).toBeGreaterThan(900)
    expect(cutoff as number).toBeLessThan(1100)
  }, 30000)
})
