// PNG export of a live <svg> (schematic / breadboard) so students can save a clean image for their
// prelab submission instead of cropping a screenshot. No dependencies.
//
// The drawings colour themselves from CSS custom properties (the dark theme: --ch1-color, etc.).
// Those don't survive XML serialization, so before rasterizing we walk the clone and inline each
// element's *computed* paint (which has already resolved the variables to rgb). url(...) references
// (gradients) are left alone so they still resolve inside the standalone SVG.
//
// `light: true` turns the dark-theme drawing into a paper figure: every paint colour has its HSL
// lightness inverted (near-black background → white, light-grey text/wires → dark ink, hues kept),
// the grid pattern is dropped, and the canvas is filled white. That reads cleanly on a white
// Gradescope/Word page, where the unmodified light-on-dark palette would wash out.
//
// Instrument plots (scope/spectrum/generator/network) are Plotly graphs, not our SVGs, so they use
// `exportPlotlyToPng` / `exportPlotlyPairToPng` below — rasterized via Plotly.toImage on their own
// dark background (WYSIWYG, like a scope screen), then saved through the same Save dialog.

import Plotly from 'plotly.js-dist-min'

const PAINT_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
] as const

// Invert the lightness of an "rgb(...)"/"rgba(...)" colour, preserving hue, saturation, and alpha.
function invertLightness(color: string): string {
  const m = color.match(/rgba?\(([^)]+)\)/i)
  if (!m) return color
  const p = m[1].split(',').map((s) => s.trim())
  let r = Number(p[0]), g = Number(p[1]), b = Number(p[2])
  const a = p.length > 3 ? Number(p[3]) : 1
  if ([r, g, b].some((n) => Number.isNaN(n))) return color
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  let h = 0, s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  const nl = 1 - l // the inversion
  const hue2rgb = (pp: number, qq: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return pp + (qq - pp) * 6 * t
    if (t < 1 / 2) return qq
    if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6
    return pp
  }
  let R: number, G: number, B: number
  if (s === 0) { R = G = B = nl } else {
    const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s
    const pp = 2 * nl - q
    R = hue2rgb(pp, q, h + 1 / 3); G = hue2rgb(pp, q, h); B = hue2rgb(pp, q, h - 1 / 3)
  }
  return `rgba(${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)},${a})`
}

function inlinePaint(src: Element, dst: Element, light: boolean) {
  if (src.tagName === 'defs') return // leave pattern/gradient definitions untouched
  const cs = window.getComputedStyle(src)
  const decl: string[] = []
  for (const p of PAINT_PROPS) {
    let v = cs.getPropertyValue(p)
    if (!v) continue
    if (p === 'fill' || p === 'stroke') {
      if (v.startsWith('url(')) continue            // keep pattern/gradient references as-is
      if (light && v !== 'none') v = invertLightness(v)
    }
    decl.push(`${p}:${v}`)
  }
  if (decl.length) dst.setAttribute('style', decl.join(';'))
  const s = src.children, d = dst.children
  const n = Math.min(s.length, d.length)
  for (let i = 0; i < n; i++) inlinePaint(s[i], d[i], light)
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// Save a PNG blob the way the circuit/lab saves work: the native Save dialog (name + folder) when the
// browser supports it (Chrome/Edge), else a name prompt + download to the default folder.
export async function savePngBlob(blob: Blob, suggestedName: string) {
  const sfp = (window as unknown as {
    showSaveFilePicker?: (o: {
      suggestedName?: string
      types?: { description?: string; accept: Record<string, string[]> }[]
    }) => Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }>
  }).showSaveFilePicker
  if (typeof sfp === 'function') {
    try {
      const handle = await sfp({ suggestedName, types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }] })
      const w = await handle.createWritable(); await w.write(blob); await w.close()
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return // user cancelled
      // any other error → fall through to the download fallback
    }
  }
  let name = window.prompt('Save image as:', suggestedName)
  if (name === null) return // cancelled
  name = name.trim() || suggestedName
  if (!name.toLowerCase().endsWith('.png')) name += '.png'
  const url = URL.createObjectURL(blob)
  triggerDownload(url, name)
  URL.revokeObjectURL(url)
}

