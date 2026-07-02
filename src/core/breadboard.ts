// Solderless breadboard model (Track F, phase F-1). No React, no rendering.
// The board imposes a fixed internal connectivity — each 5-hole terminal column is common, the
// two banks are split by the center channel, and each power rail runs the board's length. Nets
// are computed the same way as the schematic (union-find over hole coordinates), so a board
// layout can later be checked for electrical equivalence with a drawn circuit (F-2).
// See docs/specs/breadboard.md.

import { computeNets, terminalsOf, type Schematic, type SchKind } from './schematic'
import { getOpamp, isKitOpamp } from './opamps'

export const COLS = 30
export const PITCH = 18   // px between adjacent holes
export const PAD = 22

export type Row = 'TP' | 'TN' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'BP' | 'BN'
export type HoleKind = 'railP' | 'railN' | 'term'

interface RowDef { row: Row; slot: number; kind: HoleKind; railGroup?: string }

// Row layout top → bottom. Slots 2, 8, 14 are intentional gaps (rail spacer + center channel).
const ROWS: RowDef[] = [
  { row: 'TP', slot: 0,  kind: 'railP', railGroup: 'RAIL_TP' },
  { row: 'TN', slot: 1,  kind: 'railN', railGroup: 'RAIL_TN' },
  { row: 'a',  slot: 3,  kind: 'term' },
  { row: 'b',  slot: 4,  kind: 'term' },
  { row: 'c',  slot: 5,  kind: 'term' },
  { row: 'd',  slot: 6,  kind: 'term' },
  { row: 'e',  slot: 7,  kind: 'term' },
  { row: 'f',  slot: 9,  kind: 'term' },
  { row: 'g',  slot: 10, kind: 'term' },
  { row: 'h',  slot: 11, kind: 'term' },
  { row: 'i',  slot: 12, kind: 'term' },
  { row: 'j',  slot: 13, kind: 'term' },
  { row: 'BP', slot: 15, kind: 'railP', railGroup: 'RAIL_BP' },
  { row: 'BN', slot: 16, kind: 'railN', railGroup: 'RAIL_BN' },
]
const TOP_BANK = new Set<Row>(['a', 'b', 'c', 'd', 'e'])
export const CHANNEL_SLOT = 8 // center-channel row slot (for rendering)
export const ROW_SLOTS = 17

export interface Hole {
  key: string
  col: number
  row: Row
  x: number
  y: number
  group: string   // internal-connection group (the net the board pre-wires this hole into)
  kind: HoleKind
}

export const holeKey = (row: Row, col: number): string => `${row}${col}`

export function buildHoles(cols = COLS): Hole[] {
  const holes: Hole[] = []
  for (const rd of ROWS) {
    for (let col = 1; col <= cols; col++) {
      const group = rd.railGroup ?? (TOP_BANK.has(rd.row) ? `T${col}` : `B${col}`)
      holes.push({
        key: holeKey(rd.row, col),
        col, row: rd.row,
        x: PAD + (col - 1) * PITCH,
        y: PAD + rd.slot * PITCH,
        group, kind: rd.kind,
      })
    }
  }
  return holes
}

export const boardWidth = (cols = COLS): number => PAD * 2 + (cols - 1) * PITCH
export const boardHeight = (): number => PAD * 2 + (ROW_SLOTS - 1) * PITCH

export interface Jumper { a: string; b: string } // hole keys

