import { describe, it, expect } from 'vitest'
import { fitToContent, toWorld, sameView, IDENTITY_VIEW, type Box } from './viewport'

// The editor's pad: the SVG's own pixel box. Content that clears the edges must not be reframed.
const PAD_BOX: Box = { x: 0, y: 0, w: 800, h: 600 }
const VP = { w: 800, h: 600 }

// screen position of a world point under a view
const screen = (v: { scale: number; tx: number; ty: number }, x: number, y: number) =>
  ({ x: x * v.scale + v.tx, y: y * v.scale + v.ty })

describe('fitToContent (FIT-1)', () => {
  it('empty content is the identity view — no NaN, no reframe', () => {
    expect(fitToContent(null, VP)).toEqual(IDENTITY_VIEW)
    expect(fitToContent({ x: 0, y: 0, w: 0, h: 0 }, VP)).toEqual(IDENTITY_VIEW)
    const v = fitToContent(null, VP, { keepVisible: PAD_BOX, margin: 24 })
    expect(Number.isNaN(v.scale + v.tx + v.ty)).toBe(false)
    expect(v).toEqual(IDENTITY_VIEW)
  })

  it('a zero-sized viewport does not divide by zero', () => {
    expect(fitToContent({ x: 0, y: 0, w: 10, h: 10 }, { w: 0, h: 0 })).toEqual(IDENTITY_VIEW)
  })

  it('content already clear of the edges keeps the 1:1 view (nothing lurches while you draw)', () => {
    const content: Box = { x: 40, y: 40, w: 300, h: 200 } // well inside the pad, margin to spare
    const v = fitToContent(content, VP, { margin: 24, keepVisible: PAD_BOX })
    expect(sameView(v, IDENTITY_VIEW)).toBe(true)
  })

  it('the reported bug: content overhanging the left edge is pulled fully into view with margin', () => {
    // The CH2 instrument at gx=0 draws its body/label to the LEFT of its terminal → negative x.
    const content: Box = { x: -40, y: 20, w: 400, h: 300 }
    const m = 24
    const v = fitToContent(content, VP, { margin: m, keepVisible: PAD_BOX })
    const tl = screen(v, content.x, content.y)
    const br = screen(v, content.x + content.w, content.y + content.h)
    expect(tl.x).toBeGreaterThan(0)          // no longer clipped
    expect(tl.x).toBeGreaterThanOrEqual(m * v.scale - 1e-6) // and it keeps its gutter
    expect(br.x).toBeLessThanOrEqual(VP.w)
    expect(v.scale).toBeLessThan(1)          // zoomed out just enough to make room
  })

  it('respects the margin on all four sides', () => {
    const content: Box = { x: -50, y: -30, w: 900, h: 700 } // overhangs every edge
    const m = 20
    const v = fitToContent(content, VP, { margin: m })
    const tl = screen(v, content.x, content.y)
    const br = screen(v, content.x + content.w, content.y + content.h)
    const gutter = m * v.scale
    expect(tl.x).toBeGreaterThanOrEqual(gutter - 1e-6)
    expect(tl.y).toBeGreaterThanOrEqual(gutter - 1e-6)
    expect(VP.w - br.x).toBeGreaterThanOrEqual(gutter - 1e-6)
    expect(VP.h - br.y).toBeGreaterThanOrEqual(gutter - 1e-6)
  })

  it('centers the content in the pad', () => {
    const content: Box = { x: -100, y: -100, w: 1200, h: 900 }
    const v = fitToContent(content, VP, { margin: 10 })
    const tl = screen(v, content.x - 10, content.y - 10)
    const br = screen(v, content.x + content.w + 10, content.y + content.h + 10)
    expect(tl.x).toBeCloseTo(VP.w - br.x, 6) // equal gutters left/right
    expect(tl.y).toBeCloseTo(VP.h - br.y, 6) // equal gutters top/bottom
  })

  it('never magnifies past maxZoom — one small part does not blow up to fill the pad', () => {
    const v = fitToContent({ x: 380, y: 280, w: 40, h: 40 }, VP, { margin: 10, keepVisible: PAD_BOX })
    expect(v.scale).toBeLessThanOrEqual(1)
    const vNoPad = fitToContent({ x: 380, y: 280, w: 40, h: 40 }, VP, { margin: 10, maxZoom: 1 })
    expect(vNoPad.scale).toBe(1)
  })

  it('a schematic too big to fit lands at minZoom, centered (never at an illegible scale)', () => {
    const content: Box = { x: 0, y: 0, w: 100_000, h: 100_000 }
    const v = fitToContent(content, VP, { margin: 10, minZoom: 0.25 })
    expect(v.scale).toBe(0.25)
    const tl = screen(v, content.x - 10, content.y - 10)
    const br = screen(v, content.x + content.w + 10, content.y + content.h + 10)
    expect(tl.x).toBeCloseTo(VP.w - br.x, 6) // still centered, overflow shared both sides
    expect(tl.y).toBeCloseTo(VP.h - br.y, 6)
  })

  it('honours an explicit zoom clamp', () => {
    const v = fitToContent({ x: 0, y: 0, w: 1600, h: 1200 }, VP, { minZoom: 0.8 })
    expect(v.scale).toBe(0.8) // would fit at 0.5, clamped up
  })

  it('a reframe does not move the content box — the fit is stable (no oscillation)', () => {
    const content: Box = { x: -40, y: 20, w: 400, h: 300 }
    const opts = { margin: 24, keepVisible: PAD_BOX }
    const v1 = fitToContent(content, VP, opts)
    const v2 = fitToContent(content, VP, opts) // the content bbox is measured pre-transform
    expect(sameView(v1, v2)).toBe(true)
  })

  it('toWorld inverts the view — a screen point maps back to the world point that drew it', () => {
    const v = fitToContent({ x: -40, y: 20, w: 400, h: 300 }, VP, { margin: 24, keepVisible: PAD_BOX })
    const p = screen(v, 137, 96)
    const w = toWorld(v, p.x, p.y)
    expect(w.x).toBeCloseTo(137, 6)
    expect(w.y).toBeCloseTo(96, 6)
  })
})
