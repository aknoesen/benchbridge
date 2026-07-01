import { describe, it, expect, beforeAll } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { buildNetlist, type Circuit } from './netlist'
import { normalizeResult } from './spice'
import {
  opampList, getOpamp, isKitOpamp, buildOpampSubckt, type OpampKind,
} from './opamps'

describe('catalog', () => {
  it('has the 5 verified kit op-amps + the TLV9062 course part with the spec params', () => {
    expect(opampList().map((p) => p.kind)).toEqual([
      'op27', 'op37', 'op97', 'op482', 'op484', 'tlv9062',
    ])
    expect(getOpamp('op27').gbwHz).toBe(8e6)
    expect(getOpamp('op37').gbwHz).toBe(63e6)
    expect(getOpamp('op37').note).toMatch(/gain ≥ 5/)
    expect(getOpamp('op484').railToRailOut).toBe(true)
    expect(getOpamp('op484').outputHeadroom).toBeLessThan(0.1)
    expect(getOpamp('op27').railToRailOut).toBe(false)
    expect(getOpamp('op27').outputHeadroom).toBeGreaterThan(1)
    expect(getOpamp('op484').supplyMin).toBe(3)
    // the 5 kit op-amps are all DIPs; the TLV9062 is the one SOIC-8 (course part)
    expect(opampList().filter((p) => p.origin === 'kit').every((p) => p.package === '8-DIP' || p.package === '14-DIP')).toBe(true)
  })

  it('TLV9062 (TIA-0): course part, SOIC-8, dual RRIO, single +5 V default within its 5.5 V max', () => {
    const t = getOpamp('tlv9062')
    expect(t.origin).toBe('course')
    expect(t.package).toBe('8-SOIC')
    expect(t.channels).toBe(2)
    expect(t.gbwHz).toBe(10e6)
    expect(t.slewRate).toBe(6.5)
    expect(t.supplyMax).toBe(5.5)
    expect(t.railToRailIn && t.railToRailOut).toBe(true)
    expect(t.supplyDefault).toEqual({ vcc: 5, vee: 0 }) // single +5 V, not ±5 (10 V > 5.5 max)
    expect(t.supplyDefault!.vcc - t.supplyDefault!.vee).toBeLessThanOrEqual(t.supplyMax)
  })

  it('the 5 kit op-amps default to the ±5 V rails (no supplyDefault override)', () => {
    for (const p of opampList().filter((x) => x.origin === 'kit')) expect(p.supplyDefault).toBeUndefined()
  })

  it('isKitOpamp accepts kit + course parts, rejects off-kit', () => {
    expect(isKitOpamp('op484')).toBe(true)
    expect(isKitOpamp('tlv9062')).toBe(true) // course part lives in the catalog too
    expect(isKitOpamp('adtl082')).toBe(false) // removed in F-4
    expect(isKitOpamp('lmc662')).toBe(false)
    expect(isKitOpamp('not-a-part')).toBe(false)
  })

  it('buildOpampSubckt emits a well-formed .subckt … .ends with a rail-referenced clamp', () => {
    const s = buildOpampSubckt(getOpamp('op27'))
    expect(s.split('\n')[0]).toBe('.subckt op27 inp inn vcc vee out')
    expect(s.trimEnd().endsWith('.ends')).toBe(true)
    expect(s).toContain('V(vcc)')
    expect(s).toContain('V(vee)')
    expect(s).toMatch(/Bg 0 no I =/)
  })
})