// Union-find over hole keys: seed by internal group, then union jumpers. Returns holeKey → net.
// (Component legs are added in F-2; legs do NOT union to each other — a 2-terminal part bridges
// two nets, it does not short them.)
export function boardNets(holes: Hole[], jumpers: Jumper[] = [], terminals: Terminal[] = TERMINALS): Map<string, string> {
  const parent = new Map<string, string>()
  const ensure = (k: string) => { if (!parent.has(k)) parent.set(k, k) }
  const find = (a: string): string => {
    let r = a
    while (parent.get(r) !== r) r = parent.get(r)!
    while (parent.get(a) !== r) { const n = parent.get(a)!; parent.set(a, r); a = n }
    return r
  }
  const union = (a: string, b: string) => {
    ensure(a); ensure(b)
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const groupRep = new Map<string, string>()
  for (const h of holes) {
    ensure(h.key)
    const rep = groupRep.get(h.group)
    if (rep === undefined) groupRep.set(h.group, h.key)
    else union(h.key, rep)
  }
  // Fixed M2K terminals join the same graph; all GND terminals collapse to one node.
  for (const t of terminals) {
    ensure(t.key)
    const g = terminalGroup(t)
    const rep = groupRep.get(g)
    if (rep === undefined) groupRep.set(g, t.key)
    else union(t.key, rep)
  }
  for (const w of POWER_WIRES) union(w.a, w.b) // standard, always-present power distribution
  for (const j of jumpers) union(j.a, j.b)

  const name = new Map<string, string>()
  let n = 0
  const out = new Map<string, string>()
  for (const k of parent.keys()) {
    const r = find(k)
    if (!name.has(r)) name.set(r, `bn${n++}`)
    out.set(k, name.get(r)!)
  }
  return out
}

// ── F-2: placed parts, ports, and the schematic-equivalence check ───────────────

// Canonical M2K port names, keyed by the schematic port kind. These anchor the board↔schematic
// mapping during the equivalence check.
export const PORT_NAME: Partial<Record<SchKind, string>> = {
  awg1: 'W1', awg2: 'W2', scope1: '1+', adc1n: '1-', scope2: '2+', adc2n: '2-',
  vplus: 'V+', vminus: 'V-', ground: 'GND',
}
// 2-pin parts a student places on the board (F-2): passives plus the 2-terminal semiconductors.
export const PLACEABLE_KINDS = new Set<SchKind>(['resistor', 'capacitor', 'inductor', 'diode', 'led', 'zener', 'photodiode'])

// Kinds the board cannot lay out. Every part now has a package (op-amp → LMC662 DIP, in-amp →
// INA125 DIP, 2-pin parts placeable), so this is empty; the machinery stays for any future part.
export const UNBOARDABLE_KINDS = new Set<SchKind>()
export function unboardable(s: Schematic): { id: string; kind: SchKind }[] {
  return s.components.filter((c) => UNBOARDABLE_KINDS.has(c.kind)).map((c) => ({ id: c.id, kind: c.kind }))
}

// ── F-5: fixed M2K connector strips (always present) ─────────────────────────────
// Mirrors the UC Davis adaptor board's two 1×15 headers: the M2K signals come out on fixed
// terminals top and bottom, and the student jumpers from them into the breadboard. Each terminal
// is a fixed node in the net graph; ALL GND terminals share one node (the M2K ground). `port` ties
// a terminal to a schematic port for the equivalence check; TI (trigger-in) is unused in-course
// and carries no port. `color` drives the course wiring convention (red +V, blue −V, neutral GND).
export type TermColor = 'pos' | 'neg' | 'gnd' | 'signal'
export interface Terminal { key: string; name: string; port?: string; side: 'top' | 'bottom'; col: number; color: TermColor }
const GND_GROUP = 'GND_RAIL'

const TOP_DEF: { name: string; port?: string; color: TermColor }[] = [
  { name: '1+', port: '1+', color: 'signal' },
  { name: '2+', port: '2+', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
  { name: 'V+', port: 'V+', color: 'pos' },
  { name: 'W1', port: 'W1', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
  { name: 'TI', color: 'signal' },
]
const BOT_DEF: { name: string; port?: string; color: TermColor }[] = [
  { name: '1-', port: '1-', color: 'signal' },
  { name: '2-', port: '2-', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
  { name: 'V-', port: 'V-', color: 'neg' },
  { name: 'W2', port: 'W2', color: 'signal' },
  { name: 'GND', port: 'GND', color: 'gnd' },
]

// Spread n terminals across the board with a 2-column margin each side, aligned to hole columns.
function spreadCols(n: number): number[] {
  const span = COLS - 4
  return Array.from({ length: n }, (_, i) => Math.round(3 + (span * i) / (n - 1)))
}

export const TERMINALS: Terminal[] = (() => {
  const out: Terminal[] = []
  spreadCols(TOP_DEF.length).forEach((col, i) => out.push({ key: `TT${i}`, ...TOP_DEF[i], side: 'top', col }))
  spreadCols(BOT_DEF.length).forEach((col, i) => out.push({ key: `TB${i}`, ...BOT_DEF[i], side: 'bottom', col }))
  return out
})()

// Net-seed group for a terminal (all GND terminals collapse to one node).
const terminalGroup = (t: Terminal): string => (t.color === 'gnd' ? GND_GROUP : `TERM_${t.key}`)

// port name → the terminal key that provides it (first match; GND resolves to the shared node).
export const PORT_TERMINAL: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const t of TERMINALS) if (t.port && !(t.port in m)) m[t.port] = t.key
  return m
})()

// Standard power distribution, always present (modelling the habit students should keep): GND to the
// two OUTER rails (top TP, bottom BN), V+ to the top INNER rail (TN), V− to the bottom INNER rail
// (BP). Each wire is coloured by its terminal. These are fixed (not user jumpers) so the rails are
// always powered and the convention is always visible.
export interface PowerWire { a: string; b: string; color: TermColor }
export const POWER_WIRES: PowerWire[] = (() => {
  const topGnd = TERMINALS.find((t) => t.side === 'top' && t.color === 'gnd')!
  const botGnd = TERMINALS.find((t) => t.side === 'bottom' && t.color === 'gnd')!
  const vp = TERMINALS.find((t) => t.port === 'V+')!
  const vn = TERMINALS.find((t) => t.port === 'V-')!
  return [
    { a: topGnd.key, b: holeKey('TP', topGnd.col), color: 'gnd' }, // GND → top outer rail
    { a: botGnd.key, b: holeKey('BN', botGnd.col), color: 'gnd' }, // GND → bottom outer rail
    { a: vp.key, b: holeKey('TN', vp.col), color: 'pos' },         // V+  → top inner rail
    { a: vn.key, b: holeKey('BP', vn.col), color: 'neg' },         // V−  → bottom inner rail
  ]
})()

// DIP/IC parts placed on the board (F-3). Unlike a 2-pin part, every pin is its own net and the
// body must straddle the center channel: pins sit in the two channel-adjacent term rows (e and f),
// so each pin lands in its own isolated terminal column.
// Schematic kinds that ARE their own DIP package directly (legacy explicit parts whose pins are all
// schematic terminals). The abstract `opamp` kind is handled separately (its package comes from the
// selected kit `part`); `ina125` is also handled in its own branch.
export const DIP_KINDS = new Set<SchKind>(['lmc662'])
export const DIP_TOP_ROW: Row = 'e' // top-bank row adjacent to the channel
export const DIP_BOT_ROW: Row = 'f' // bottom-bank row adjacent to the channel

// ── F-4: per-package DIP model ───────────────────────────────────────────────────
// The board footprint is driven by the part's package, not a hardcoded LMC662. A `DipPkg` names a
// physical DIP footprint; the schematic op-amp maps to one via its kit `part` (opampBoardPkg). The
// values 'lmc662' / 'ina125' deliberately match the legacy SchKind strings so older saved boards
// (PlacedDip.kind = 'lmc662' / 'ina125') still deserialize.
export type DipPkg = 'opamp-single' | 'opamp-quad' | 'opamp-soic-adapter' | 'lmc662' | 'ina125'

export interface DipDef {
  pins: number            // total pin count (even)
  name: string            // default display name (op-amps override with the real part name)
  fn: string[]            // pin-function labels, 1-based (index 0 = pin 1); length === pins
  rails?: { vpos: number; vneg: number }            // 0-based V+/V− pin indices (Check + colouring)
  amp?: { out: number; inN: number; inP: number }   // used-amp (A) signal pins, 0-based (op-amps)
}

// Standard pinouts (1-based → 0-based index). Single/quad op-amp use amp A; rails come via the board
// power rails. LMC662 is the off-kit 8-pin dual fallback; INA125 keeps its datasheet pinout.
export const DIP_DEFS: Record<DipPkg, DipDef> = {
  'opamp-single': {
    pins: 8, name: 'Op-amp (8-DIP)',
    fn: ['NC', '−IN', '+IN', 'V−', 'NC', 'OUT', 'V+', 'NC'],
    rails: { vpos: 6, vneg: 3 }, amp: { out: 5, inN: 1, inP: 2 },
  },
  'opamp-quad': {
    pins: 14, name: 'Op-amp (14-DIP)',
    fn: ['OUT A', '−IN A', '+IN A', 'V+', '+IN B', '−IN B', 'OUT B', 'OUT C', '−IN C', '+IN C', 'V−', '+IN D', '−IN D', 'OUT D'],
    rails: { vpos: 3, vneg: 10 }, amp: { out: 0, inN: 1, inP: 2 },
  },
  'lmc662': {
    pins: 8, name: 'LMC662',
    fn: ['OUT A', '−IN A', '+IN A', 'V−', '+IN B', '−IN B', 'OUT B', 'V+'],
    rails: { vpos: 7, vneg: 3 }, amp: { out: 0, inN: 1, inP: 2 },
  },
  // TIA-0: TLV9062 is a SOIC-8 (no DIP) — boarded on an 8-pin SOIC-to-DIP adapter. Standard dual
  // op-amp pinout (same as the LMC662 8-DIP); the name flags the adapter.
  'opamp-soic-adapter': {
    pins: 8, name: 'Op-amp (SOIC-8 on adapter)',
    fn: ['OUT A', '−IN A', '+IN A', 'V−', '+IN B', '−IN B', 'OUT B', 'V+'],
    rails: { vpos: 7, vneg: 3 }, amp: { out: 0, inN: 1, inP: 2 },
  },
  'ina125': {
    pins: 16, name: 'INA125',
    fn: ['V+', 'SLEEP', 'V−', 'VREFOUT', 'IAREF', 'VIN−', 'VIN+', 'RG', 'RG', 'VO', 'Sense', 'VREFCOM', 'VREFBG', 'VREF2.5', 'VREF5', 'VREF10'],
    rails: { vpos: 0, vneg: 2 },
  },
}

// Which board footprint a schematic op-amp gets, from its kit `part`: single 8-DIP (OP27/37/97),
// quad 14-DIP (OP482/484), or the off-kit 8-pin dual fallback (no/unknown part → LMC662 behaviour).
export function opampBoardPkg(part?: string): DipPkg {
  if (part && isKitOpamp(part)) {
    const p = getOpamp(part)
    if (p.channels === 1) return 'opamp-single'
    if (p.channels === 4) return 'opamp-quad'
    // A dual kit/course part: SOIC-8 parts (TLV9062) board on an adapter; otherwise the 8-DIP dual.
    if (p.channels === 2) return p.package === '8-SOIC' ? 'opamp-soic-adapter' : 'lmc662'
  }
  return 'lmc662'
}
// Display name for a boarded op-amp: the real kit part (OP484…) or the off-kit fallback name.
export function opampBoardName(part?: string): string {
  return part && isKitOpamp(part) ? getOpamp(part).name : 'LMC662'
}

// Columns a DIP spans (pins split evenly across the two rows): 8-pin → 4, 14-pin → 7, 16-pin → 8.
export function dipCols(pkg: DipPkg): number {
  return DIP_DEFS[pkg].pins / 2
}

// Hole keys for a DIP whose top-left pin sits at (DIP_TOP_ROW, col), ordered to match the schematic
// terminal order / DIP_DEFS pin numbering. Convention: pin 1 bottom-left, pins 1→n along the bottom
// row L→R, pins n+1→2n along the top row R→L (notch faces left). Null if it would overrun the board.
export function dipPinHoles(pkg: DipPkg, col: number): string[] | null {
  const n = dipCols(pkg)
  if (n === 0 || col < 1 || col + n - 1 > COLS) return null
  const bottom: string[] = [], top: string[] = []
  for (let i = 0; i < n; i++) {
    bottom.push(holeKey(DIP_BOT_ROW, col + i)) // pins 1..n
    top.push(holeKey(DIP_TOP_ROW, col + i))
  }
  return [...bottom, ...top.reverse()] // top row R→L gives pins n+1..2n
}

// ── SCH-8: TO-92 / 3-lead footprint (discrete transistors) ──────────────────────
// A discrete transistor sits in ONE bank with its three legs in three adjacent columns of a single
// row, so each leg lands in its own isolated terminal column (the part bridges three nets). Unlike a
// DIP it does NOT straddle the channel. Legs map to the schematic terminal order (BJT c/b/e, MOSFET
// d/g/s); the side legend names them.
export const TO92_KINDS = new Set<SchKind>(['bjt', 'mosfet'])
export const TO92_ROW: Row = 'b' // a top-bank term row (any isolated-column term row works)

// Hole keys for a TO-92 anchored at `col` in `row` (three adjacent columns, same row). Null if it
// overruns. `row` defaults to TO92_ROW; any isolated-column term row works (each column is its own net).
export function to92PinHoles(col: number, row: Row = TO92_ROW): string[] | null {
  if (col < 1 || col + 2 > COLS) return null
  return [holeKey(row, col), holeKey(row, col + 1), holeKey(row, col + 2)]
}

// Leg labels in schematic-terminal order (matches terminalsOf), for the side legend.
export function to92Legend(kind: SchKind): string[] {
  return kind === 'mosfet' ? ['D', 'G', 'S'] : ['C', 'B', 'E']
}

export interface PlacedPart { id: string; kind: SchKind; value?: number; aHole: string; bHole: string }
export interface PlacedPort { port: string; hole: string }
// A placed DIP is anchored by its top-left pin column; pin holes derive via dipPinHoles(). `kind` is
// the board DIP package (F-4), not the schematic kind. `name` is the display label (the real part).
export interface PlacedDip { id: string; kind: DipPkg; col: number; name?: string }
// A placed TO-92 transistor anchored by its left leg column; leg holes derive via to92PinHoles().
export interface PlacedTransistor { id: string; kind: SchKind; col: number; row?: Row }
export interface BoardLayout { parts: PlacedPart[]; jumpers: Jumper[]; ports: PlacedPort[]; dips?: PlacedDip[]; transistors?: PlacedTransistor[] }

export const emptyBoard = (): BoardLayout => ({ parts: [], jumpers: [], ports: [], dips: [], transistors: [] })

// What the schematic expects on the board: its R/C/L parts (with each leg's net) and its ports.
export interface SchematicExpectation {
  parts: { id: string; kind: SchKind; a: string; b: string }[]
  // pinNets is indexed by DIP pin (pin1 = index 0). `undefined` = an unused pin (no constraint).
  // rails (when set) names the V+/V- pin indices the Check requires on the supply rails.
  // straps (when set) are fixed chip-level connections the Check requires regardless of the
  // schematic — a pin tied to a supply rail or to another pin (datasheet-mandated wiring such as
  // the INA125's reference and sense straps). `pin`/`to` are 0-based pin indices; `to` may also be
  // a rail name. `label` is the student-facing hint shown when the strap is missing.
  // rails.vnegTo (TIA-3) names the rail the V− pin must reach: the V− rail by default, or GND for a
  // single-supply part (op-amp supplyDefault.vee === 0), whose V− pin ties to ground, not a −rail.
  dips: {
    id: string; kind: DipPkg; name?: string; pinNets: (string | undefined)[]
    rails?: { vpos: number; vneg: number; vnegTo?: 'V-' | 'GND' }
    straps?: { pin: number; to: number | 'V+' | 'V-' | 'GND'; label: string }[]
  }[]
  // SCH-8: discrete transistors (3 legs in schematic-terminal order: BJT c/b/e, MOSFET d/g/s).
  transistors: { id: string; kind: SchKind; pinNets: string[] }[]
  ports: { name: string; net: string }[]
}
export function schematicExpectation(s: Schematic): SchematicExpectation {
  const nets = computeNets(s)
  const netOf = (gx: number, gy: number) => nets.get(`${gx},${gy}`) ?? `x_${gx}_${gy}`
  const parts: SchematicExpectation['parts'] = []
  const dips: SchematicExpectation['dips'] = []
  const transistors: SchematicExpectation['transistors'] = []
  const ports = new Map<string, string>()
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (PLACEABLE_KINDS.has(c.kind)) {
      parts.push({ id: c.id, kind: c.kind, a: netOf(ts[0].gx, ts[0].gy), b: netOf(ts[1].gx, ts[1].gy) })
    } else if (TO92_KINDS.has(c.kind)) {
      transistors.push({ id: c.id, kind: c.kind, pinNets: ts.map((t) => netOf(t.gx, t.gy)) })
    } else if (DIP_KINDS.has(c.kind)) {
      // Legacy explicit LMC662 dual: all 8 terminals (incl. V+/V−) are schematic pins, no rail anchor.
      dips.push({ id: c.id, kind: 'lmc662', name: DIP_DEFS.lmc662.name, pinNets: ts.map((t) => netOf(t.gx, t.gy)) })
    } else if (c.kind === 'opamp') {
      // F-4: the board footprint follows the selected kit part (single 8-DIP / quad 14-DIP / off-kit
      // 8-pin dual), not a hardcoded LMC662. Map the used amp (A) signal pins to that package's pinout;
      // V+/V− come via the board rails, the rest are unused.
      const pkg = opampBoardPkg(c.part)
      const def = DIP_DEFS[pkg]
      const a = def.amp!
      const byName = new Map(ts.map((t) => [t.name, netOf(t.gx, t.gy)]))
      const pinNets: (string | undefined)[] = new Array(def.pins).fill(undefined)
      pinNets[a.out] = byName.get('out')
      pinNets[a.inN] = byName.get('inN')
      pinNets[a.inP] = byName.get('inP')
      // TIA-3: a single-supply part (supplyDefault.vee === 0, e.g. the TLV9062) ties its V− pin to
      // GND, not a −rail; the Check follows suit. Kit ±5 parts keep V− on the V− rail.
      const singleSupply = c.part && isKitOpamp(c.part) ? getOpamp(c.part).supplyDefault?.vee === 0 : false
      const rails = def.rails ? { ...def.rails, vnegTo: (singleSupply ? 'GND' : 'V-') as 'V-' | 'GND' } : undefined
      dips.push({ id: c.id, kind: pkg, name: opampBoardName(c.part), pinNets, rails })
    } else if (c.kind === 'ina125') {
      // INA125 → 16-pin DIP. Map the in-amp's signal pins to the datasheet pinout (1-based):
      // 6 VIN−, 7 VIN+, 8 RG, 9 RG, 10 VO; V+ (1) / V− (3) via the rails. The reference (IAref,
      // VREFcom), sense, and sleep pins are not part of the abstract schematic symbol — they are
      // fixed chip-level wiring (see Fig 1 / datasheet) enforced via `straps` so the student wires
      // every pin the real INA125 needs to function. Other pins are unused.
      const byName = new Map(ts.map((t) => [t.name, netOf(t.gx, t.gy)]))
      const pinNets: (string | undefined)[] = new Array(16).fill(undefined)
      pinNets[5] = byName.get('inN')   // pin 6
      pinNets[6] = byName.get('inP')   // pin 7
      pinNets[7] = byName.get('rg1')   // pin 8
      pinNets[8] = byName.get('rg2')   // pin 9
      pinNets[9] = byName.get('out')   // pin 10
      dips.push({
        id: c.id, kind: 'ina125', name: DIP_DEFS.ina125.name, pinNets,
        rails: { vpos: 0, vneg: 2 },     // V+ pin1, V− pin3
        straps: [
          { pin: 1, to: 'V+', label: 'SLEEP (pin 2) → V+ rail (else the device stays in shutdown)' },
          { pin: 3, to: 13, label: 'VREFout (pin 4) → VREF2.5 (pin 14) — strap the on-chip reference' },
          { pin: 4, to: 'GND', label: 'IAref (pin 5) → GND (sets the output reference)' },
          { pin: 10, to: 9, label: 'Sense (pin 11) → Vo (pin 10) — close the output-buffer feedback' },
          { pin: 11, to: 'GND', label: 'VREFcom (pin 12) → GND' },
        ],
      })
    } else {
      const name = PORT_NAME[c.kind]
      if (name && !ports.has(name)) ports.set(name, netOf(ts[0].gx, ts[0].gy))
    }
  }
  return { parts, dips, transistors, ports: [...ports].map(([name, net]) => ({ name, net })) }
}

