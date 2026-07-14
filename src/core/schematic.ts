// Schematic model + conversion to the SPICE-2 Circuit graph. No React, no rendering.
// See docs/specs/schematic-ngspice.md (SCH-1). The editor (SchematicEditor.tsx) drives this
// model; `toCircuit()` is the seam consumed by the Network Analyzer / scope loop (SCH-2/LOOP-1).

import type { Circuit, Component as SpiceComponent } from './netlist'
import { TRANSISTOR_PARTS } from './netlist'
import { isKitOpamp } from './opamps'

export type SchKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode' // junction diode; terminal 'a' = anode, 'c' = cathode (bar end)
  | 'led' // LED; value = forward voltage Vf (V)
  | 'zener' // Zener diode; value = reverse breakdown voltage BV (V)
  | 'photodiode' // silicon PIN photodiode (BPW 34); value = photocurrent (A), an illumination knob
  | 'bjt' // bipolar transistor (SCH-8); `part` picks NPN/PNP + model. Terminals c/b/e.
  | 'mosfet' // MOSFET (SCH-8); `part` picks N/P channel + model. Terminals d/g/s.
  | 'vsource' // generator input source; terminal 'a' = +, 'b' = -
  | 'opamp'
  | 'lmc662' // LMC662 dual op-amp as an 8-pin DIP (two LMC662 sections + V+/V- rails)
  | 'ina125' // INA125 instrumentation amp — the only in-amp. Structural model; gain set by external R_G.
  | 'ground'
  | 'probe' // (legacy) marks the output node ('out') — same as 'scope1'
  | 'dcrail' // DC supply rail (power for active parts); value = volts
  // M2K instrument I/O (WIRE-1, reworked as TWO-TERMINAL devices — SCH-11): each is one symbol
  // with two leads, the honest textbook form. Legacy 'adc1n'/'adc2n' standalone reference ports
  // were absorbed into scope1/scope2 (see migrateSchematic for the load-time shim).
  | 'awg1' // W1 — 2-terminal source: t0 output → net 'in'; t1 ground return (bonded to node 0)
  | 'awg2' // W2 — 2-terminal source: t0 output → net 'in2'; t1 ground return (bonded to node 0)
  | 'scope1' // CH1 measurement input: t0 = 1+ → net 'out'; t1 = 1- → 'out_n' when wired, else single-ended
  | 'scope2' // CH2 measurement input: t0 = 2+ → net 'scope2'; t1 = 2- → 'scope2_n' when wired
  | 'vplus' // V+ — positive supply (0..+5 V)
  | 'vminus' // V- — negative supply (0..-5 V)

export interface SchComponent {
  id: string
  kind: SchKind
  gx: number // grid position (grid units)
  gy: number
  rotation?: number // 0..3 → 0/90/180/270 degrees clockwise (default 0)
  mirror?: boolean // flipped across the part's own vertical centerline (applied before rotation)
  // For kind 'scope1'/'scope2' (the shared measurement input): how the placed input is DISPLAYED —
  // oscilloscope (default) or voltmeter badge. Purely presentational: same port, same nets, same sim
  // (the M2K scope and voltmeter are the same 1±/2± input on one ADC).
  view?: 'scope' | 'voltmeter'
  value?: number // ohms / farads / henries (vsource uses AC 1)
  // SCH-13/ARB-7: for kind 'capacitor', whether it is a polarized electrolytic (drawn with a +, and
  // orientation-fixed on the board). Unset ⇒ derived from the kit rule (value ≥ 1 µF ⇒ electrolytic);
  // set explicitly to keep a ≥ 1 µF film/ceramic signal cap symmetric (e.g. the LC-filter caps).
  polarized?: boolean
  opModel?: 'ideal' | 'lmc662' // for kind 'opamp': ideal VCVS or the LMC662 behavioural model
  part?: string // for kind 'bjt' / 'mosfet': the ADALP2000 part name (key into TRANSISTOR_PARTS)
}

