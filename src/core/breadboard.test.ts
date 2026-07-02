import { describe, it, expect } from 'vitest'
import { buildHoles, boardNets, holeKey } from './breadboard'

describe('breadboard nets (F-1)', () => {
  const holes = buildHoles()

  it('a 5-hole terminal column is internally common', () => {
    const nets = boardNets(holes)
    expect(nets.get('a1')).toBe(nets.get('e1'))   // whole column a..e of col 1
    expect(nets.get('a5')).toBe(nets.get('c5'))
  })

  it('the center channel keeps the two banks apart', () => {
    const nets = boardNets(holes)
    expect(nets.get('a1')).not.toBe(nets.get('f1')) // top bank vs bottom bank, same column
  })

  it('a power rail runs the full length and + / - rails are separate', () => {
    const nets = boardNets(holes)
    expect(nets.get('TP1')).toBe(nets.get('TP30'))
    expect(nets.get('TP1')).not.toBe(nets.get('TN1'))
    expect(nets.get('TP1')).not.toBe(nets.get('BP1')) // top + rail ≠ bottom + rail
  })

  it('adjacent columns are separate until a jumper unions them', () => {
    const plain = boardNets(holes)
    expect(plain.get('a1')).not.toBe(plain.get('a5'))
    const jumped = boardNets(holes, [{ a: holeKey('e', 1), b: holeKey('a', 5) }])
    expect(jumped.get('a1')).toBe(jumped.get('c5')) // col1 and col5 now one node
  })
})

import { checkEquivalence, boardNodeMap, PORT_TERMINAL, to92PinHoles, type BoardLayout } from './breadboard'
import { normalizeBoardOrder, nextBoardSeq } from './breadboard'
import { type Schematic } from './schematic'

describe('board z-order helpers (BUG-1: placement-order stacking)', () => {
  it('normalizeBoardOrder fills missing seq in the legacy render order (parts, dips, transistors)', () => {
    const b: BoardLayout = {
      parts: [{ id: 'R1', kind: 'resistor', aHole: 'b1', bHole: 'b5' }],
      jumpers: [], ports: [],
      dips: [{ id: 'U1', kind: 'opamp-quad', col: 5 }],
      transistors: [{ id: 'Q1', kind: 'mosfet', col: 20, row: 'b' }],
    }
    const n = normalizeBoardOrder(b)
    expect(n.parts[0].seq).toBe(0)
    expect(n.dips![0].seq).toBe(1)
    expect(n.transistors![0].seq).toBe(2)
    expect(b.parts[0].seq).toBeUndefined() // pure: input untouched
  })

  it('keeps existing seq values and fills only the missing ones above them', () => {
    const b: BoardLayout = {
      parts: [
        { id: 'R1', kind: 'resistor', aHole: 'b1', bHole: 'b5', seq: 7 },
        { id: 'R2', kind: 'resistor', aHole: 'c1', bHole: 'c5' },
      ],
      jumpers: [], ports: [],
    }
    const n = normalizeBoardOrder(b)
    expect(n.parts[0].seq).toBe(7)
    expect(n.parts[1].seq).toBe(8)
  })

  it('nextBoardSeq is one past the highest seq (0 for a fresh board)', () => {
    expect(nextBoardSeq({ parts: [], jumpers: [], ports: [] })).toBe(0)
    expect(nextBoardSeq({
      parts: [{ id: 'R1', kind: 'resistor', aHole: 'b1', bHole: 'b5', seq: 3 }],
      jumpers: [], ports: [],
      transistors: [{ id: 'Q1', kind: 'mosfet', col: 20, seq: 9 }],
    })).toBe(10)
  })
})

describe('to92PinHoles (ARB-1 polish: TO-92 placeable in any term row)', () => {
  it('defaults to the top-bank term row b, and honours an explicit row', () => {
    expect(to92PinHoles(3)).toEqual(['b3', 'b4', 'b5'])
    expect(to92PinHoles(3, 'e')).toEqual(['e3', 'e4', 'e5'])
    expect(to92PinHoles(3, 'g')).toEqual(['g3', 'g4', 'g5'])
  })
  it('returns null when the three legs overrun the board', () => {
    expect(to92PinHoles(0, 'e')).toBeNull()
    expect(to92PinHoles(999, 'e')).toBeNull()
  })
})