export interface CheckResult { ok: boolean; message: string }

function pinLabel(pin: string): string {
  const dip = /^(.*)\.p(\d+)$/.exec(pin)
  if (dip) return `${dip[1]} pin ${dip[2]}`
  const m = /^(.*)\.([AB])$/.exec(pin)
  return m ? `${m[1]} pin ${m[2]}` : pin
}

// Compare the board's node partition to the schematic's. Equivalent iff two pins share a
// schematic net exactly when they share a board net (ports anchor the mapping). Returns the
// first problem found, with a student-friendly message.
export function checkEquivalence(s: Schematic, board: BoardLayout, holes: Hole[]): CheckResult {
  const exp = schematicExpectation(s)
  if (exp.parts.length === 0 && exp.dips.length === 0 && exp.transistors.length === 0 && exp.ports.length === 0) {
    return { ok: false, message: 'Draw a circuit in the Circuit tab first.' }
  }
  const placedPart = new Map(board.parts.map((p) => [p.id, p]))
  const placedDip = new Map((board.dips ?? []).map((d) => [d.id, d]))
  const placedTr = new Map((board.transistors ?? []).map((t) => [t.id, t]))

  for (const p of exp.parts) if (!placedPart.has(p.id)) return { ok: false, message: `Place ${p.id} on the board.` }
  for (const d of exp.dips) if (!placedDip.has(d.id)) return { ok: false, message: `Place ${d.id} on the board (straddle the channel).` }
  for (const tr of exp.transistors) if (!placedTr.has(tr.id)) return { ok: false, message: `Place ${tr.id} on the board (TO-92, three adjacent columns).` }
  // Ports are the always-present M2K terminals now; the student jumpers from them (no placement step).

  const bnets = boardNets(holes, board.jumpers)
  const bn = (k: string) => bnets.get(k) ?? `?${k}`

  const schem = new Map<string, string>()
  const brd = new Map<string, string>()
  for (const p of exp.parts) {
    const pl = placedPart.get(p.id)!
    schem.set(`${p.id}.A`, p.a); brd.set(`${p.id}.A`, bn(pl.aHole))
    schem.set(`${p.id}.B`, p.b); brd.set(`${p.id}.B`, bn(pl.bHole))
  }
  for (const d of exp.dips) {
    const pl = placedDip.get(d.id)!
    const holesForDip = dipPinHoles(d.kind, pl.col) ?? []
    d.pinNets.forEach((net, k) => {
      if (net === undefined) return // unused pin — no constraint
      schem.set(`${d.id}.p${k + 1}`, net)
      brd.set(`${d.id}.p${k + 1}`, bn(holesForDip[k] ?? `?${d.id}.${k}`))
    })
    // A powered part must have its supply pins on the rails.
    if (d.rails) {
      const vp = d.rails.vpos, vn = d.rails.vneg
      // TIA-3: single-supply parts want V− on GND; others on the V− rail.
      const vnegPort = d.rails.vnegTo === 'GND' ? 'GND' : 'V-'
      if (bn(holesForDip[vp] ?? '?') !== bn(PORT_TERMINAL['V+'])) return { ok: false, message: `Wire ${d.id} pin ${vp + 1} (V+) to the V+ rail.` }
      if (bn(holesForDip[vn] ?? '?') !== bn(PORT_TERMINAL[vnegPort] ?? '?')) {
        return { ok: false, message: vnegPort === 'GND'
          ? `Wire ${d.id} pin ${vn + 1} (V−) to the GND rail (single-supply part).`
          : `Wire ${d.id} pin ${vn + 1} (V−) to the V− rail.` }
      }
    }
    // Datasheet-mandated chip wiring (e.g. INA125 reference/sense/sleep straps). Each pin must
    // share a node with its target — another pin, or a supply rail.
    if (d.straps) {
      for (const sp of d.straps) {
        const pinNet = bn(holesForDip[sp.pin] ?? '?')
        const target = typeof sp.to === 'number'
          ? bn(holesForDip[sp.to] ?? '?')
          : bn(PORT_TERMINAL[sp.to] ?? '?')
        if (pinNet !== target) return { ok: false, message: `Wire ${d.id}: ${sp.label}.` }
      }
    }
  }
  for (const tr of exp.transistors) {
    const pl = placedTr.get(tr.id)!
    const holesForTr = to92PinHoles(pl.col, pl.row) ?? []
    tr.pinNets.forEach((net, k) => {
      schem.set(`${tr.id}.p${k + 1}`, net)
      brd.set(`${tr.id}.p${k + 1}`, bn(holesForTr[k] ?? `?${tr.id}.${k}`))
    })
  }
  for (const p of exp.ports) {
    schem.set(p.name, p.net); brd.set(p.name, bn(PORT_TERMINAL[p.name] ?? `?${p.name}`))
  }

  const pins = [...schem.keys()]
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const sameS = schem.get(pins[i]) === schem.get(pins[j])
      const sameB = brd.get(pins[i]) === brd.get(pins[j])
      if (sameS && !sameB) return { ok: false, message: `${pinLabel(pins[i])} and ${pinLabel(pins[j])} should be the same node — run a jumper.` }
      if (!sameS && sameB) return { ok: false, message: `${pinLabel(pins[i])} and ${pinLabel(pins[j])} are different nodes, but your board connects them.` }
    }
  }
  return { ok: true, message: '✓ Match — your board is electrically the schematic.' }
}