export interface Wire {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Schematic {
  components: SchComponent[]
  wires: Wire[]
}

export interface SchTerminal {
  name: string
  gx: number
  gy: number
}

// Base terminal offsets per kind (grid units), unrotated (horizontal) orientation.
// `opModel` matters only for kind 'opamp': the ideal (simulation-only) op-amp is a bare
// VCVS with no supply pins, so it exposes inP/inN/out only. The LMC662 (simulation+build)
// model is a real part that needs power, so it also exposes the V+/V- rail pins.
export function baseTerminals(kind: SchKind, opModel?: 'ideal' | 'lmc662'): SchTerminal[] {
  switch (kind) {
    case 'resistor':
    case 'capacitor':
    case 'inductor':
    case 'vsource':
      return [
        { name: 'a', gx: 0, gy: 0 },
        { name: 'b', gx: 2, gy: 0 },
      ]
    case 'diode':
    case 'led':
    case 'zener':
    case 'photodiode':
      return [
        { name: 'a', gx: 0, gy: 0 }, // anode (triangle side)
        { name: 'c', gx: 2, gy: 0 }, // cathode (bar side)
      ]
    case 'bjt':
      // base on the flat side (left), collector top-right, emitter bottom-right.
      return [
        { name: 'c', gx: 2, gy: 0 }, // collector
        { name: 'b', gx: 0, gy: 1 }, // base
        { name: 'e', gx: 2, gy: 2 }, // emitter
      ]
    case 'mosfet':
      // gate on the left, drain top-right, source bottom-right (bulk tied to source in sim).
      return [
        { name: 'd', gx: 2, gy: 0 }, // drain
        { name: 'g', gx: 0, gy: 1 }, // gate
        { name: 's', gx: 2, gy: 2 }, // source
      ]
    case 'opamp':
      // The op-amp is always a real LMC662 (no package-less "ideal" variant). Its schematic symbol
      // shows the signal pins only (power implied, ±5 V in sim); the full 8-pin DIP with V+/V- pins
      // appears on the breadboard, where the student wires the supplies.
      return [
        { name: 'inP', gx: 0, gy: 0 },
        { name: 'inN', gx: 0, gy: 2 },
        { name: 'out', gx: 4, gy: 1 },
      ]
    case 'lmc662':
      // 8-pin DIP, real pinout. Left side pins 1-4 top→bottom, right side pins 5-8 bottom→top.
      return [
        { name: 'outA', gx: 0, gy: 0 },   // 1: OUT A
        { name: 'inAneg', gx: 0, gy: 1 }, // 2: -IN A
        { name: 'inApos', gx: 0, gy: 2 }, // 3: +IN A
        { name: 'vneg', gx: 0, gy: 3 },   // 4: V-
        { name: 'inBpos', gx: 4, gy: 3 }, // 5: +IN B
        { name: 'inBneg', gx: 4, gy: 2 }, // 6: -IN B
        { name: 'outB', gx: 4, gy: 1 },   // 7: OUT B
        { name: 'vpos', gx: 4, gy: 0 },   // 8: V+
      ]
    case 'ina125':
      // INA125 schematic symbol pins (power implied; full 16-pin DIP on the board). RG1/RG2 take the
      // external gain resistor; IAREF is the output reference (tie to GND).
      return [
        { name: 'inP', gx: 0, gy: 0 },   // VIN+
        { name: 'inN', gx: 0, gy: 2 },   // VIN−
        { name: 'out', gx: 7, gy: 1 },   // VO
        { name: 'rg1', gx: 2, gy: 4 },   // RG (pin 8)
        { name: 'rg2', gx: 4, gy: 4 },   // RG (pin 9)
        { name: 'iaref', gx: 6, gy: 4 }, // IAREF — separated from the RG pair; tie to GND
      ]
    case 'awg1':
    case 'awg2':
      // Two-terminal source (vertical, like the catalog bipole): output on top, the M2K's
      // internally-bonded ground return below (drawn with a built-in ground, forced to node 0).
      return [
        { name: 'out', gx: 0, gy: 0 },
        { name: 'ret', gx: 0, gy: 2 },
      ]
    case 'scope1':
    case 'scope2':
      // Two-terminal measurement input (one scope/voltmeter per channel): + on top, − below.
      // The − lead unwired = single-ended (ground reference); wired = differential.
      return [
        { name: 'p', gx: 0, gy: 0 },
        { name: 'n', gx: 0, gy: 2 },
      ]
    case 'ground':
    case 'probe':
    case 'dcrail':
    case 'vplus':
    case 'vminus':
      return [{ name: 'p', gx: 0, gy: 0 }]
  }
}

// Rotate a grid offset by r quarter-turns clockwise (screen coords, y down).
export function rotateOffset(dx: number, dy: number, r: number): [number, number] {
  switch (((r % 4) + 4) % 4) {
    case 0: return [dx, dy]
    case 1: return [-dy, dx]
    case 2: return [-dx, -dy]
    default: return [dy, -dx]
  }
}

// Base terminal offsets with the component's mirror applied (still unrotated). The mirror
// axis is the vertical centerline of the part's base footprint (gx → minX+maxX − gx), so a
// flip swaps terminals in place — the part does not translate — and every kind's mirrored
// offsets stay on-grid (min+max is an integer for all kinds). Mirror composes BEFORE
// rotation: the flip happens in the part's own frame, then the whole part rotates.
export function localTerminals(c: Pick<SchComponent, 'kind' | 'opModel' | 'mirror'>): SchTerminal[] {
  const base = baseTerminals(c.kind, c.opModel)
  if (!c.mirror) return base
  let min = base[0].gx, max = base[0].gx
  for (const t of base) { min = Math.min(min, t.gx); max = Math.max(max, t.gx) }
  return base.map((t) => ({ ...t, gx: min + max - t.gx }))
}

// Absolute (mirrored + rotated) terminal grid positions for net computation and rendering.
export function terminalsOf(c: SchComponent): SchTerminal[] {
  const r = c.rotation ?? 0
  return localTerminals(c).map((t) => {
    const [dx, dy] = rotateOffset(t.gx, t.gy, r)
    return { name: t.name, gx: c.gx + dx, gy: c.gy + dy }
  })
}

// Whether the grid point (gx,gy) is shared by more than one terminal or wire endpoint — i.e.
// something is actually wired to it. Mirrors toCircuit's local `connected` rule (occupancy > 1),
// and is the single-ended test for a scope − lead: an unshared − point is referenced to ground.
// Exported so the renderer draws the ground stub on exactly the leads toCircuit grounds — keep
// this definition in sync with the `connected` closure in toCircuit.
export function isPointConnected(s: Schematic, gx: number, gy: number): boolean {
  let n = 0
  for (const c of s.components) for (const t of terminalsOf(c)) if (t.gx === gx && t.gy === gy && ++n > 1) return true
  for (const w of s.wires) {
    if (w.x1 === gx && w.y1 === gy && ++n > 1) return true
    if (w.x2 === gx && w.y2 === gy && ++n > 1) return true
  }
  return false
}

// Whether a part is a simulation-only model (ideal, no supplies needed) or a
// simulation+build part (a real device that needs explicit V+/V- rails, like the LMC662).
// Returns null for parts that are not amplifiers. Single source of truth for the editor badge.
export function ampCategory(c: SchComponent): 'sim' | 'build' | null {
  switch (c.kind) {
    case 'opamp': return 'build'
    case 'lmc662': return 'build'
    case 'ina125': return 'build'
    default: return null
  }
}

const key = (x: number, y: number) => `${x},${y}`

// Union-find over coordinate keys. Points that coincide share a key (auto-connected);
// wires union their endpoints. Returns pointKey → netName.
export function computeNets(s: Schematic): Map<string, string> {
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

  for (const c of s.components) for (const t of terminalsOf(c)) ensure(key(t.gx, t.gy))
  for (const w of s.wires) union(key(w.x1, w.y1), key(w.x2, w.y2))

  const rootName = new Map<string, string>()
  let n = 0
  const out = new Map<string, string>()
  for (const k of parent.keys()) {
    const r = find(k)
    if (!rootName.has(r)) rootName.set(r, `net${n++}`)
    out.set(k, rootName.get(r)!)
  }
  return out
}

// The computeNets nets that ARE node 0: every ground symbol the designer drew, plus the W1/W2
// ground returns (the M2K's fixed internal bond — instrument model Rule 1). Nothing is inferred
// here: a scope − reaches this set only when the designer explicitly wired it to a ground, which
// is exactly how a single-ended measurement is expressed (completeness corollary).
//
// CHECK-1: this is the SINGLE source of truth for "what is ground", shared by toCircuit's rename,
// the board Check (schematicExpectation) and boardNodeMap. Ground symbols are repeatable, so a
// schematic has many raw ground nets that are one node — a consumer that skips this fold sees
// nodes that differ on the schematic but not on the board, and reports shorts that do not exist.
export function groundNetsOf(s: Schematic, nets: Map<string, string>): Set<string> {
  const out = new Set<string>()
  const add = (t: SchTerminal | undefined) => {
    const n = t && nets.get(key(t.gx, t.gy))
    if (n) out.add(n)
  }
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (c.kind === 'ground') add(ts[0])
    else if (c.kind === 'awg1' || c.kind === 'awg2') add(ts[1]) // the drawn return
  }
  return out
}

