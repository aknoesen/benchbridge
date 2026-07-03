// SCH-11 P3 Stage 1 — the render swap's acceptance math: every catalog pin must
// land exactly on its app grid terminal under alignTransform, for the real
// catalog data (not synthetic fixtures).
import { describe, it, expect } from 'vitest'
import { symbolFor, alignTransform, applyMat, matScale, inkedInner, DEFAULT_SYMBOL_SCALE, type Pt } from './symbolArt'
import { baseTerminals, localTerminals, type SchKind } from './schematic'
import { SYMBOL_CATALOG } from './symbolCatalog'

const GRID = 24 // must match SchematicEditor's grid pitch

function pinsAndTerminals(kind: SchKind, part?: string): { src: Pt[]; dst: Pt[] } {
  const art = symbolFor({ kind, part })
  expect(art, `symbolFor(${kind})`).not.toBeNull()
  const { sym, pinIds } = art!
  const byId = new Map(sym.pins.map((p) => [p.id, { x: p.x, y: p.y }]))
  const src = pinIds.map((id) => {
    const p = byId.get(id)
    expect(p, `catalog pin ${id}`).toBeDefined()
    return p!
  })
  const dst = baseTerminals(kind).map((t) => ({ x: t.gx * GRID, y: t.gy * GRID }))
  expect(src.length).toBe(dst.length)
  return { src, dst }
}

function expectAligned(kind: SchKind, part?: string, tolPx = 0.01) {
  const { src, dst } = pinsAndTerminals(kind, part)
  const m = alignTransform(src, dst)
  src.forEach((p, i) => {
    const q = applyMat(m, p)
    expect(Math.hypot(q.x - dst[i].x, q.y - dst[i].y),
      `${kind} pin ${i} → terminal ${i}`).toBeLessThan(tolPx)
  })
  return m
}

describe('symbolFor / alignTransform put catalog pins on grid terminals', () => {
  it('2-terminal bipoles align exactly (similarity)', () => {
    for (const kind of ['resistor', 'capacitor', 'inductor', 'diode', 'led', 'zener', 'photodiode', 'vsource'] as SchKind[]) {
      expectAligned(kind)
    }
  })

  it('bipole transform rotates the vertical circuitikz bipole to horizontal at uniform scale', () => {
    const { src, dst } = pinsAndTerminals('resistor')
    const m = alignTransform(src, dst)
    expect(matScale(m)).toBeCloseTo(DEFAULT_SYMBOL_SCALE, 2)
    // similarity: no shear, |det| = s²
    expect(m[0] * m[1] + m[2] * m[3]).toBeCloseTo(0, 9)
  })

  it('opamp: all three pins land exactly (affine, vertical flip is allowed)', () => {
    const m = expectAligned('opamp')
    // circuitikz + input is the lower one, the app's is the upper → negative det (mirror)
    expect(m[0] * m[3] - m[1] * m[2]).toBeLessThan(0)
  })

  it('bjt / mosfet variants pick the right symbol and align all 3 pins', () => {
    expectAligned('bjt', '2N3904') // npn
    expectAligned('bjt', '2N3906') // pnp
    expectAligned('mosfet', 'ZVN2110A') // n-channel
    expectAligned('mosfet', 'ZVP2110A') // p-channel
    expect(symbolFor({ kind: 'bjt', part: '2N3906' })!.sym).toBe(SYMBOL_CATALOG['bjt_pnp'])
    expect(symbolFor({ kind: 'mosfet', part: 'ZVP2110A' })!.sym).toBe(SYMBOL_CATALOG['pmos'])
  })

  it('lmc662 → 8-pin DIP: ALL 8 pins land on their terminals (affine-consistent grids)', () => {
    // the affine is solved from 3 anchors; the other 5 landing too proves the
    // catalog DIP and the app's terminal grid are affine-equivalent
    expectAligned('lmc662', undefined, 0.75)
  })

  it('ground (1 pin): translation at the default symbol scale', () => {
    const m = expectAligned('ground')
    expect(matScale(m)).toBeCloseTo(DEFAULT_SYMBOL_SCALE, 6)
  })

  it('unmapped kinds return null (keep their inline rendering)', () => {
    for (const kind of ['ina125', 'probe', 'dcrail', 'awg1', 'awg2', 'scope1', 'scope2', 'adc1n', 'adc2n', 'vplus', 'vminus'] as SchKind[]) {
      expect(symbolFor({ kind })).toBeNull()
    }
  })
})

