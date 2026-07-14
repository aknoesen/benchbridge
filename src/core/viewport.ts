// FIT-1: framing the schematic on the sketch pad. Pure geometry — no React, no DOM.
//
// The editor draws in plain pixel space (world x = gx*GRID + PAD), so a part whose glyph or label
// overhangs its grid node — the CH2 instrument body, a ground symbol, a "1.5kΩ" value label — can
// render past the edge of the pad and be invisible with no way to reach it. This module computes
// the pan+zoom that guarantees the whole drawing is framed.
//
// The caller measures the RENDERED extent (SVG getBBox over the content layer, which includes every
// glyph and text label — measuring terminal grid points instead would still clip exactly the things
// that are clipped today) and hands it here as `content`. Nothing here touches the schematic model:
// FIT-1 changes how the viewport frames the content, never the content itself.

export interface Box { x: number; y: number; w: number; h: number }

// A render transform: screen = world * scale + t. Identity = the pre-FIT-1 1:1 pixel view.
export interface View { scale: number; tx: number; ty: number }

export const IDENTITY_VIEW: View = { scale: 1, tx: 0, ty: 0 }

export interface FitOpts {
  // Gutter kept between the content and every edge, in world units.
  margin?: number
  // Zoom clamp. maxZoom = 1 by default: the fit never magnifies past 1:1, so a lone small part
  // stays its natural size instead of blowing up to fill the pad. minZoom bounds the shrink — a
  // schematic too big to fit lands at minZoom, centered, rather than at an illegible scale.
  minZoom?: number
  maxZoom?: number
  // A world box that must stay inside the frame even when the content is smaller than it — the
  // editor passes the pad itself. Two things fall out of this:
  //   1. content already clear of the edges ⇒ the fit is the identity, so the common case does not
  //      shrink or shift the drawing at all (no lurching while you place parts);
  //   2. the region a drag is clamped to (SCH-14 keeps parts on the pad) is always on screen, so a
  //      part dragged toward an edge cannot visually leave the pad before the drop settles the fit.
  keepVisible?: Box
}

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

// The pan+zoom that centers `content` (plus its margin) in a `viewport`-sized pad. An empty or
// degenerate content box yields the identity view — never NaN.
export function fitToContent(content: Box | null, viewport: { w: number; h: number }, opts: FitOpts = {}): View {
  const { margin = 0, minZoom = 0.25, maxZoom = 1, keepVisible } = opts
  if (viewport.w <= 0 || viewport.h <= 0) return IDENTITY_VIEW

  let box: Box | null = content && content.w >= 0 && content.h >= 0
    ? { x: content.x - margin, y: content.y - margin, w: content.w + 2 * margin, h: content.h + 2 * margin }
    : null
  if (keepVisible) box = box ? union(box, keepVisible) : keepVisible
  if (!box || box.w <= 0 || box.h <= 0) return IDENTITY_VIEW

  const scale = Math.min(maxZoom, Math.max(minZoom, Math.min(viewport.w / box.w, viewport.h / box.h)))
  return {
    scale,
    tx: (viewport.w - box.w * scale) / 2 - box.x * scale,
    ty: (viewport.h - box.h * scale) / 2 - box.y * scale,
  }
}

export const sameView = (a: View, b: View): boolean =>
  Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.tx - b.tx) < 1e-6 && Math.abs(a.ty - b.ty) < 1e-6

// Screen (SVG-local px) → world, the inverse of the render transform. The editor's hit-testing and
// grid snapping run in world coordinates, so every pointer position goes through this.
export const toWorld = (v: View, x: number, y: number): { x: number; y: number } =>
  ({ x: (x - v.tx) / v.scale, y: (y - v.ty) / v.scale })