// ── Rubber-band wires (EDIT-1) ─────────────────────────────────────────────────
// When a component moves or rotates, wire endpoints sitting on its terminals follow, so
// connections stretch instead of breaking. Connectivity here is by coordinate coincidence,
// so a wire left behind would silently disconnect — these helpers keep it attached.

export type WireEndRef = { index: number; end: 1 | 2 }

// Wire endpoints currently coincident with any terminal of component `c`. Captured at drag
// start so the editor moves exactly these, never grabbing a wire it merely passes over.
export function attachedWireEnds(s: Schematic, c: SchComponent): WireEndRef[] {
  const terms = new Set(terminalsOf(c).map((t) => key(t.gx, t.gy)))
  const out: WireEndRef[] = []
  s.wires.forEach((w, index) => {
    if (terms.has(key(w.x1, w.y1))) out.push({ index, end: 1 })
    if (terms.has(key(w.x2, w.y2))) out.push({ index, end: 2 })
  })
  return out
}

// Touch-connections (two terminals sharing a grid point with no wire) would silently break when a
// part is dragged away. For each terminal of the moved set whose OLD position is also occupied by a
// *stationary* component terminal, return a new wire bridging that point to the terminal's new
// location — so the connection rubber-bands into a real, visible wire instead of snapping.
export function bridgeWiresForMove(
  s: Schematic, movedIds: Set<string>, dgx: number, dgy: number,
): Wire[] {
  if (dgx === 0 && dgy === 0) return []
  const stationary = new Set<string>()
  for (const c of s.components) {
    if (movedIds.has(c.id)) continue
    for (const t of terminalsOf(c)) stationary.add(key(t.gx, t.gy))
  }
  const bridges: Wire[] = []
  const seen = new Set<string>()
  for (const c of s.components) {
    if (!movedIds.has(c.id)) continue
    for (const t of terminalsOf(c)) {
      const p = key(t.gx, t.gy)
      if (stationary.has(p) && !seen.has(p)) {
        seen.add(p)
        bridges.push({ x1: t.gx, y1: t.gy, x2: t.gx + dgx, y2: t.gy + dgy })
      }
    }
  }
  return bridges
}

// Move component `id` to (gx,gy), carrying the given attached wire endpoints by the same delta.
export function moveComponentWithWires(
  s: Schematic, id: string, gx: number, gy: number, attached: WireEndRef[],
): Schematic {
  const c = s.components.find((x) => x.id === id)
  if (!c) return s
  const dgx = gx - c.gx, dgy = gy - c.gy
  if (dgx === 0 && dgy === 0) return s
  const m = new Set(attached.map((a) => `${a.index}:${a.end}`))
  const bridges = bridgeWiresForMove(s, new Set([id]), dgx, dgy)
  return {
    components: s.components.map((x) => (x.id === id ? { ...x, gx, gy } : x)),
    wires: [
      ...s.wires.map((w, i) => {
        let nw = w
        if (m.has(`${i}:1`)) nw = { ...nw, x1: nw.x1 + dgx, y1: nw.y1 + dgy }
        if (m.has(`${i}:2`)) nw = { ...nw, x2: nw.x2 + dgx, y2: nw.y2 + dgy }
        return nw
      }),
      ...bridges,
    ],
  }
}

// Translate a SET of components by (ddx, ddy), carrying along any wire endpoint that sits on a
// selected component's terminal. A wire between two selected parts translates whole; a wire from a
// selected part to a non-selected one stretches. Used for multi-select group drag in the editor.
export function moveComponentsBy(s: Schematic, ids: Set<string>, ddx: number, ddy: number): Schematic {
  if ((ddx === 0 && ddy === 0) || ids.size === 0) return s
  const moved = new Set<string>()
  const selCoords = new Set<string>()
  for (const c of s.components) {
    if (!ids.has(c.id)) continue
    moved.add(c.id)
    for (const t of terminalsOf(c)) selCoords.add(key(t.gx, t.gy))
  }
  return {
    components: s.components.map((c) => (moved.has(c.id) ? { ...c, gx: c.gx + ddx, gy: c.gy + ddy } : c)),
    wires: [
      ...s.wires.map((w) => {
        const e1 = selCoords.has(key(w.x1, w.y1))
        const e2 = selCoords.has(key(w.x2, w.y2))
        return {
          x1: e1 ? w.x1 + ddx : w.x1, y1: e1 ? w.y1 + ddy : w.y1,
          x2: e2 ? w.x2 + ddx : w.x2, y2: e2 ? w.y2 + ddy : w.y2,
        }
      }),
      ...bridgeWiresForMove(s, moved, ddx, ddy),
    ],
  }
}

// Group move for a box selection: translate the given component ids AND the given wire endpoints
// (refs "<index>:1" / "<index>:2") by (ddx, ddy). Wire endpoints also move if they sit on a
// selected component's terminal, so connections stay attached. This is the "move everything in the
// box" behaviour — components and the wire segments inside the box travel together.
export function moveSelectionBy(
  s: Schematic, ids: Set<string>, wireEnds: Set<string>, ddx: number, ddy: number,
): Schematic {
  if ((ddx === 0 && ddy === 0) || (ids.size === 0 && wireEnds.size === 0)) return s
  const moved = new Set<string>()
  const selCoords = new Set<string>()
  for (const c of s.components) {
    if (!ids.has(c.id)) continue
    moved.add(c.id)
    for (const t of terminalsOf(c)) selCoords.add(key(t.gx, t.gy))
  }
  return {
    components: s.components.map((c) => (moved.has(c.id) ? { ...c, gx: c.gx + ddx, gy: c.gy + ddy } : c)),
    wires: [
      ...s.wires.map((w, i) => {
        const m1 = selCoords.has(key(w.x1, w.y1)) || wireEnds.has(`${i}:1`)
        const m2 = selCoords.has(key(w.x2, w.y2)) || wireEnds.has(`${i}:2`)
        return {
          x1: m1 ? w.x1 + ddx : w.x1, y1: m1 ? w.y1 + ddy : w.y1,
          x2: m2 ? w.x2 + ddx : w.x2, y2: m2 ? w.y2 + ddy : w.y2,
        }
      }),
      ...bridgeWiresForMove(s, moved, ddx, ddy),
    ],
  }
}

