// SCH-11 P3 Stage 1 — map app part kinds onto the circuitikz symbol catalog and
// compute the SVG transform that puts each catalog pin exactly on the app's grid
// terminals. Pure logic, no React. `baseTerminals`/`terminalsOf` (core/schematic.ts)
// stay the source of truth for terminal positions: the artwork conforms to them.

import { SYMBOL_CATALOG, type CatalogSymbol } from './symbolCatalog'
import type { SchComponent, SchKind } from './schematic'
import { TRANSISTOR_PARTS } from './netlist'

export interface Pt { x: number; y: number }

// SVG 2x3 matrix [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f
export type Mat = [number, number, number, number, number, number]

// The catalog bipoles are drawn 2 cm long (≈56.7 SVG units) and land on app
// terminals 2 grid units (48 px) apart, so this is the natural symbol scale.
// Single-pin symbols (ground) have no second point to infer scale from — they
// use this constant so they match the bipoles' visual weight.
export const DEFAULT_SYMBOL_SCALE = 48 / 56.7

/**
 * Which catalog symbol renders a component, and the catalog-pin order matched to
 * the component's `baseTerminals` order (pinIds[i] ↔ baseTerminals[i]).
 * Returns null for kinds that keep their existing inline rendering (ports,
 * INA125, probe, rails) — those are markers/parts with no catalog counterpart yet.
 */
export function symbolFor(c: Pick<SchComponent, 'kind' | 'part'>): { id: string; sym: CatalogSymbol; pinIds: string[] } | null {
  const pick = (id: string, pinIds: string[]) => {
    const sym = SYMBOL_CATALOG[id]
    return sym ? { id, sym, pinIds } : null
  }
  const kind: SchKind = c.kind
  switch (kind) {
    case 'resistor': return pick('resistor', ['p0', 'p1'])
    case 'capacitor': return pick('capacitor', ['p0', 'p1'])
    case 'inductor': return pick('inductor', ['p0', 'p1'])
    // diode family: circuitikz `to[D]` points the triangle toward the second
    // coordinate, so p0 = anode, p1 = cathode — matching baseTerminals [a, c].
    case 'diode': return pick('diode', ['p0', 'p1'])
    case 'led': return pick('led', ['p0', 'p1'])
    case 'zener': return pick('zener', ['p0', 'p1'])
    case 'photodiode': return pick('photodiode', ['p0', 'p1'])
    case 'vsource': return pick('vsource_sin', ['p0', 'p1'])
    case 'ground': return pick('ground', ['p0'])
    // opamp: catalog pins are [A.+, A.−, out] = [p0, p1, p2]; app terminals are
    // [inP, inN, out]. circuitikz puts + on the LOWER input, the app on the upper —
    // the affine map flips the (symmetric) triangle vertically to honour the app's
    // established pin positions, so nets are unchanged.
    case 'opamp': return pick('opamp', ['p0', 'p1', 'p2'])
    // transistors: catalog pin order [base, collector, emitter] / [gate, drain,
    // source]; app baseTerminals order [c, b, e] / [d, g, s].
    case 'bjt':
      return pick(transistorType(c.part, 'npn') === 'pnp' ? 'bjt_pnp' : 'bjt_npn', ['p1', 'p0', 'p2'])
    case 'mosfet':
      return pick(transistorType(c.part, 'nmos') === 'pmos' ? 'pmos' : 'nmos', ['p1', 'p0', 'p2'])
    // LMC662 8-pin DIP: catalog p0..p7 = DIP pins 1..8, which is exactly the app's
    // baseTerminals order (outA, −A, +A, V− down the left; +B, −B, outB, V+ up the right).
    case 'lmc662': return pick('ic_dip8', ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])
    default: return null
  }
}

function transistorType(part: string | undefined, dflt: string): string {
  return (part && TRANSISTOR_PARTS[part]?.type) || dflt
}