// Stage 2: flip is a model-space mirror of the terminals; the SAME alignTransform then
// re-derives the flipped artwork. Nothing stacks a scaleX on top, so a symbol whose
// alignment already reflects (the op-amp's baked-in vertical flip) cannot double-flip.
describe('mirrored terminals re-derive the flipped render (Stage 2)', () => {
  const det = (m: number[]) => m[0] * m[3] - m[1] * m[2]

  function alignedTo(kind: SchKind, mirror: boolean, part?: string) {
    const art = symbolFor({ kind, part })!
    const byId = new Map(art.sym.pins.map((p) => [p.id, { x: p.x, y: p.y }]))
    const src = art.pinIds.map((id) => byId.get(id)!)
    const dst = localTerminals({ kind, mirror }).map((t) => ({ x: t.gx * GRID, y: t.gy * GRID }))
    const m = alignTransform(src, dst)
    src.forEach((p, i) => {
      const q = applyMat(m, p)
      expect(Math.hypot(q.x - dst[i].x, q.y - dst[i].y),
        `${kind}${mirror ? ' mirrored' : ''} pin ${i}`).toBeLessThan(0.75)
    })
    return m
  }

  it('opamp: mirrored terminals land all 3 pins exactly and the det sign flips (+ stays on inP)', () => {
    // unmirrored: baked-in vertical flip → det < 0; mirrored: horizontal mirror composes
    // with it → det > 0 (a proper rotation). One flip total, never two.
    expect(det(alignedTo('opamp', false))).toBeLessThan(0)
    expect(det(alignedTo('opamp', true))).toBeGreaterThan(0)
  })

  it('bjt / mosfet / DIP: mirrored terminals land every pin; orientation reverses', () => {
    for (const [kind, part] of [['bjt', '2N3904'], ['mosfet', 'ZVN2110A'], ['lmc662', undefined]] as [SchKind, string?][]) {
      const d0 = det(alignedTo(kind, false, part))
      const d1 = det(alignedTo(kind, true, part))
      expect(Math.sign(d1), `${kind} det sign must reverse under mirror`).toBe(-Math.sign(d0))
    }
  })

  it('bipoles: a mirrored 2-pin part stays a pure similarity (no reflection possible — reads as a 180° turn)', () => {
    const m = alignedTo('diode', true)
    expect(m[0] * m[1] + m[2] * m[3]).toBeCloseTo(0, 9) // no shear
    expect(det(m)).toBeGreaterThan(0) // similarity: det = +s²
  })
})

describe('inkedInner stroke normalization', () => {
  it('multiplies stroke-widths so the 0.8 body stroke hits the target px at any scale', () => {
    const sym = SYMBOL_CATALOG['resistor']
    const out = inkedInner('resistor', sym, DEFAULT_SYMBOL_SCALE)
    const widths = [...out.matchAll(/stroke-width=['"]([\d.]+)['"]/g)].map((m) => Number(m[1]))
    expect(widths.length).toBeGreaterThan(0)
    // body stroke 0.79999 → 1.7/scale px in svg units
    const bodyPx = Math.max(...widths) * DEFAULT_SYMBOL_SCALE
    expect(bodyPx).toBeCloseTo(1.7, 1)
    // relative weights preserved: leads (0.4) stay half the body (0.8)
    const sorted = [...new Set(widths)].sort((a, b) => a - b)
    expect(sorted[0] / sorted[sorted.length - 1]).toBeCloseTo(0.5, 1)
  })

  it('is cached per symbol+scale', () => {
    const sym = SYMBOL_CATALOG['resistor']
    expect(inkedInner('resistor', sym, 1)).toBe(inkedInner('resistor', sym, 1))
  })
})