// ── F-7 / ARB-3: auto-routing — one valid inter-column jumper set from the placement ─────────────
// Pure and deterministic: given the schematic and the current placement (existing jumpers ignored),
// return a jumper set that makes `checkEquivalence` pass whenever the placement itself is solvable.
// The router is a new PRODUCER of Jumper[] against the existing Check — boardNets / checkEquivalence
// semantics are untouched. `manual` mode never calls it, `hint` overlays it (ghosted, annotated),
// `auto` applies it read-only. See docs/specs/board-autoroute.md.
//
// Algorithm: pair each placed pin with its schematic net exactly as checkEquivalence does, group the
// pins by the board's pre-wired groups (a terminal column, a rail, an M2K terminal — boardNets with
// no jumpers), then for each net spanning ≥ 2 groups emit a spanning tree (n−1 jumpers). A net that
// contains a supply hub (the V+/V−/GND terminal group, which POWER_WIRES pre-ties to its rail) is
// star-routed onto that rail — each column gets its own short rail drop, the way a student actually
// powers a board — instead of daisy-chained part-to-part. DIP rail pins and datasheet straps
// (INA125) are routed as fixed board-level edges. Endpoints prefer free holes near the far end, so
// the result reads as short tidy jumpers; correctness is defined by Check, not aesthetics.