// End-to-end (mirror SWEEP-1): drive an inverting gain-−10 stage through the real engine and confirm
// the closed-loop gain is right, and that a non-RR part clips short of the rail while a RR part
// swings to it.
describe('op-amp macromodel (engine)', () => {
  let sim: Simulation
  beforeAll(async () => { sim = new Simulation(); await sim.start() })

  // Inverting amp: Rin=1k (in→inn), Rf=10k (inn→out), inP=gnd → gain −10. ±5 V auto rails.
  async function peakOut(part: OpampKind, amplitude: number): Promise<{ mx: number; mn: number }> {
    const ckt: Circuit = {
      title: 'opamp gain test',
      components: [
        { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 0, sine: { offset: 0, amplitude, freq: 1000 } },
        { kind: 'resistor', id: 'in', nodes: ['in', 'inn'], ohms: 1000 },
        { kind: 'resistor', id: 'f', nodes: ['inn', 'out'], ohms: 10000 },
        { kind: 'opamp', id: '1', model: 'lmc662', part, nodes: { inP: '0', inN: 'inn', out: 'out' } },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const nl = buildNetlist(ckt, { kind: 'tran', step: 2e-6, stop: 3e-3 })
    expect(nl).toContain(`X1 0 inn xop1_vcc xop1_vee out ${part}`)
    expect(nl).toContain(`.subckt ${part} inp inn vcc vee out`)
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    const oi = r.variables.findIndex((v) => v.name.toLowerCase() === 'v(out)')
    const col = r.columns[oi]
    const vals = col.kind === 'real' ? col.values : col.mag
    let mx = -1e9, mn = 1e9
    for (const v of vals) { if (v > mx) mx = v; if (v < mn) mn = v }
    return { mx, mn }
  }

  it('gives the correct closed-loop gain (−10): 0.2 V in → ±2 V out', async () => {
    const { mx, mn } = await peakOut('op484', 0.2)
    expect(mx).toBeGreaterThan(1.9); expect(mx).toBeLessThan(2.1)
    expect(mn).toBeLessThan(-1.9); expect(mn).toBeGreaterThan(-2.1)
  }, 60000)

  it('RR part (OP484) swings to the rail; non-RR part (OP27) clips short', async () => {
    const rr = await peakOut('op484', 1.0)   // ideal ±10 V, rails ±5 V
    const std = await peakOut('op27', 1.0)
    expect(rr.mx).toBeGreaterThan(4.5)        // rail-to-rail reaches ~+5 V
    expect(std.mx).toBeLessThan(4.0)          // ~2 V headroom → clips near +3 V
    expect(std.mx).toBeGreaterThan(2.0)       // but still a real (clipped) swing
    expect(rr.mx).toBeGreaterThan(std.mx + 1) // RR clearly swings higher than the standard part
  }, 60000)

  it('TIA-0: TLV9062 runs single-supply (+5 V) — output confined to 0–5 V, never negative', async () => {
    // Inverting −10 stage with inP at GROUND. On a single +5 V rail the output is confined to [0, 5] V
    // and cannot go negative; the same stage on a ±5 V kit part swings to ~−2 V. (That this topology is
    // single-supply-broken — inP must sit at a Vref, not ground — is the TIA-3 lesson.) Proves the
    // part-aware auto-rail: the TLV9062 gets one +5 V rail, the kit part the ±5 V rails.
    const tlv = await peakOut('tlv9062', 0.2)
    const kit = await peakOut('op484', 0.2)
    expect(tlv.mn).toBeGreaterThan(-0.1)  // single +5 V supply: output cannot go below 0 V
    expect(tlv.mx).toBeLessThan(5.05)     // ...nor above +5 V
    expect(kit.mn).toBeLessThan(-1.5)     // the ±5 V kit part DOES swing negative (≈ −2 V)
  }, 60000)
})

describe('auto-rail synthesis (TIA-0 part-aware supplies)', () => {
  const amp = (part: OpampKind): Circuit => ({
    title: 'rails',
    components: [
      { kind: 'opamp', id: '1', model: 'lmc662', part, nodes: { inP: '0', inN: 'inn', out: 'out' } },
      { kind: 'resistor', id: 'f', nodes: ['inn', 'out'], ohms: 10000 },
      { kind: 'ground', id: '0', node: '0' },
    ],
  })

  it('a kit op-amp synthesises the ±5 V M2K rails', () => {
    const nl = buildNetlist(amp('op484'), { kind: 'op' })
    expect(nl).toContain('Vvcc1 xop1_vcc 0 DC 5')
    expect(nl).toContain('Vvee1 xop1_vee 0 DC -5')
  })

  it('the TLV9062 synthesises a single +5 V supply (V− at 0, within its 5.5 V max)', () => {
    const nl = buildNetlist(amp('tlv9062'), { kind: 'op' })
    expect(nl).toContain('Vvcc1 xop1_vcc 0 DC 5')
    expect(nl).toContain('Vvee1 xop1_vee 0 DC 0')
  })
})