// W1 -> R1 -> (out) -> C1 -> GND ; 1+ probes the R-C node.
const rcSch: Schematic = {
  components: [
    { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
    { id: 'R1', kind: 'resistor', gx: 4, gy: 0, value: 1000 },
    { id: 'C1', kind: 'capacitor', gx: 6, gy: 0, value: 100e-9 },
    { id: 'G1', kind: 'ground', gx: 8, gy: 0 },
    { id: 'S1', kind: 'scope1', gx: 6, gy: 0 },
  ],
  wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }], // W1 -> R.a => 'in'
}

// Correct transfer: col1 = in (W1 + R1.a), col3 = out (R1.b + 1+ + C1.a), col5 = gnd (C1.b + GND).
function correctBoard(): BoardLayout {
  return {
    parts: [
      { id: 'R1', kind: 'resistor', aHole: 'b1', bHole: 'a3' },
      { id: 'C1', kind: 'capacitor', aHole: 'c3', bHole: 'a5' },
    ],
    // F-5: ports are fixed M2K terminals; the student jumpers from a terminal to the part column.
    jumpers: [
      { a: PORT_TERMINAL['W1'], b: 'a1' },  // W1 terminal → col1 (in)
      { a: PORT_TERMINAL['1+'], b: 'b3' },  // 1+ terminal → col3 (out)
      { a: PORT_TERMINAL['GND'], b: 'b5' }, // GND terminal → col5 (gnd)
    ],
    ports: [],
  }
}

describe('breadboard equivalence (F-2)', () => {
  const holes = buildHoles()

  it('a correct transfer matches the schematic', () => {
    const r = checkEquivalence(rcSch, correctBoard(), holes)
    expect(r.ok).toBe(true)
  })

  it('reports a missing part', () => {
    const b = correctBoard(); b.parts = b.parts.filter((p) => p.id !== 'C1')
    expect(checkEquivalence(rcSch, b, holes).message).toContain('C1')
  })

  it('reports a split node (output not common)', () => {
    const b = correctBoard(); b.parts[1].aHole = 'a4' // C1.a moved to col4 ≠ col3 (out)
    const r = checkEquivalence(rcSch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message.toLowerCase()).toContain('same node')
  })

  it('reports an accidental short', () => {
    const b = correctBoard(); b.jumpers.push({ a: 'b3', b: 'b5' }) // jumper col3(out)↔col5(gnd) → short
    const r = checkEquivalence(rcSch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message.toLowerCase()).toContain('different nodes')
  })

  it('a jumper can join two columns to fix a split', () => {
    const b = correctBoard(); b.parts[1].aHole = 'a4'           // out split into col3 and col4
    b.jumpers.push({ a: 'b4', b: 'd3' })                        // jumper col4 <-> col3 re-joins out
    expect(checkEquivalence(rcSch, b, holes).ok).toBe(true)
  })
})

describe('boardNodeMap (ARB-2 board-net → circuit node)', () => {
  const holes = buildHoles()

  it('maps each wired board net to the toCircuit renamed node (in/out/0)', () => {
    const b = correctBoard()
    const bnets = boardNets(holes, b.jumpers)
    const m = boardNodeMap(rcSch, b, holes)
    expect(m.get(bnets.get('a1')!)).toBe('in')   // col1 = W1 net
    expect(m.get(bnets.get('a3')!)).toBe('out')  // col3 = probed R-C node
    expect(m.get(bnets.get('a5')!)).toBe('0')    // col5 = ground
  })

  it('drops a board net that a mis-wiring pairs with two different nodes (no wrong readings)', () => {
    const b = correctBoard()
    b.jumpers.push({ a: 'b3', b: 'b5' }) // short col3(out) ↔ col5(gnd): merged net is ambiguous
    const bnets = boardNets(holes, b.jumpers)
    const m = boardNodeMap(rcSch, b, holes)
    expect(m.has(bnets.get('a3')!)).toBe(false)  // conflicting net gets NO reading
    expect(m.get(bnets.get('a1')!)).toBe('in')   // unaffected net still maps
  })

  it('leaves checkEquivalence behaviour untouched (same fixture still checks ok)', () => {
    expect(checkEquivalence(rcSch, correctBoard(), holes).ok).toBe(true)
  })
})

import { schematicExpectation, dipPinHoles } from './breadboard'