export interface AutoJumper extends Jumper { note: string } // note: the hint overlay's "why"

export function autoRouteJumpers(s: Schematic, board: BoardLayout, holes: Hole[]): AutoJumper[] {
  const exp = schematicExpectation(s)
  const base = boardNets(holes, []) // pre-wired grouping only: columns, rails, terminals, POWER_WIRES
  const holeByKey = new Map(holes.map((h) => [h.key, h]))

  // Keys belonging to each pre-wired group (holes + the fixed M2K terminals), in a stable order.
  const groupKeys = new Map<string, string[]>()
  const addKey = (k: string) => {
    const g = base.get(k)
    if (!g) return
    const arr = groupKeys.get(g)
    if (arr) arr.push(k)
    else groupKeys.set(g, [k])
  }
  for (const h of holes) addKey(h.key)
  for (const t of TERMINALS) addKey(t.key)

  // Geometry for endpoint choice (terminals sit just off the board, above/below the strips).
  const posOf = (k: string): { x: number; y: number } => {
    const h = holeByKey.get(k)
    if (h) return { x: h.x, y: h.y }
    const t = TERMINALS.find((tt) => tt.key === k)!
    return { x: PAD + (t.col - 1) * PITCH, y: t.side === 'top' ? -PITCH : boardHeight() + PITCH }
  }

  // Holes already hosting a lead: part legs, DIP pins, TO-92 legs, the pre-wired power drops — and,
  // as we route, our own jumper ends (a real hole takes one lead).
  const used = new Set<string>()
  for (const p of board.parts) { used.add(p.aHole); used.add(p.bHole) }
  for (const d of board.dips ?? []) for (const k of dipPinHoles(d.kind, d.col) ?? []) used.add(k)
  for (const t of board.transistors ?? []) for (const k of to92PinHoles(t.col, t.row) ?? []) used.add(k)
  for (const w of POWER_WIRES) { used.add(w.a); used.add(w.b) }

  // Best key in group `g` to land a jumper near `near`: prefer a free hole, then shortest distance;
  // ties keep the first-seen key (stable hole order) so the result is deterministic.
  const pickIn = (g: string, near: { x: number; y: number }): string => {
    const keys = groupKeys.get(g) ?? []
    let best: string | null = null
    let bestD = Infinity
    let bestFree = false
    for (const k of keys) {
      const free = holeByKey.has(k) ? !used.has(k) : true // terminals can take several leads
      const p = posOf(k)
      const dd = (p.x - near.x) ** 2 + (p.y - near.y) ** 2
      if ((free && !bestFree) || (free === bestFree && dd < bestD)) { best = k; bestD = dd; bestFree = free }
    }
    return best ?? keys[0]
  }

  // Per-schematic-net pins: net → the placed board keys carrying it, with student-facing labels.
  // Pairing mirrors checkEquivalence: part legs, DIP pinNets, TO-92 legs, then the named ports.
  const netPins = new Map<string, { key: string; label: string }[]>()
  const addPin = (net: string | undefined, key: string | undefined, label: string) => {
    if (!net || !key) return
    const arr = netPins.get(net)
    if (arr) arr.push({ key, label })
    else netPins.set(net, [{ key, label }])
  }
  const placedPart = new Map(board.parts.map((p) => [p.id, p]))
  for (const p of exp.parts) {
    const pl = placedPart.get(p.id)
    if (!pl) continue
    addPin(p.a, pl.aHole, `${p.id}.A`)
    addPin(p.b, pl.bHole, `${p.id}.B`)
  }
  // Board-level requirements beyond the schematic nets: supply-rail pins + datasheet straps.
  const fixed: { a: string; b: string; note: string }[] = []
  const placedDip = new Map((board.dips ?? []).map((d) => [d.id, d]))
  for (const d of exp.dips) {
    const pl = placedDip.get(d.id)
    if (!pl) continue
    const hs = dipPinHoles(d.kind, pl.col) ?? []
    d.pinNets.forEach((net, k) => addPin(net, hs[k], `${d.id} pin ${k + 1}`))
    if (d.rails) {
      const vnegPort = d.rails.vnegTo === 'GND' ? 'GND' : 'V-'
      fixed.push({ a: hs[d.rails.vpos], b: PORT_TERMINAL['V+'], note: `${d.id} pin ${d.rails.vpos + 1} (V+) → the V+ rail (power)` })
      fixed.push({ a: hs[d.rails.vneg], b: PORT_TERMINAL[vnegPort], note: `${d.id} pin ${d.rails.vneg + 1} (V−) → the ${vnegPort} rail (power)` })
    }
    for (const sp of d.straps ?? []) {
      const to = typeof sp.to === 'number' ? hs[sp.to] : PORT_TERMINAL[sp.to]
      fixed.push({ a: hs[sp.pin], b: to, note: `${d.id}: ${sp.label}` })
    }
  }
  const placedTr = new Map((board.transistors ?? []).map((t) => [t.id, t]))
  for (const tr of exp.transistors) {
    const pl = placedTr.get(tr.id)
    if (!pl) continue
    const hs = to92PinHoles(pl.col, pl.row) ?? []
    tr.pinNets.forEach((net, k) => addPin(net, hs[k], `${tr.id} ${to92Legend(tr.kind)[k]}`))
  }
  for (const p of exp.ports) addPin(p.net, PORT_TERMINAL[p.name], p.name)

  // The pre-wired supply hubs: the group holding each supply terminal (which includes its rail).
  const hubs = new Map<string, string>() // group id → supply name
  for (const nm of ['V+', 'V-', 'GND']) {
    const g = base.get(PORT_TERMINAL[nm])
    if (g) hubs.set(g, nm)
  }

  // Union-find over the pre-wired groups mirrors the physical connectivity we have built so far,
  // so an edge already satisfied (e.g. a strap whose net routing connected it) is never duplicated.
  const uf = new Map<string, string>()
  const find = (a: string): string => {
    let r = a
    for (;;) {
      const p = uf.get(r)
      if (p === undefined || p === r) return r
      r = p
    }
  }
  const connect = (a: string, b: string): boolean => {
    const ra = find(a), rb = find(b)
    if (ra === rb) return false
    uf.set(ra, rb)
    return true
  }

  const out: AutoJumper[] = []
  const emit = (a: string, b: string, note: string) => {
    out.push({ a, b, note })
    if (holeByKey.has(a)) used.add(a)
    if (holeByKey.has(b)) used.add(b)
  }

  for (const pins of netPins.values()) {
    // The distinct pre-wired groups this net's pins land in.
    const byGroup = new Map<string, { key: string; label: string }[]>()
    for (const p of pins) {
      const g = base.get(p.key)
      if (!g) continue
      const arr = byGroup.get(g)
      if (arr) arr.push(p)
      else byGroup.set(g, [p])
    }
    if (byGroup.size < 2) continue // already common through one column/rail — no jumper needed
    const centroid = (g: string) => {
      const ps = byGroup.get(g)!.map((p) => posOf(p.key))
      return { x: ps.reduce((s2, p) => s2 + p.x, 0) / ps.length, y: ps.reduce((s2, p) => s2 + p.y, 0) / ps.length }
    }
    const labels = (g: string) => byGroup.get(g)!.map((p) => p.label).join(' + ')
    const groups = [...byGroup.keys()].sort((a, b) => centroid(a).x - centroid(b).x || centroid(a).y - centroid(b).y)
    const hub = groups.find((g) => hubs.has(g))
    if (hub !== undefined) {
      // Power/ground net: star each column onto the pre-wired rail (its own short rail drop).
      const name = hubs.get(hub)!
      for (const g of groups) {
        if (g === hub || !connect(g, hub)) continue
        const hubKey = pickIn(hub, centroid(g))
        const src = pickIn(g, posOf(hubKey))
        emit(src, hubKey, `${labels(g)} → the ${name} rail`)
      }
    } else {
      // Signal net: chain neighbouring groups left→right — a spanning tree of short jumpers.
      for (let i = 1; i < groups.length; i++) {
        const gA = groups[i - 1], gB = groups[i]
        if (!connect(gA, gB)) continue
        const aKey = pickIn(gA, centroid(gB))
        const bKey = pickIn(gB, posOf(aKey))
        emit(aKey, bKey, `${labels(gA)} ↔ ${labels(gB)} — one node`)
      }
    }
  }
  for (const f of fixed) {
    const ga = base.get(f.a), gb = base.get(f.b)
    if (!ga || !gb || !connect(ga, gb)) continue
    const bKey = pickIn(gb, posOf(f.a))
    const aKey = pickIn(ga, posOf(bKey))
    emit(aKey, bKey, f.note)
  }
  return out
}