// Rotate component `id` one quarter-turn clockwise, carrying terminal-attached wire endpoints
// to the rotated terminal positions (matched by terminal index).
export function rotateComponentWithWires(s: Schematic, id: string): Schematic {
  const c = s.components.find((x) => x.id === id)
  if (!c) return s
  const oldT = terminalsOf(c)
  const nc = { ...c, rotation: (((c.rotation ?? 0) + 1) % 4) }
  const newT = terminalsOf(nc)
  const map = new Map<string, { gx: number; gy: number }>()
  oldT.forEach((t, i) => map.set(key(t.gx, t.gy), { gx: newT[i].gx, gy: newT[i].gy }))
  return {
    components: s.components.map((x) => (x.id === id ? nc : x)),
    wires: s.wires.map((w) => {
      let nw = w
      const a = map.get(key(w.x1, w.y1)); if (a) nw = { ...nw, x1: a.gx, y1: a.gy }
      const b = map.get(key(w.x2, w.y2)); if (b) nw = { ...nw, x2: b.gx, y2: b.gy }
      return nw
    }),
  }
}

// SCH-14: the schematic canvas is scroll-free, so a part swung/dragged past the edge becomes
// invisible and unreachable (effectively lost, though still in the model). These helpers keep every
// terminal inside [0..maxGx] × [0..maxGy] on move and rotate, and recover already-off-canvas saves.

// Terminal bounding box of a component in absolute grid coords (includes the origin).
export function componentTerminalBox(c: SchComponent): { minx: number; miny: number; maxx: number; maxy: number } {
  let minx = c.gx, miny = c.gy, maxx = c.gx, maxy = c.gy
  for (const t of terminalsOf(c)) {
    if (t.gx < minx) minx = t.gx; if (t.gy < miny) miny = t.gy
    if (t.gx > maxx) maxx = t.gx; if (t.gy > maxy) maxy = t.gy
  }
  return { minx, miny, maxx, maxy }
}

// Minimal (dgx,dgy) that brings c's terminals inside [0..maxGx] × [0..maxGy] — (0,0) if already
// inside; aligns to the top/left edge if the part is larger than the region.
export function clampComponentDelta(c: SchComponent, maxGx: number, maxGy: number): { dgx: number; dgy: number } {
  const b = componentTerminalBox(c)
  let dgx = 0, dgy = 0
  if (b.minx < 0) dgx = -b.minx; else if (b.maxx > maxGx) dgx = maxGx - b.maxx
  if (b.miny < 0) dgy = -b.miny; else if (b.maxy > maxGy) dgy = maxGy - b.maxy
  return { dgx, dgy }
}

// Clamp a move target so the moved component's terminals stay fully on-canvas (rotation/mirror kept).
export function clampMoveTarget(c: SchComponent, gx: number, gy: number, maxGx: number, maxGy: number): { gx: number; gy: number } {
  const b = componentTerminalBox(c)
  const offMinX = b.minx - c.gx, offMaxX = b.maxx - c.gx, offMinY = b.miny - c.gy, offMaxY = b.maxy - c.gy
  const clamp = (v: number, lo: number, hi: number) => { const r = Math.min(Math.max(v, lo), Math.max(lo, hi)); return r === 0 ? 0 : r }
  return { gx: clamp(gx, -offMinX, maxGx - offMaxX), gy: clamp(gy, -offMinY, maxGy - offMaxY) }
}

// Rotate a component one quarter-turn, then clamp it (with its wires) back on-canvas — a rotation near
// the edge shifts inward to fit rather than swinging a terminal off and losing the part.
export function rotateComponentInBounds(s: Schematic, id: string, maxGx: number, maxGy: number): Schematic {
  const rotated = rotateComponentWithWires(s, id)
  const rc = rotated.components.find((x) => x.id === id)
  if (!rc) return rotated
  const { dgx, dgy } = clampComponentDelta(rc, maxGx, maxGy)
  if (!dgx && !dgy) return rotated
  return moveComponentWithWires(rotated, id, rc.gx + dgx, rc.gy + dgy, attachedWireEnds(rotated, rc))
}

// Pull every off-canvas component (and its attached wires) back into view. Returns the same object if
// nothing was out of bounds.
//
// NOT wired to the editor any more — do not re-add it on mount/open (FIT-1). It clamps each part
// independently, so when the box is smaller than the drawing it does not translate the circuit, it
// SHEARS it: parts collapse onto each other and nets merge (in the short stacked Board pane every
// example lost nets — rc-lp 6→4, summing 9→4 — silently changing the circuit and autosaving it).
// Keeping the whole drawing reachable is the viewport's job now: SchematicEditor auto-fits the view
// to the content (core/viewport.ts), so nothing can be off-canvas and nothing has to be moved.
export function clampAllInBounds(s: Schematic, maxGx: number, maxGy: number): Schematic {
  let cur = s, changed = false
  for (const c of s.components) {
    const cc = cur.components.find((x) => x.id === c.id)!
    const { dgx, dgy } = clampComponentDelta(cc, maxGx, maxGy)
    if (dgx || dgy) { cur = moveComponentWithWires(cur, c.id, cc.gx + dgx, cc.gy + dgy, attachedWireEnds(cur, cc)); changed = true }
  }
  return changed ? cur : s
}

// Orthogonal two-segment route between grid points (pin-magnetic modeless wiring, Stage 3).
// Horizontal leg first, bending at (b.x, a.y); collinear points give one segment, identical
// points none. The preview draws exactly these segments, so what you see is what commits.
export function orthoRoute(a: { x: number; y: number }, b: { x: number; y: number }): Wire[] {
  const segs: Wire[] = []
  if (b.x !== a.x) segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: a.y })
  if (b.y !== a.y) segs.push({ x1: b.x, y1: a.y, x2: b.x, y2: b.y })
  return segs
}

// ── SCH-16: re-route a wire without deleting it ────────────────────────────────
// The two halves of "move a connection": drag one END of a wire to re-attach it somewhere else, or
// drag the wire's BODY to slide the whole run out of the way. Both are pure; the editor supplies the
// snapped grid target (its endpoint drag snaps magnetically to pins, as the wiring gesture does).

// Move one endpoint of wire `index` to (gx,gy). Detaching an end from a pin is the POINT of the
// gesture (you are re-routing), so nothing is bridged here — connectivity follows the endpoints, and
// dropping the end on a pin/node connects it there. A zero-length wire is refused, not created.
export function moveWireEnd(s: Schematic, index: number, end: 1 | 2, gx: number, gy: number): Schematic {
  const w = s.wires[index]
  if (!w) return s
  const nw: Wire = end === 1 ? { ...w, x1: gx, y1: gy } : { ...w, x2: gx, y2: gy }
  if (nw.x1 === nw.x2 && nw.y1 === nw.y2) return s
  if (nw.x1 === w.x1 && nw.y1 === w.y1 && nw.x2 === w.x2 && nw.y2 === w.y2) return s
  return { components: s.components, wires: s.wires.map((x, i) => (i === index ? nw : x)) }
}