describe('breadboard DIP placement (F-3)', () => {
  const holes = buildHoles()
  const dipSch: Schematic = { components: [{ id: 'U1', kind: 'lmc662', gx: 10, gy: 4 }], wires: [] }

  it('dipPinHoles places 8 pins straddling rows e/f, pin 1 bottom-left', () => {
    expect(dipPinHoles('lmc662', 5)).toEqual(['f5', 'f6', 'f7', 'f8', 'e8', 'e7', 'e6', 'e5'])
  })

  it('rejects a DIP that overruns the board', () => {
    expect(dipPinHoles('lmc662', 28)).toBeNull() // 28..31 > 30 columns
  })

  it('the schematic expects the LMC662 as a DIP with 8 pin nets', () => {
    const exp = schematicExpectation(dipSch)
    expect(exp.dips).toHaveLength(1)
    expect(exp.dips[0].pinNets).toHaveLength(8)
  })

  it('reports a DIP that has not been placed', () => {
    const r = checkEquivalence(dipSch, { parts: [], jumpers: [], ports: [], dips: [] }, holes)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('U1')
  })

  it('a placed lone DIP matches (every pin its own isolated column)', () => {
    const b: BoardLayout = { parts: [], jumpers: [], ports: [], dips: [{ id: 'U1', kind: 'lmc662', col: 5 }] }
    expect(checkEquivalence(dipSch, b, holes).ok).toBe(true)
  })

  it('a jumper shorting two DIP pins is flagged', () => {
    const b: BoardLayout = { parts: [], jumpers: [{ a: 'f5', b: 'f6' }], ports: [], dips: [{ id: 'U1', kind: 'lmc662', col: 5 }] }
    const r = checkEquivalence(dipSch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message.toLowerCase()).toContain('connects them')
  })
})