interface ExportOpts {
  scale?: number
  light?: boolean
  // paper: the drawing is ALREADY ink-on-light (the SCH-11 schematic canvas) —
  // fill the canvas white and drop the grid, but do NOT invert lightness
  // (light:true would turn the black ink white and vanish it).
  paper?: boolean
  // vars: CSS custom properties forced onto the live svg for the duration of the
  // computed-style walk, then restored. Lets the export always use the white-paper
  // palette even when the on-screen canvas wears another skin (green pad, blueprint) —
  // the exported figure is for publication, the skin is for editing.
  vars?: Record<string, string>
}

/**
 * Rasterize an on-screen SVG element to a PNG and save it. Uses the native Save dialog (name +
 * folder) when supported, else prompts for a name and downloads — same UX as the circuit/lab saves.
 * @param svg   the live <svg> (must be in the DOM so computed styles resolve)
 * @param filename  suggested name, e.g. 'schematic.png'
 * @param opts.scale  pixel density multiplier (default 2)
 * @param opts.light  true → white background + dark-ink remap (default false = transparent)
 */
export async function exportSvgToPng(svg: SVGSVGElement, filename: string, opts: ExportOpts = {}): Promise<void> {
  const scale = opts.scale ?? 2
  const light = opts.light ?? false
  const paper = opts.paper ?? false

  const vb = svg.viewBox?.baseVal
  const box = svg.getBoundingClientRect()
  const w = vb && vb.width ? vb.width : box.width
  const h = vb && vb.height ? vb.height : box.height
  if (!w || !h) throw new Error('Nothing to export yet.')

  const clone = svg.cloneNode(true) as SVGSVGElement
  // Force the requested palette while computed styles are read (CSSOM resolves
  // property changes synchronously), then restore the on-screen values.
  const prevVars = new Map<string, string>()
  if (opts.vars) {
    for (const [k, v] of Object.entries(opts.vars)) {
      prevVars.set(k, svg.style.getPropertyValue(k))
      svg.style.setProperty(k, v)
    }
  }
  try {
    inlinePaint(svg, clone, light)
  } finally {
    for (const [k, v] of prevVars) v ? svg.style.setProperty(k, v) : svg.style.removeProperty(k)
  }
  // Drop the grid AFTER the paint walk: inlinePaint pairs source/clone children by
  // index, so removing a clone child first would shift every later sibling and land
  // each element's paint on its neighbour (ports exported with the wrong fill).
  if (light || paper) clone.querySelectorAll('[fill^="url("]').forEach((el) => el.remove())
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.style.background = 'transparent' // the canvas owns the background

  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not render the SVG.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable.')
    if (light || paper) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) throw new Error('Could not encode the PNG.')
    await savePngBlob(blob, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}

const displayBg = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--bg-display').trim() || '#0d0d0d'

// Plotly's `setBackground` is a real toImage option but missing from the bundled typings.
type ToImgOpts = Plotly.ToImgopts & { setBackground?: string }
const toImg = (gd: HTMLElement, scale: number, w: number, h: number) =>
  Plotly.toImage(gd, { format: 'png', scale, width: gd.clientWidth || w, height: gd.clientHeight || h, setBackground: displayBg() } as ToImgOpts)

// Save one Plotly chart (scope / spectrum / generator) as a PNG on its own dark background.
export async function exportPlotlyToPng(gd: HTMLElement, filename: string, scale = 2): Promise<void> {
  const blob = await (await fetch(await toImg(gd, scale, 800, 400))).blob()
  await savePngBlob(blob, filename)
}

// Save several Plotly charts stacked vertically as one PNG (e.g. the Network Analyzer's
// magnitude + phase Bode plots in a single image).
export async function exportPlotlyPairToPng(gds: HTMLElement[], filename: string, scale = 2): Promise<void> {
  const bg = displayBg()
  const imgs = await Promise.all(gds.filter(Boolean).map(async (gd) => {
    const dataUrl = await toImg(gd, scale, 800, 300)
    const im = new Image()
    await new Promise<void>((res, rej) => { im.onload = () => res(); im.onerror = () => rej(new Error('render failed')); im.src = dataUrl })
    return im
  }))
  if (!imgs.length) throw new Error('Nothing to export yet.')
  const w = Math.max(...imgs.map((i) => i.width))
  const h = imgs.reduce((s, i) => s + i.height, 0)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable.')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h)
  let y = 0
  for (const im of imgs) { ctx.drawImage(im, 0, y); y += im.height }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('Could not encode the PNG.')
  await savePngBlob(blob, filename)
}