// ── ARB-2: board-net → circuit-node map (the "active board" bridge) ─────────────────────────────
// The live sim reads node voltages under toCircuit's RENAMED node names ('in'/'out'/'0'/netN/…),
// while the board's connectivity is boardNets' net ids. This pure accessor bridges them: for every
// placed pin whose schematic net is known (same pairing checkEquivalence performs), map its board
// net to the schematic node the simulator uses. `checkEquivalence` itself is untouched.
//
// The raw-net → renamed-node step mirrors toCircuit's `rename()` (schematic.ts) — same port scan,
// same priority order. Keep the two in sync if port semantics ever change (they are WIRE-1 frozen).
// A board net paired with two DIFFERENT schematic nodes (a mis-wiring) is dropped: no reading is
// better than a wrong reading on a shorted/mis-jumpered net.
export function boardNodeMap(s: Schematic, board: BoardLayout, holes: Hole[]): Map<string, string> {
  const nets = computeNets(s)
  const rawNetOf = (c: { gx: number; gy: number }) => nets.get(`${c.gx},${c.gy}`)

  // Mirror of toCircuit's port scan → rename chain (ground first, then the named instrument nets).
  const groundNets = new Set<string>()
  let inNet: string | undefined, in2Net: string | undefined
  let outNet: string | undefined, outRefNet: string | undefined
  let scope2Net: string | undefined, scope2RefNet: string | undefined
  for (const c of s.components) {
    const net = rawNetOf(terminalsOf(c)[0])
    if (!net) continue
    if (c.kind === 'ground') groundNets.add(net)
    else if (c.kind === 'probe' || c.kind === 'scope1') outNet = net
    else if (c.kind === 'adc1n') outRefNet = net
    else if (c.kind === 'scope2') scope2Net = net
    else if (c.kind === 'adc2n') scope2RefNet = net
    else if (c.kind === 'vsource' || c.kind === 'awg1') inNet = net
    else if (c.kind === 'awg2') in2Net = net
  }
  const rename = (net: string): string =>
    groundNets.has(net) ? '0'
      : net === inNet ? 'in'
      : net === in2Net ? 'in2'
      : net === outNet ? 'out'
      : net === outRefNet ? 'out_n'
      : net === scope2Net ? 'scope2'
      : net === scope2RefNet ? 'scope2_n'
      : net

  const exp = schematicExpectation(s)
  const bnets = boardNets(holes, board.jumpers)
  const out = new Map<string, string>()
  const conflict = new Set<string>()
  const put = (pinKey: string | undefined, rawNet: string | undefined) => {
    if (!pinKey || !rawNet) return
    const bnet = bnets.get(pinKey)
    if (!bnet) return
    const node = rename(rawNet).toLowerCase() // ngspice lowercases variable names
    const prev = out.get(bnet)
    if (prev !== undefined && prev !== node) conflict.add(bnet)
    else out.set(bnet, node)
  }
  const placedPart = new Map(board.parts.map((p) => [p.id, p]))
  for (const p of exp.parts) {
    const pl = placedPart.get(p.id)
    if (pl) { put(pl.aHole, p.a); put(pl.bHole, p.b) }
  }
  const placedDip = new Map((board.dips ?? []).map((d) => [d.id, d]))
  for (const d of exp.dips) {
    const pl = placedDip.get(d.id)
    if (!pl) continue
    const hs = dipPinHoles(d.kind, pl.col) ?? []
    d.pinNets.forEach((net, k) => put(hs[k], net))
  }
  const placedTr = new Map((board.transistors ?? []).map((t) => [t.id, t]))
  for (const t of exp.transistors) {
    const pl = placedTr.get(t.id)
    if (!pl) continue
    const hs = to92PinHoles(pl.col, pl.row) ?? []
    t.pinNets.forEach((net, k) => put(hs[k], net))
  }
  for (const p of exp.ports) put(PORT_TERMINAL[p.name], p.net)
  for (const net of conflict) out.delete(net)
  return out
}
