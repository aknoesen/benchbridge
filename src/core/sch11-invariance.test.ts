// SCH-11 P3 safety contract — the render swap (and every later P3 stage) must be
// behaviourally invisible to the model: `computeNets` and `toCircuit` output for
// the whole example library is snapshotted here and must never change from a
// visual-layer commit. If a P3 stage legitimately needs a model change, that is
// its own reviewed decision — not an accident this test lets through.
import { describe, it, expect } from 'vitest'
import { computeNets, toCircuit } from './schematic'
import { EXAMPLES } from './examples'

describe('SCH-11 invariance: nets + circuits of the example library', () => {
  it('computeNets is unchanged for every example', () => {
    const nets: Record<string, [string, string][]> = {}
    for (const ex of EXAMPLES) {
      nets[ex.id] = [...computeNets(ex.schematic).entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    }
    expect(nets).toMatchSnapshot()
  })

  it('toCircuit is unchanged for every example', () => {
    const circuits: Record<string, unknown> = {}
    for (const ex of EXAMPLES) {
      circuits[ex.id] = toCircuit(ex.schematic)
    }
    expect(circuits).toMatchSnapshot()
  })
})
