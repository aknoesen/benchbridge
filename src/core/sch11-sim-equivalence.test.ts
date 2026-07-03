// SCH-11 two-terminal instruments — RESULT-equivalence harness.
//
// The scope/W1 model change merges components (scope1 absorbs adc1n; awg1/awg2 grow a
// drawn ground return), so the structural nets/toCircuit snapshot cannot stay identical.
// The invariant that actually matters is pinned HERE instead: for every example in the
// library, the waveforms the instruments READ — CH1/CH2 sampled exactly the way App.tsx
// samples them (differential when a reference probe exists) — are unchanged.
//
// The baseline fixture (__fixtures__/sch11-sim-baseline.json) was generated from the
// PRE-migration model (branch commit 1546415) by running this same file when the fixture
// did not exist yet. It is committed; this test compares against it point by point.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Simulation } from 'eecircuit-engine'
import { toCircuit } from './schematic'
import { buildNetlist, applyGeneratorParams } from './netlist'
import { normalizeResult, sampleNodeTransient, type SimResult } from './spice'
import { EXAMPLES } from './examples'
import type { SignalParams } from './signal'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, '__fixtures__', 'sch11-sim-baseline.json')

const DEFAULT_W1: SignalParams = {
  waveType: 'sine', frequency: 1000, amplitude: 1, offset: 0,
  dutyCycle: 50, samplingRate: 100000, duration: 0.016,
}

const POINTS = 24 // samples recorded per channel per example — plenty to pin a waveform

// Mirror App.tsx's scope read: sample the probe node over the SECOND span (transients
// settled), differentially when a reference probe exists.
function readChannel(res: SimResult, pos: string | undefined, neg: string | undefined, span: number): number[] | null {
  if (!pos) return null
  const grid = new Float64Array(POINTS)
  for (let k = 0; k < POINTS; k++) grid[k] = span + (k / POINTS) * span
  const a = sampleNodeTransient(res, pos, grid)
  if (!a) return null
  const b = neg ? sampleNodeTransient(res, neg, grid) : null
  const out = new Array(POINTS)
  for (let i = 0; i < POINTS; i++) out[i] = a[i] - (b ? b[i] : 0)
  return out
}

interface Baseline { [exampleId: string]: { ch1: number[] | null; ch2: number[] | null } }

describe('SCH-11 sim-result equivalence across the example library', () => {
  it('every example reads the same CH1/CH2 waveforms as the committed baseline', async () => {
    const sim = new Simulation()
    await sim.start()

    const results: Baseline = {}
    for (const ex of EXAMPLES) {
      const drawn = toCircuit(ex.schematic)
      const w1 = ex.w1 ?? DEFAULT_W1
      const span = Math.round(w1.duration * w1.samplingRate) / w1.samplingRate
      const ckt = applyGeneratorParams(drawn.circuit, w1, ex.w2)
      const nl = buildNetlist(ckt, { kind: 'tran', step: span / 400, stop: 2 * span })
      sim.setNetList(nl)
      const res = normalizeResult(await sim.runSim())
      results[ex.id] = {
        ch1: readChannel(res, drawn.probes.ch1 ?? 'out', drawn.probes.ch1n, span),
        ch2: readChannel(res, drawn.probes.ch2, drawn.probes.ch2n, span),
      }
    }

    if (!existsSync(FIXTURE)) {
      // Bootstrap: first run (pre-migration model) writes the baseline and passes.
      mkdirSync(dirname(FIXTURE), { recursive: true })
      writeFileSync(FIXTURE, JSON.stringify(results, null, 1))
      console.warn(`sch11-sim-equivalence: baseline WRITTEN (${Object.keys(results).length} examples) — commit it`)
      return
    }

    const base: Baseline = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    for (const ex of EXAMPLES) {
      const b = base[ex.id]
      expect(b, `baseline entry for ${ex.id}`).toBeDefined()
      for (const ch of ['ch1', 'ch2'] as const) {
        const want = b[ch], got = results[ex.id][ch]
        if (want === null) { expect(got, `${ex.id} ${ch} should stay absent`).toBeNull(); continue }
        expect(got, `${ex.id} ${ch} should still read`).not.toBeNull()
        for (let i = 0; i < POINTS; i++) {
          // absolute+relative tolerance: a wrong reference or merged net shows up as
          // volt-scale error; numeric noise from netlist reordering stays far below this
          const tol = 1e-3 + 1e-3 * Math.abs(want[i])
          expect(Math.abs(got![i] - want[i]),
            `${ex.id} ${ch}[${i}]: got ${got![i]}, want ${want[i]}`).toBeLessThan(tol)
        }
      }
    }
  }, 600000)
})