export function applyMat(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
const cross = (o: Pt, a: Pt, b: Pt) =>
  (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y)

/**
 * Transform mapping the symbol's pin points onto the terminal points.
 * - 1 pair: translation at DEFAULT_SYMBOL_SCALE.
 * - 2 pairs: similarity (uniform scale + rotation) — exact on both points.
 * - 3+ pairs: affine from the first three pairs — exact on those three, and on
 *   the rest too when the layouts are affine-consistent (the DIP is; tested).
 */
export function alignTransform(src: Pt[], dst: Pt[]): Mat {
  if (src.length === 0 || src.length !== dst.length) return [1, 0, 0, 1, 0, 0]
  if (src.length === 1) {
    const s = DEFAULT_SYMBOL_SCALE
    return [s, 0, 0, s, dst[0].x - s * src[0].x, dst[0].y - s * src[0].y]
  }
  if (src.length === 2) {
    const vx = src[1].x - src[0].x, vy = src[1].y - src[0].y
    const wx = dst[1].x - dst[0].x, wy = dst[1].y - dst[0].y
    const d = vx * vx + vy * vy
    // complex division w/v → rotation+scale (a + i·b)
    const a = (wx * vx + wy * vy) / d
    const b = (wy * vx - wx * vy) / d
    return [a, b, -b, a, dst[0].x - (a * src[0].x - b * src[0].y), dst[0].y - (b * src[0].x + a * src[0].y)]
  }
  // affine from three anchor pairs. Pick the max-area (least degenerate) triple —
  // the first pins of a DIP are collinear (one package column), which would
  // otherwise make the system singular. Greedy: farthest pair, then max area.
  let i1 = 1
  for (let i = 1; i < src.length; i++) {
    if (dist2(src[0], src[i]) > dist2(src[0], src[i1])) i1 = i
  }
  let i2 = -1, best = 0
  for (let i = 1; i < src.length; i++) {
    const a = Math.abs(cross(src[0], src[i1], src[i]))
    if (a > best) { best = a; i2 = i }
  }
  if (i2 < 0) return alignTransform([src[0], src[i1]], [dst[0], dst[i1]]) // all collinear → similarity
  const s0 = src[0], s1 = src[i1], s2 = src[i2]
  const d0 = dst[0], d1 = dst[i1], d2 = dst[i2]
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y)
  const solve = (r0: number, r1: number, r2: number): [number, number, number] => {
    // coefficients for x' (or y') = A·x + C·y + E given the three source points
    const A = ((r1 - r0) * (s2.y - s0.y) - (r2 - r0) * (s1.y - s0.y)) / det
    const C = ((r2 - r0) * (s1.x - s0.x) - (r1 - r0) * (s2.x - s0.x)) / det
    const E = r0 - A * s0.x - C * s0.y
    return [A, C, E]
  }
  const [a, cc, e] = solve(d0.x, d1.x, d2.x)
  const [b, dd, f] = solve(d0.y, d1.y, d2.y)
  return [a, b, cc, dd, e, f]
}

/** Uniform scale factor of a transform (area-preserving measure — √|det|). */
export function matScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
}

// The catalog's line weights are in SVG units (body 0.8, leads 0.4), so after the
// align transform they'd come out at a different pixel weight per part. Normalize:
// multiply every stroke-width so the 0.8 body stroke lands at ~INK_BODY_PX px
// regardless of the part's scale. Relative weights (leads vs body vs decor) keep.
const INK_BODY_PX = 1.7
const strokeCache = new Map<string, string>()

export function inkedInner(symId: string, sym: CatalogSymbol, scale: number): string {
  const mult = INK_BODY_PX / (0.8 * scale)
  const key = `${symId}|${mult.toFixed(3)}`
  const hit = strokeCache.get(key)
  if (hit) return hit
  const out = sym.inner.replace(/stroke-width=(['"])([\d.]+)\1/g,
    (_, q, w) => `stroke-width=${q}${(Number(w) * mult).toFixed(3)}${q}`)
  strokeCache.set(key, out)
  return out
}