// Translate the whole wire `index` by (dgx,dgy). An end that was sitting ON a component terminal is a
// real connection, so sliding the run would silently break it — each such end gets an orthogonal
// bridge from the pin to where the end landed. Same rule the part drag uses (bridgeWiresForMove), so
// "the connection stretches, it does not snap" holds however you grab the drawing.
export function moveWireBy(s: Schematic, index: number, dgx: number, dgy: number): Schematic {
  const w = s.wires[index]
  if (!w || (dgx === 0 && dgy === 0)) return s
  const pins = new Set<string>()
  for (const c of s.components) for (const t of terminalsOf(c)) pins.add(key(t.gx, t.gy))
  const moved: Wire = { x1: w.x1 + dgx, y1: w.y1 + dgy, x2: w.x2 + dgx, y2: w.y2 + dgy }
  const bridges: Wire[] = []
  if (pins.has(key(w.x1, w.y1))) bridges.push(...orthoRoute({ x: w.x1, y: w.y1 }, { x: moved.x1, y: moved.y1 }))
  if (pins.has(key(w.x2, w.y2))) bridges.push(...orthoRoute({ x: w.x2, y: w.y2 }, { x: moved.x2, y: moved.y2 }))
  return {
    components: s.components,
    wires: [...s.wires.map((x, i) => (i === index ? moved : x)), ...bridges],
  }
}

// The wire endpoints coincident with (gx,gy) — the editor's grab test for an endpoint drag.
export function wireEndsAt(s: Schematic, gx: number, gy: number): WireEndRef[] {
  const out: WireEndRef[] = []
  s.wires.forEach((w, index) => {
    if (w.x1 === gx && w.y1 === gy) out.push({ index, end: 1 })
    if (w.x2 === gx && w.y2 === gy) out.push({ index, end: 2 })
  })
  return out
}

// SCH-15: after a part/selection move, an attached wire whose OTHER end stayed put has gone diagonal
// (its moved endpoint followed the terminal, the far end didn't). Re-route each such wire orthogonally
// (an L bend) so connections read clean instead of stretching to diagonals. Endpoints are unchanged,
// so nets are identical — this is purely cosmetic tidy-up. A wire with both ends on moved terminals
// translated straight and is left alone; a wire already axis-aligned is left alone.
export function rerouteAttachedWires(s: Schematic, movedIds: Set<string>): Schematic {
  if (movedIds.size === 0) return s
  const movedPts = new Set<string>()
  for (const c of s.components) if (movedIds.has(c.id)) for (const t of terminalsOf(c)) movedPts.add(key(t.gx, t.gy))
  let changed = false
  const wires: Wire[] = []
  for (const w of s.wires) {
    const e1 = movedPts.has(key(w.x1, w.y1)), e2 = movedPts.has(key(w.x2, w.y2))
    if (e1 === e2) { wires.push(w); continue }              // both ends moved, or neither → keep
    const fixed = e1 ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 }
    const moved = e1 ? { x: w.x1, y: w.y1 } : { x: w.x2, y: w.y2 }
    if (fixed.x === moved.x || fixed.y === moved.y) { wires.push(w); continue } // already orthogonal
    wires.push(...orthoRoute(fixed, moved))                 // route from the fixed end back to the terminal
    changed = true
  }
  return changed ? { ...s, wires } : s
}

// Whether F (flip) does anything for a kind. Single-pin parts (ports, ground, rails) mirror to
// themselves, and the INA125 keeps its inline (non-catalog) render, which does not honour
// mirror — flipping its model but not its artwork would lie about where the pins are.
export function canMirror(kind: SchKind): boolean {
  if (kind === 'ina125') return false
  return baseTerminals(kind).length > 1
}

// Toggle component `id`'s mirror, carrying terminal-attached wire endpoints to the mirrored
// terminal positions (matched by terminal index) — the same rubber-band contract as rotate.
// The flip is a model-space mirror of the terminal offsets (localTerminals); the renderer
// re-derives the artwork from the mirrored terminals via the SCH-11 alignment transform, so
// symbols with a baked-in reflection (the op-amp) cannot double-flip.
export function mirrorComponentWithWires(s: Schematic, id: string): Schematic {
  const c = s.components.find((x) => x.id === id)
  if (!c || !canMirror(c.kind)) return s
  const oldT = terminalsOf(c)
  const nc = { ...c, mirror: !c.mirror || undefined }
  const newT = terminalsOf(nc)
  const map = new Map<string, { gx: number; gy: number }>()
  oldT.forEach((t, i) => map.set(key(t.gx, t.gy), { gx: newT[i].gx, gy: newT[i].gy }))
  return {
    components: s.components.map((x) => (x.id === id ? nc : x)),
    wires: s.wires.map((w) => {
      let nw = w
      const a = map.get(key(w.x1, w.y1)); if (a) nw = { ...nw, x1: a.gx, y1: a.gy }
      const b = map.get(key(w.x2, w.y2)); if (b) nw = { ...nw, x2: b.gx, y2: b.gy }
      return nw
    }),
  }
}

// Deleting a part must take its hookup wires with it: connectivity is coordinate coincidence, so a
// wire left behind still LOOKS attached but drives nothing — a dangling stub students misread as a
// live connection. Removes the components in `ids` (plus any explicitly selected wires in
// `wireIdx`), every wire whose endpoint sat on a deleted terminal, and then prunes wire chains the
// removal left fully dangling. Pruning stops at surviving parts' pins and at junctions where two or
// more remaining wires still meet (they interconnect whatever is on their far ends).
export function deleteComponentsWithWires(
  s: Schematic, ids: Set<string>, wireIdx: Set<number> = new Set(),
): Schematic {
  const keptTerms = new Set<string>()
  const doomedTerms = new Set<string>()
  for (const c of s.components) {
    const dst = ids.has(c.id) ? doomedTerms : keptTerms
    for (const t of terminalsOf(c)) dst.add(key(t.gx, t.gy))
  }
  const removed = new Set<number>(wireIdx)
  // Direct pass: any wire endpoint on a deleted terminal dangles — unless a surviving component's
  // terminal shares that grid point (a touch connection: the wire also serves the survivor).
  const seed = (p: string) => doomedTerms.has(p) && !keptTerms.has(p)
  s.wires.forEach((w, i) => {
    if (seed(key(w.x1, w.y1)) || seed(key(w.x2, w.y2))) removed.add(i)
  })
  // Cascade: a removal can strand a multi-segment route at a bend. A surviving wire whose endpoint
  // is a freed point (endpoint of a removed wire, not a surviving terminal) with no other surviving
  // wire meeting it there is a stub — remove it and repeat until stable.
  for (let changed = true; changed; ) {
    changed = false
    const freed = new Set<string>()
    const degree = new Map<string, number>()
    s.wires.forEach((w, i) => {
      const pts = [key(w.x1, w.y1), key(w.x2, w.y2)]
      if (removed.has(i)) pts.forEach((p) => freed.add(p))
      else pts.forEach((p) => degree.set(p, (degree.get(p) ?? 0) + 1))
    })
    s.wires.forEach((w, i) => {
      if (removed.has(i)) return
      const stub = (p: string) => freed.has(p) && !keptTerms.has(p) && degree.get(p) === 1
      if (stub(key(w.x1, w.y1)) || stub(key(w.x2, w.y2))) { removed.add(i); changed = true }
    })
  }
  return {
    components: s.components.filter((c) => !ids.has(c.id)),
    wires: s.wires.filter((_, i) => !removed.has(i)),
  }
}