describe('breadboard op-amp packages (F-4) — footprint follows the kit part', () => {
  const holes = buildHoles()
  const opSch = (part?: string): Schematic =>
    ({ components: [{ id: 'U1', kind: 'opamp', gx: 10, gy: 4, ...(part ? { part } : {}) }], wires: [] })

  it('OP484 (quad) boards as a 14-pin DIP named OP484, amp-A pins + rails V+ pin4 / V− pin11', () => {
    const exp = schematicExpectation(opSch('op484'))
    expect(exp.dips).toHaveLength(1)
    const d = exp.dips[0]
    expect(d.kind).toBe('opamp-quad')
    expect(d.name).toBe('OP484')
    expect(d.pinNets).toHaveLength(14)
    expect(d.rails).toEqual({ vpos: 3, vneg: 10, vnegTo: 'V-' }) // ±5 kit part → V− on the −rail
    expect(d.pinNets[0]).toBeDefined() // OUT A (pin 1)
    expect(d.pinNets[1]).toBeDefined() // −IN A (pin 2)
    expect(d.pinNets[2]).toBeDefined() // +IN A (pin 3)
  })

  it('OP27 (single) boards as an 8-pin DIP named OP27, rails V+ pin7 / V− pin4', () => {
    const d = schematicExpectation(opSch('op27')).dips[0]
    expect(d.kind).toBe('opamp-single')
    expect(d.name).toBe('OP27')
    expect(d.pinNets).toHaveLength(8)
    expect(d.rails).toEqual({ vpos: 6, vneg: 3, vnegTo: 'V-' })
    expect(d.pinNets[5]).toBeDefined() // OUT (pin 6)
    expect(d.pinNets[1]).toBeDefined() // −IN (pin 2)
    expect(d.pinNets[2]).toBeDefined() // +IN (pin 3)
  })

  it('an off-kit / part-less op-amp falls back to the 8-pin LMC662 dual (no "LMC662" surprise for a kit part)', () => {
    const d = schematicExpectation(opSch(undefined)).dips[0]
    expect(d.kind).toBe('lmc662')
    expect(d.name).toBe('LMC662')
    expect(d.pinNets).toHaveLength(8)
    expect(d.rails).toEqual({ vpos: 7, vneg: 3, vnegTo: 'V-' })
  })

  it('dipPinHoles lays a 14-pin quad across 7 columns (pin4 = f8 V+, pin11 = e8 V−)', () => {
    const pins = dipPinHoles('opamp-quad', 5)
    expect(pins).toEqual(['f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'e11', 'e10', 'e9', 'e8', 'e7', 'e6', 'e5'])
    expect(pins![3]).toBe('f8')   // pin 4 = V+
    expect(pins![10]).toBe('e8')  // pin 11 = V−
  })

  it('centerpiece: a default OP484 boards as a 14-pin DIP and the Check passes when wired', () => {
    const board: BoardLayout = {
      parts: [], ports: [],
      dips: [{ id: 'U1', kind: 'opamp-quad', col: 5 }],
      jumpers: [{ a: 'f8', b: 'TN8' }, { a: 'e8', b: 'BP8' }], // pin4 V+→V+ rail, pin11 V−→V− rail
    }
    expect(checkEquivalence(opSch('op484'), board, holes).ok).toBe(true)
  })

  it('the OP484 board fails until V+ (pin 4) is wired to the rail', () => {
    const board: BoardLayout = {
      parts: [], ports: [],
      dips: [{ id: 'U1', kind: 'opamp-quad', col: 5 }],
      jumpers: [{ a: 'e8', b: 'BP8' }], // only V− wired
    }
    const r = checkEquivalence(opSch('op484'), board, holes)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('V+')
  })
})

describe('breadboard INA125 auxiliary straps (SCH-7, Lab 8 Fig 1)', () => {
  const holes = buildHoles()
  const sch: Schematic = { components: [{ id: 'U1', kind: 'ina125', gx: 10, gy: 4 }], wires: [] }
  // DIP at col 5: pin1=f5,2=f6,3=f7,4=f8,5=f9 … 10=e11,11=e10,12=e9,14=e7. Rails on TN(V+)/BP(V−),
  // GND on the TP/BN outer rails (all pre-wired).
  const wired = (): BoardLayout => ({
    parts: [], ports: [],
    dips: [{ id: 'U1', kind: 'ina125', col: 5 }],
    jumpers: [
      { a: 'f5', b: 'TN5' },  // pin 1  V+      → V+ rail
      { a: 'f7', b: 'BP7' },  // pin 3  V−      → V− rail
      { a: 'f6', b: 'TN6' },  // pin 2  SLEEP   → V+
      { a: 'f8', b: 'e7' },   // pin 4  VREFout → pin 14 VREF2.5
      { a: 'f9', b: 'TP9' },  // pin 5  IAref   → GND
      { a: 'e10', b: 'e11' }, // pin 11 Sense   → pin 10 Vo
      { a: 'e9', b: 'BN9' },  // pin 12 VREFcom → GND
    ],
  })

  it('a fully strapped INA125 passes the Check', () => {
    expect(checkEquivalence(sch, wired(), holes).ok).toBe(true)
  })

  it('flags a missing Sense→Vo strap', () => {
    const b = wired(); b.jumpers = b.jumpers.filter((j) => j.a !== 'e10')
    const r = checkEquivalence(sch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Sense')
  })

  it('flags a missing VREFout→VREF2.5 strap', () => {
    const b = wired(); b.jumpers = b.jumpers.filter((j) => j.a !== 'f8')
    const r = checkEquivalence(sch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('VREF2.5')
  })

  it('flags a missing SLEEP→V+ strap', () => {
    const b = wired(); b.jumpers = b.jumpers.filter((j) => j.a !== 'f6')
    const r = checkEquivalence(sch, b, holes)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('SLEEP')
  })
})

import { autoRouteJumpers } from './breadboard'

describe('autoRouteJumpers (F-7/ARB-3 — manual/hint/auto routing engine)', () => {
  const holes = buildHoles()
  const unwired = () => { const b = correctBoard(); b.jumpers = []; return b }

  it('2-pin passive nets: routes the placed RC to a Check-passing jumper set', () => {
    const b = unwired()
    const auto = autoRouteJumpers(rcSch, b, holes)
    expect(checkEquivalence(rcSch, { ...b, jumpers: auto }, holes).ok).toBe(true)
  })

  it('spanning tree: n−1 jumpers per net, and a net already common in one column needs none', () => {
    // R1.b and C1.a share column 3 (out already common through the column), so the three nets
    // (in, out, gnd) each span exactly 2 pre-wired groups → exactly 3 jumpers, none intra-group.
    const auto = autoRouteJumpers(rcSch, unwired(), holes)
    expect(auto).toHaveLength(3)
    const base = boardNets(holes, [])
    for (const j of auto) expect(base.get(j.a)).not.toBe(base.get(j.b))
  })

  it('routes ground to a pre-wired GND rail (not part-to-part star wiring)', () => {
    const auto = autoRouteJumpers(rcSch, unwired(), holes)
    const base = boardNets(holes, [])
    const gndGroup = base.get(PORT_TERMINAL['GND'])
    const gnd = auto.filter((j) => base.get(j.a) === gndGroup || base.get(j.b) === gndGroup)
    expect(gnd).toHaveLength(1)
    const railEnd = base.get(gnd[0].a) === gndGroup ? gnd[0].a : gnd[0].b
    expect(/^(TP|BN)\d+$/.test(railEnd)).toBe(true) // lands on a ground rail hole
  })

  // Voltage follower: W1 → +IN, OUT wired back to −IN (the feedback net), 1+ probes OUT.
  // OP484 (default kit part) → 14-pin quad DIP; amp A: OUT=pin1, −IN=pin2, +IN=pin3.
  const followerSch: Schematic = {
    components: [
      { id: 'W1', kind: 'awg1', gx: 0, gy: 0 },
      { id: 'U1', kind: 'opamp', gx: 4, gy: 0, part: 'op484' },
      { id: 'S1', kind: 'scope1', gx: 10, gy: 1 },
    ],
    wires: [
      { x1: 0, y1: 0, x2: 4, y2: 0 },  // W1 → inP
      { x1: 8, y1: 1, x2: 10, y2: 1 }, // out → 1+
      { x1: 8, y1: 1, x2: 4, y2: 2 },  // feedback: out → inN
    ],
  }

  it('op-amp feedback net + supply rails: the follower routes to a passing Check', () => {
    const b: BoardLayout = { parts: [], ports: [], jumpers: [], dips: [{ id: 'U1', kind: 'opamp-quad', col: 5 }] }
    const auto = autoRouteJumpers(followerSch, b, holes)
    expect(checkEquivalence(followerSch, { ...b, jumpers: auto }, holes).ok).toBe(true)
    // power pins reach the correct pre-wired rails: pin 4 (V+, f8) → top inner, pin 11 (V−, e8) → bottom inner
    const nets = boardNets(holes, auto)
    expect(nets.get('f8')).toBe(nets.get('TN1'))
    expect(nets.get('e8')).toBe(nets.get('BP1'))
  })

  it('DIP multi-pin: a lone INA125 auto-routes rails + all five datasheet straps to a passing Check', () => {
    const sch: Schematic = { components: [{ id: 'U1', kind: 'ina125', gx: 10, gy: 4 }], wires: [] }
    const b: BoardLayout = { parts: [], ports: [], jumpers: [], dips: [{ id: 'U1', kind: 'ina125', col: 5 }] }
    const auto = autoRouteJumpers(sch, b, holes)
    expect(auto).toHaveLength(7) // V+, V− rails + SLEEP, VREFout→VREF2.5, IAref, Sense→Vo, VREFcom
    expect(checkEquivalence(sch, { ...b, jumpers: auto }, holes).ok).toBe(true)
  })

  it('is deterministic and ignores existing student jumpers (pure function of the placement)', () => {
    const r1 = autoRouteJumpers(rcSch, unwired(), holes)
    const r2 = autoRouteJumpers(rcSch, unwired(), holes)
    expect(r2).toEqual(r1)
    const withStray = correctBoard() // has the student's own jumpers — must not change the result
    expect(autoRouteJumpers(rcSch, withStray, holes)).toEqual(r1)
  })

  it('annotates every jumper for the hint overlay', () => {
    const auto = autoRouteJumpers(rcSch, unwired(), holes)
    for (const j of auto) expect(j.note.length).toBeGreaterThan(0)
  })

  it('does not alter checkEquivalence behaviour (manual fixture still checks ok)', () => {
    expect(checkEquivalence(rcSch, correctBoard(), holes).ok).toBe(true)
  })

  it('save in auto materialises the generated set: JSON round-trip Check-passes with plain jumpers', () => {
    // Mirrors Save-lab / the autosave in `auto` mode: bundle the generated wiring as plain {a,b}
    // (no hint `note` leaks into the file), serialise, reload — Check passes on the loaded board.
    const b = unwired()
    const saved = { ...b, jumpers: autoRouteJumpers(rcSch, b, holes).map(({ a, b: bb }) => ({ a, b: bb })) }
    const loaded = JSON.parse(JSON.stringify(saved)) as BoardLayout
    expect(loaded.jumpers.length).toBeGreaterThan(0)
    for (const j of loaded.jumpers) expect(Object.keys(j).sort()).toEqual(['a', 'b'])
    expect(checkEquivalence(rcSch, loaded, holes).ok).toBe(true)
  })
})