// Load-time shim for schematics saved before the two-terminal instrument rework: the standalone
// 1-/2- reference ports ('adc1n'/'adc2n') were absorbed into scope1/scope2 as the − terminal.
// Each legacy reference port becomes a wire from its channel's new − pin to wherever the old
// port sat, preserving the differential hookup; with no matching scope placed it referenced
// nothing and is dropped. Also drops any other unknown kind so stale saves cannot crash the app.
// INST-1 / Rule 3: the M2K I/O are singletons — one ADC pair per channel, one AWG pair, one supply
// rail each. At most one of these kinds may exist in a schematic. GND is repeatable (shared node 0).
export const SINGLETON_KINDS = new Set<SchKind>(['scope1', 'scope2', 'awg1', 'awg2', 'vplus', 'vminus'])
export const hasKind = (s: Schematic, k: SchKind): boolean => s.components.some((c) => c.kind === k)

export function migrateSchematic(s: Schematic): Schematic {
  const isLegacyRef = (k: string) => k === 'adc1n' || k === 'adc2n'
  const known = (c: SchComponent) => { try { return baseTerminals(c.kind, c.opModel).length > 0 } catch { return false } }
  const legacy = s.components.filter((c) => isLegacyRef(c.kind as string))
  // Rule 3: a legacy/hand-edited file could carry two of a singleton — keep the first, drop extras.
  const seen = new Set<SchKind>()
  const dupeSingleton = (c: SchComponent) => {
    if (!SINGLETON_KINDS.has(c.kind)) return false
    if (seen.has(c.kind)) return true
    seen.add(c.kind); return false
  }
  const extras = s.components.filter((c) => SINGLETON_KINDS.has(c.kind)).length
    > new Set(s.components.filter((c) => SINGLETON_KINDS.has(c.kind)).map((c) => c.kind)).size
  if (!legacy.length && !extras && s.components.every(known)) return s
  seen.clear()
  const comps = s.components.filter((c) => {
    if (isLegacyRef(c.kind as string) || !known(c)) return false
    if (dupeSingleton(c)) { console.warn(`migrateSchematic: dropped extra ${c.kind} (M2K singleton — one per schematic)`); return false }
    return true
  })
  const wires = [...s.wires]
  for (const a of legacy) {
    const plusKind = (a.kind as string) === 'adc1n' ? 'scope1' : 'scope2'
    const scope = comps.find((c) => c.kind === plusKind)
    if (!scope) continue
    const neg = terminalsOf(scope).find((t) => t.name === 'n')!
    if (neg.gx !== a.gx || neg.gy !== a.gy) wires.push({ x1: neg.gx, y1: neg.gy, x2: a.gx, y2: a.gy })
  }
  return { components: comps, wires }
}

export interface ToCircuitResult {
  circuit: Circuit
  warnings: string[]
  // SPICE node each scope input is wired to (WIRE-3 readback). undefined if the port is not
  // placed. ch1 = 1+ node, ch2 = 2+ node. Lets the scope show whatever node a probe sits on.
  // chNIncomplete: the channel is placed but its − is unwired (incomplete/floating) — the sampler
  // renders no trace for it rather than inferring a ground reference (Rule 2).
  probes: { ch1?: string; ch1n?: string; ch2?: string; ch2n?: string; ch1Incomplete?: boolean; ch2Incomplete?: boolean }
}

// Convert the schematic to a SPICE-2 Circuit. Net labelling: ground→'0', W1→'in', 1+→'out',
// 1-→'out_n', etc. Marker ports (ground / scope / probe) emit no SPICE device.
export function toCircuit(s: Schematic, title = 'Schematic'): ToCircuitResult {
  const nets = computeNets(s)
  const netOf = (gx: number, gy: number) => nets.get(key(gx, gy)) ?? `net_${gx}_${gy}`
  const warnings: string[] = []

  // A terminal is "connected" iff something else shares its grid point (a wire endpoint or
  // another part's pin) — nets only ever grow through point coincidence, so a lone point is a
  // singleton net. Drives the scope's single-ended rule: an unwired − pin means ground reference.
  const occ = new Map<string, number>()
  const bump = (k: string) => occ.set(k, (occ.get(k) ?? 0) + 1)
  for (const c of s.components) for (const t of terminalsOf(c)) bump(key(t.gx, t.gy))
  for (const w of s.wires) { bump(key(w.x1, w.y1)); bump(key(w.x2, w.y2)) }
  const connected = (t: SchTerminal) => (occ.get(key(t.gx, t.gy)) ?? 0) > 1

  const groundNets = groundNetsOf(s, nets) // ground symbols + the W1/W2 returns → node '0'
  let inNet: string | undefined
  let in2Net: string | undefined
  let railNet: string | undefined // a DC supply rail (V+/V-) also counts as a source (DC labs)
  let outNet: string | undefined
  let outRefNet: string | undefined
  let scope2Net: string | undefined
  let scope2RefNet: string | undefined
  // INST-1 / Rule 2: the scope − is a DESIGNER choice, never auto-grounded. Track whether each
  // placed channel's − is wired so an unwired − is flagged incomplete — NOT silently referenced
  // to ground (that inferred connection is forbidden by the completeness corollary).
  let scope1Placed = false, scope1NegWired = false
  let scope2Placed = false, scope2NegWired = false
  for (const c of s.components) {
    const ts = terminalsOf(c)
    const net = netOf(ts[0].gx, ts[0].gy)
    if (c.kind === 'probe') outNet = net
    else if (c.kind === 'scope1') {
      // + → probe net; − → reference net when wired: to GND = single-ended (renames to '0'),
      // to a node = differential. Left open = incomplete (flagged below, no inferred ground).
      outNet = net; scope1Placed = true
      if (connected(ts[1])) { outRefNet = netOf(ts[1].gx, ts[1].gy); scope1NegWired = true }
    } else if (c.kind === 'scope2') {
      scope2Net = net; scope2Placed = true
      if (connected(ts[1])) { scope2RefNet = netOf(ts[1].gx, ts[1].gy); scope2NegWired = true }
    } else if (c.kind === 'vsource') inNet = net
    else if (c.kind === 'awg1' || c.kind === 'awg2') {
      // t0 = output; t1 = the drawn ground return — bonded to the M2K's one internal ground, so its
      // whole net is forced to node 0 (in groundNetsOf). W1 and W2 SHARE it (no per-generator 0).
      if (c.kind === 'awg1') inNet = net; else in2Net = net
    } else if (c.kind === 'vplus' || c.kind === 'vminus' || c.kind === 'dcrail') railNet = net
  }
  if (groundNets.size === 0) warnings.push('No ground — add a ground symbol.')
  if (!inNet && !railNet) warnings.push('No source — add a W1 generator output or a V+ supply rail.')
  if (!outNet) warnings.push('No output — add a Scope CH1 input probe.')

  // Connectivity checks: count real (non-marker) component terminals per net.
  const MARKERS = new Set<SchKind>(['ground', 'probe', 'scope1', 'scope2'])
  const termCount = new Map<string, number>()
  for (const c of s.components) {
    if (MARKERS.has(c.kind)) continue
    for (const t of terminalsOf(c)) {
      const nn = netOf(t.gx, t.gy)
      termCount.set(nn, (termCount.get(nn) ?? 0) + 1)
    }
  }
  if (inNet && (termCount.get(inNet) ?? 0) < 2) {
    warnings.push('W1 output (in) is not connected to the rest of the circuit.')
  }
  if (outNet && (termCount.get(outNet) ?? 0) < 1) {
    warnings.push('Scope CH1 (out) is not connected to any component.')
  }
  // Rule 2: an unwired scope − is an incomplete schematic (a floating differential input), not a
  // silently-grounded single-ended read. Surface it; the sim leaves the channel untraced.
  if (scope1Placed && !scope1NegWired) warnings.push('CH1 − is unconnected — wire it to GND (single-ended) or to a node (differential).')
  if (scope2Placed && !scope2NegWired) warnings.push('CH2 − is unconnected — wire it to GND (single-ended) or to a node (differential).')

  const rename = (net: string) =>
    groundNets.has(net) ? '0'
      : net === inNet ? 'in'
      : net === in2Net ? 'in2'
      : net === outNet ? 'out'
      : net === outRefNet ? 'out_n'
      : net === scope2Net ? 'scope2'
      : net === scope2RefNet ? 'scope2_n'
      : net

  const comps: SpiceComponent[] = []
  let rc = 1, cc = 1, lc = 1, vc = 1, ec = 1, sc = 1, aw = 1, ic = 1, dd = 1, qc = 1, mc = 1
  for (const c of s.components) {
    const ts = terminalsOf(c)
    if (c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor' || c.kind === 'vsource') {
      const na = rename(netOf(ts[0].gx, ts[0].gy))
      const nb = rename(netOf(ts[1].gx, ts[1].gy))
      if (c.kind === 'resistor') comps.push({ kind: 'resistor', id: String(rc++), nodes: [na, nb], ohms: c.value ?? 1000 })
      else if (c.kind === 'capacitor') comps.push({ kind: 'capacitor', id: String(cc++), nodes: [na, nb], farads: c.value ?? 1e-9 })
      else if (c.kind === 'inductor') comps.push({ kind: 'inductor', id: String(lc++), nodes: [na, nb], henries: c.value ?? 1e-3 })
      else comps.push({ kind: 'vsource', id: String(vc++), nodes: [na, nb], dc: 0, acMag: 1 })
    } else if (c.kind === 'diode' || c.kind === 'led' || c.kind === 'zener' || c.kind === 'photodiode') {
      const na = rename(netOf(ts[0].gx, ts[0].gy)), nk = rename(netOf(ts[1].gx, ts[1].gy))
      let p: { is?: number; n?: number; rs?: number; bv?: number; cj0?: number; iphoto?: number; iphotoAc?: number } = {}
      if (c.kind === 'led') {
        // Set IS so the forward drop ≈ the chosen Vf (V) at ~10 mA, with LED-like ideality N=2.
        const vf = c.value ?? 2.0, N = 2.0, VT = 0.02585, Iref = 0.01
        p = { is: Iref / Math.exp(vf / (N * VT)), n: N, rs: 2, bv: 100 }
      } else if (c.kind === 'zener') {
        p = { bv: c.value ?? 3.3 } // silicon forward (~0.7 V); reverse breaks down at −BV
      } else if (c.kind === 'photodiode') {
        // BPW 34 silicon PIN photodiode (basic model). IS sets the ≈0.35 V open-circuit voltage at
        // the datasheet 80 µA short-circuit current (Ev = 1000 lx); CJO = 72 pF (VR = 0); BV = 32 V
        // (datasheet max reverse). `value` is the photocurrent in A — sensitivity 80 nA/lx, so
        // 1000 lx ≈ 80 µA; default 80 µA. The parallel source is added in buildNetlist via `iphoto`.
        // TIA-1: iphotoAc = 1 A is the normalised .ac stimulus (independent of illumination), so the
        // Network Analyzer reads V(out) directly as transimpedance in ohms (Z = V/I, I = 1 A).
        p = { is: 1e-10, n: 1, rs: 10, bv: 32, cj0: 72e-12, iphoto: c.value ?? 80e-6, iphotoAc: 1 }
      }
      comps.push({ kind: 'diode', id: String(dd++), nodes: [na, nk], ...p })
    } else if (c.kind === 'bjt') {
      // Resolve the kit part (NPN/PNP + .model body) from its name; default to a generic NPN.
      const tn = new Map(ts.map((x) => [x.name, rename(netOf(x.gx, x.gy))]))
      const part = c.part ? TRANSISTOR_PARTS[c.part] : undefined
      const polarity = part?.type === 'pnp' ? 'pnp' : 'npn'
      comps.push({
        kind: 'bjt', id: String(qc++),
        nodes: [tn.get('c')!, tn.get('b')!, tn.get('e')!],
        polarity, ...(part ? { model: part.model } : {}),
      })
    } else if (c.kind === 'mosfet') {
      const tn = new Map(ts.map((x) => [x.name, rename(netOf(x.gx, x.gy))]))
      const part = c.part ? TRANSISTOR_PARTS[c.part] : undefined
      const channel = part?.type === 'pmos' ? 'pmos' : 'nmos'
      comps.push({
        kind: 'mosfet', id: String(mc++),
        nodes: [tn.get('d')!, tn.get('g')!, tn.get('s')!],
        channel, ...(part ? { model: part.model } : {}),
      })
    } else if (c.kind === 'awg1' || c.kind === 'awg2') {
      // Generator output through the M2K AWG output impedance: an ideal source then a 49.9 Ohm
      // series resistor (R132 after the AD8000 buffer) into the wired node. Loading the generator
      // with a low resistance divides the amplitude down, exactly as on the bench. The source keeps
      // id W1/W2 so applyGeneratorParams stamps it. See docs/reference/m2k-spec.md.
      const outNet = rename(netOf(ts[0].gx, ts[0].gy))
      const srcNet = `w${aw}_src`
      comps.push({ kind: 'vsource', id: `W${aw}`, nodes: [srcNet, '0'], dc: 0, acMag: 1 })
      comps.push({ kind: 'resistor', id: `aout${aw}`, nodes: [srcNet, outNet], ohms: 49.9 })
      aw++
    } else if (c.kind === 'opamp') {
      // SCH-9: an op-amp carries a kit `part` (op27/op484/…) → emitted as that part's .subckt
      // macromodel. With no kit part (legacy/off-kit) it falls back to the LMC662 behavioural model.
      const tvpos = ts[3], tvneg = ts[4]
      comps.push({
        kind: 'opamp',
        id: String(ec++),
        model: 'lmc662',
        ...(c.part && isKitOpamp(c.part) ? { part: c.part } : {}),
        nodes: {
          inP: rename(netOf(ts[0].gx, ts[0].gy)),
          inN: rename(netOf(ts[1].gx, ts[1].gy)),
          out: rename(netOf(ts[2].gx, ts[2].gy)),
          ...(tvpos ? { vpos: rename(netOf(tvpos.gx, tvpos.gy)) } : {}),
          ...(tvneg ? { vneg: rename(netOf(tvneg.gx, tvneg.gy)) } : {}),
        },
      })
    } else if (c.kind === 'lmc662') {
      // Dual DIP → two LMC662 op-amp sections (A, B) sharing the V+/V- rail pins.
      const net = (i: number) => rename(netOf(ts[i].gx, ts[i].gy))
      const vpos = net(7), vneg = net(3) // pin 8 = V+, pin 4 = V-
      const k = ec++
      comps.push({ kind: 'opamp', id: `${k}A`, model: 'lmc662', nodes: { inP: net(2), inN: net(1), out: net(0), vpos, vneg } })
      comps.push({ kind: 'opamp', id: `${k}B`, model: 'lmc662', nodes: { inP: net(4), inN: net(5), out: net(6), vpos, vneg } })
    } else if (c.kind === 'ina125') {
      // INA125 = structural 3-op-amp in-amp. The external R_G (a normal resistor across rg1/rg2) sets
      // gain = 4 + 60kΩ/R_G via: first-stage feedback 7.5kΩ each, difference amp gain 4 (10k/40k).
      // Validated in docs/specs/ina125.md. Internal op-amps reuse the LMC662 macro (auto ±5 V clip).
      const tn = new Map(ts.map((x) => [x.name, rename(netOf(x.gx, x.gy))]))
      const vinp = tn.get('inP')!, vinn = tn.get('inN')!, vo = tn.get('out')!
      const rg1 = tn.get('rg1')!, rg2 = tn.get('rg2')!
      // IAREF: tie to ground if left unwired (beginner-friendly), else use its node.
      const irRaw = netOf(ts[5].gx, ts[5].gy)
      const iaref = (termCount.get(irRaw) ?? 0) >= 2 ? rename(irRaw) : '0'
      const k = ec++
      const oa1 = `ina${k}_oa1`, oa2 = `ina${k}_oa2`, p3 = `ina${k}_p3`, n3 = `ina${k}_n3`
      comps.push({ kind: 'opamp', id: `${k}A1`, model: 'lmc662', nodes: { inP: vinp, inN: rg1, out: oa1 } })
      comps.push({ kind: 'opamp', id: `${k}A2`, model: 'lmc662', nodes: { inP: vinn, inN: rg2, out: oa2 } })
      comps.push({ kind: 'resistor', id: `ina${k}R1a`, nodes: [oa1, rg1], ohms: 7500 })
      comps.push({ kind: 'resistor', id: `ina${k}R1b`, nodes: [oa2, rg2], ohms: 7500 })
      comps.push({ kind: 'opamp', id: `${k}A3`, model: 'lmc662', nodes: { inP: p3, inN: n3, out: vo } })
      comps.push({ kind: 'resistor', id: `ina${k}R2i`, nodes: [oa2, n3], ohms: 10000 })
      comps.push({ kind: 'resistor', id: `ina${k}R3i`, nodes: [n3, vo], ohms: 40000 })
      comps.push({ kind: 'resistor', id: `ina${k}R2p`, nodes: [oa1, p3], ohms: 10000 })
      comps.push({ kind: 'resistor', id: `ina${k}R3p`, nodes: [p3, iaref], ohms: 40000 })
    } else if (c.kind === 'dcrail' || c.kind === 'vplus' || c.kind === 'vminus') {
      const def = c.kind === 'vminus' ? -5 : 5
      comps.push({ kind: 'dcrail', id: `S${sc++}`, node: rename(netOf(ts[0].gx, ts[0].gy)), volts: c.value ?? def })
    }
    // ground / probe / scope1 (1±) / scope2 (2±) are markers — no SPICE device emitted.
  }
  if (groundNets.size > 0) comps.push({ kind: 'ground', id: '0', node: '0' })

  const probes = {
    ch1: outNet ? rename(outNet) : undefined,
    ch1n: outRefNet ? rename(outRefNet) : undefined,   // 1- reference ('0' single-ended, or a node)
    ch2: scope2Net ? rename(scope2Net) : undefined,
    ch2n: scope2RefNet ? rename(scope2RefNet) : undefined, // 2- reference
    // Rule 2: a placed channel whose − is unwired is incomplete — the sampler skips it (no trace)
    // rather than inferring a ground reference.
    ch1Incomplete: scope1Placed && !scope1NegWired,
    ch2Incomplete: scope2Placed && !scope2NegWired,
  }
  return { circuit: { title, components: comps }, warnings, probes }
}
