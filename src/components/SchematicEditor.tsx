// Schematic editor (SCH-1) — a lightweight node-and-wire editor (NOT KiCad). Place R/C/L/V/
// op-amp/ground/probe on a grid, draw wires, edit values. Produces a SPICE-2 Circuit via
// toCircuit(). See docs/specs/schematic-ngspice.md (SCH-1).
import { useMemo, useRef, useState, useEffect, useLayoutEffect, type ReactElement, type Dispatch, type SetStateAction, type CSSProperties } from 'react'
import {
  Schematic, SchComponent, SchKind, terminalsOf, localTerminals, toCircuit, ampCategory, computeNets,
  SINGLETON_KINDS, hasKind,
  attachedWireEnds, moveComponentWithWires, moveSelectionBy, rotateComponentInBounds,
  clampMoveTarget, componentTerminalBox,
  mirrorComponentWithWires, canMirror, orthoRoute, rerouteAttachedWires, deleteComponentsWithWires, migrateSchematic,
  type WireEndRef,
} from '../core/schematic'
import { fitToContent, toWorld, sameView, IDENTITY_VIEW, type View } from '../core/viewport'
import { symbolFor, alignTransform, matScale, inkedInner } from '../core/symbolArt'
import { SYMBOL_CATALOG } from '../core/symbolCatalog'
import { buildNetlist, TRANSISTOR_PARTS } from '../core/netlist'
import { EXAMPLES } from '../core/examples'
import { createSpiceEngine, type SpiceEngine, transferFunction } from '../core/spice'
import { UNIT, TUNE_RANGE, fmtEng, parseEng, tunePos, tuneValue } from '../core/units'
import { kitValues, isKitValue, nearestKitValue, formatValue, type PassiveKind } from '../core/kit'
import { opampList, getOpamp, isKitOpamp } from '../core/opamps'
import { tiaCompensation, type TiaCompensation } from '../core/tia'
import { exportSvgToPng } from './exportImage'
import './Instrument.css'

// TIA-3: when a selected photodiode drives an op-amp inverting input, find the feedback Rf/Cf and the
// op-amp GBW so the inspector can suggest a compensation Cf. Returns null when the part isn't wired as
// a transimpedance front-end (no op-amp on the summing node, or no feedback resistor).
const PHOTODIODE_CJ0 = 72e-12 // BPW 34 junction capacitance — dominates the op-amp input cap
function tiaHintFor(sch: Schematic, pdId: string): { rfOhms: number; gbwHz: number; cfActual?: number; comp: TiaCompensation } | null {
  const pd = sch.components.find((c) => c.id === pdId && c.kind === 'photodiode')
  if (!pd) return null
  const nets = computeNets(sch)
  const netOf = (gx: number, gy: number) => nets.get(`${gx},${gy}`)
  const pdNets = new Set(terminalsOf(pd).map((t) => netOf(t.gx, t.gy)))
  for (const op of sch.components) {
    if (op.kind !== 'opamp' || !op.part || !isKitOpamp(op.part)) continue
    const byName = new Map(terminalsOf(op).map((t) => [t.name, netOf(t.gx, t.gy)]))
    const inN = byName.get('inN'), out = byName.get('out')
    if (!inN || !out || !pdNets.has(inN)) continue // photodiode must reach the summing node
    const feedback = (kind: SchKind): number | undefined => {
      for (const c of sch.components) {
        if (c.kind !== kind) continue
        const ts = terminalsOf(c)
        if (ts.length !== 2) continue
        const a = netOf(ts[0].gx, ts[0].gy), b = netOf(ts[1].gx, ts[1].gy)
        if ((a === inN && b === out) || (a === out && b === inN)) return c.value
      }
      return undefined
    }
    const rf = feedback('resistor')
    if (!rf || rf <= 0) continue
    const cf = feedback('capacitor')
    const gbw = getOpamp(op.part).gbwHz
    return { rfOhms: rf, gbwHz: gbw, cfActual: cf, comp: tiaCompensation(PHOTODIODE_CJ0, rf, gbw, cf) }
  }
  return null
}

const GRID = 24
const PAD = 16
const PIN_SNAP_PX = 10 // magnetic radius for modeless pin-to-pin wiring (Stage 3)
const PAPER_KEY = 'bm2k-paper-style'

// SCH-11 "paper" canvas: the circuitikz symbols are line artwork, so the schematic
// surface is a document skin INSIDE the dark app. These CSS custom properties are set
// on the schematic <svg> only, so every var()-coloured element inside re-resolves per
// skin without touching the app-wide dark theme. Three paper styles (Stage 4, andre):
// white (default — and what the PNG export ALWAYS uses, via the export `vars` override),
// green engineering pad (pale sage + fine line grid == the snap grid), and blueprint.
// The skins are on-screen editing surfaces only; exported figures stay publication-white.
type PaperStyle = 'white' | 'green' | 'blueprint'
const PAPER_STYLES: Record<PaperStyle, CSSProperties & Record<string, string>> = {
  white: {
    background: '#fdfdfa',
    '--sch-ink': '#1c1c1c',        // symbol + remaining inline part ink
    '--wire-color': '#1c1c1c',     // wires read as ink, like the reader's figures
    '--node-color': '#2a6ad0',     // terminal dots: visible wiring targets on paper
    '--accent-blue': '#1d6fd8',    // selection/marquee: darker blue for white bg
    '--text-primary': '#1c1c1c',
    '--text-secondary': '#5a5a5a',
    '--bg-panel': '#ffffff',       // body fill of the remaining inline parts (INA125)
    '--theory-color': '#0a8a4a',   // legacy probe marker
    '--ch1-color': '#c05f00',      // 1+/1− port markers (darkened CH1 orange)
    '--ch2-color': '#7d3fa0',      // 2+/2− port markers (darkened CH2 purple)
    '--awg-color': '#9c7a00',      // W1/W2 port markers (darkened from the dark theme's #e0c020)
    '--sch-grid': '#d8d8d2',       // grid dots
  },
  green: {
    // the classic sage computation pad: tint kept very light so ink and port hues pop
    background: '#edf2e3',
    '--sch-ink': '#1c1c1c',
    '--wire-color': '#1c1c1c',
    '--node-color': '#2a6ad0',
    '--accent-blue': '#1d6fd8',
    '--text-primary': '#1c1c1c',
    '--text-secondary': '#55604a',
    '--bg-panel': '#f6f9ef',
    '--theory-color': '#0a8a4a',
    '--ch1-color': '#c05f00',
    '--ch2-color': '#7d3fa0',
    '--awg-color': '#9c7a00',
    '--sch-grid': '#c7d6b6',       // printed grid lines (== the snap grid pitch)
    '--sch-grid-minor': '#e0e9d3', // the pad's fine 5×5 subdivision — barely-there
  },
  blueprint: {
    background: '#1d3a5f',
    '--sch-ink': '#e6edf5',        // white-line drawing on blue
    '--wire-color': '#e6edf5',
    '--node-color': '#7ab8ff',
    '--accent-blue': '#7ab8ff',
    '--text-primary': '#e6edf5',
    '--text-secondary': '#9fb4cc',
    '--bg-panel': '#1d3a5f',
    '--theory-color': '#4adf95',
    '--ch1-color': '#f0a030',      // bright channel hues read fine on deep blue
    '--ch2-color': '#c98fe8',
    '--awg-color': '#e0c020',
    '--sch-grid': '#33557f',
  },
}
// The PNG export is a publication figure: always the white-paper palette, whatever
// skin is on screen (passed to exportSvgToPng as the `vars` override).
const EXPORT_PAPER_VARS = Object.fromEntries(
  Object.entries(PAPER_STYLES.white).filter(([k]) => k.startsWith('--')),
) as Record<string, string>

type Tool = 'select' | 'wire' | SchKind

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'select', label: 'Select' },
  { tool: 'wire', label: 'Wire' },
  { tool: 'resistor', label: 'R' },
  { tool: 'capacitor', label: 'C' },
  { tool: 'inductor', label: 'L' },
  { tool: 'diode', label: 'Diode' },
  { tool: 'led', label: 'LED' },
  { tool: 'zener', label: 'Zener' },
  { tool: 'photodiode', label: 'Photo' },
  { tool: 'bjt', label: 'BJT' },
  { tool: 'mosfet', label: 'MOSFET' },
  { tool: 'opamp', label: 'Op-amp' },
  // INA125 palette button HIDDEN for the survey wave (andre, 2026-07-03). The part's whole
  // stack stays intact (SchKind, terminals, netlist model, DIP boarding + straps, macromodel)
  // and any placed/loaded INA125 still renders and simulates — re-enable by uncommenting this
  // one line when the INA/TIA lab work lands.
  // { tool: 'ina125', label: 'INA125' },
  { tool: 'awg1', label: 'W1' },
  { tool: 'awg2', label: 'W2' },
  // Option B (andre): ONE measurement input per channel — places the existing 1+/2+ port
  // (single-ended; the − lead comes from the differential toggle on the placed input).
  // The raw 1-/2- terminals are no longer palette buttons; the kinds still exist.
  { tool: 'scope1', label: 'CH1 meas' },
  { tool: 'scope2', label: 'CH2 meas' },
  { tool: 'vplus', label: 'V+' },
  { tool: 'vminus', label: 'V-' },
  { tool: 'ground', label: 'GND' },
]

// Human label for a singleton kind, for the "only one …" block message (Rule 3).
const singletonLabel = (k: SchKind): string =>
  ({ scope1: 'CH1', scope2: 'CH2', awg1: 'W1', awg2: 'W2', vplus: 'V+', vminus: 'V−' } as Partial<Record<SchKind, string>>)[k] ?? k

// UNIT, TUNE_RANGE, fmtEng, parseEng, tunePos, tuneValue now live in core/units.ts (shared
// with the Network Analyzer tune knobs). DEFAULT_VALUE stays here — it is editor-only.
// SCH-10: passive kinds whose value is picked from the ADALP2000 kit catalog (PassiveKind names
// match these SchKinds). No 'potentiometer' SchKind exists yet, so the picker covers R/C/L only.
const KIT_PASSIVE = new Set<SchKind>(['resistor', 'capacitor', 'inductor'])

const DEFAULT_VALUE: Partial<Record<SchKind, number>> = {
  resistor: 1000, capacitor: 100e-9, inductor: 1e-3, dcrail: 5, vplus: 5, vminus: -5,
  led: 2.0, zener: 3.3, photodiode: 80e-6,
}

// Default ADALP2000 part placed for a new transistor / op-amp (overridable in the Selected panel).
// op-amp defaults to a kit rail-to-rail part so new placements are kit; legacy circuits with no
// part fall back to the LMC662 model and show the off-kit warning.
const DEFAULT_PART: Partial<Record<SchKind, string>> = {
  bjt: '2N3904', mosfet: 'ZVN2110A', opamp: 'op484',
}

// Reference designators (R1, C2, L1, U1 for op/in-amps, V1). A new part increments from the
// highest existing number with the same prefix, so deleting one does not renumber the rest.
// The Ref field in the Selected panel lets the student override any id (must stay unique).
const REFDES: Partial<Record<SchKind, string>> = {
  resistor: 'R', capacitor: 'C', inductor: 'L', vsource: 'V',
  opamp: 'U', lmc662: 'U', ina125: 'U', bjt: 'Q', mosfet: 'M',
  // Diode family shares 'D' (a LED is a diode); 'led' must NOT fall back to 'L' (= inductor).
  diode: 'D', led: 'D', zener: 'D', photodiode: 'D',
}
function refPrefix(k: SchKind): string {
  return REFDES[k] ?? k[0].toUpperCase()
}
function newId(k: SchKind, comps: { id: string }[]): string {
  const p = refPrefix(k)
  let max = 0
  for (const c of comps) {
    const m = /^(.*?)(\d+)$/.exec(c.id)
    if (m && m[1] === p) max = Math.max(max, Number(m[2]))
  }
  return `${p}${max + 1}`
}

interface EditorProps {
  schematic: Schematic
  setSchematic: Dispatch<SetStateAction<Schematic>>
  // Shared schematic undo/redo, owned by App so the Board tab's lab load uses the same history.
  snapshot: () => void
  undo: () => void
  redo: () => void
  // Apply an example's preset generator (W1) on load (e.g. a triangle sweep for an I-V curve).
  onLoadGenerators?: (w1?: import('../core/signal').SignalParams, w2?: import('../core/signal').SignalParams) => void
  // Request the scope setup an example wants on load (XY mode + optional Volts/div framing).
  onLoadScope?: (req: { xy: boolean; ch1Vdiv?: number; ch2Vdiv?: number }) => void
  // Open the Curve Tracer when an example requests it (SWEEP-1 curve-family examples).
  onOpenTracer?: () => void
  // Reset the breadboard on an example load: to the example's pre-built board when it ships one
  // (QS-4: the flashlight lands placed + wired + lit), else to empty (no stale placements).
  onLoadBoard?: (b?: import('../core/breadboard').BoardLayout) => void
  // SCH-13: current W1/W2 waveforms, so the awg1/awg2 symbol draws the actual wave shape.
  w1Wave?: import('../core/signal').WaveType
  w2Wave?: import('../core/signal').WaveType
}

export default function SchematicEditor({ schematic, setSchematic, snapshot, undo, redo, onLoadGenerators, onLoadScope, onOpenTracer, onLoadBoard, w1Wave, w2Wave }: EditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const contentRef = useRef<SVGGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Whether the pointer is over this panel — gates the global R handler (see the keydown effect).
  const pointerInsideRef = useRef(false)
  const sch = schematic
  const setSch = setSchematic
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<string | null>(null)
  const [selSet, setSelSet] = useState<Set<string>>(new Set()) // multi-select (shift-click or box)
  const [selWires, setSelWires] = useState<Set<string>>(new Set()) // box-selected wire ends "i:1"/"i:2"
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueeMoved = useRef(false)
  const [wireStart, setWireStart] = useState<{ x: number; y: number } | null>(null)
  // Single drag (one component, absolute target) OR group drag (a set + wire ends, by delta).
  // A drag is applied from the schematic as it was at MOUSEDOWN (`dragBase`), never incrementally
  // from the last frame. Incremental application silently broke connections: moveComponentWithWires
  // bridges a touch-connection into a real wire, but that new wire is not in `attached` (captured at
  // mousedown), so on the next mouse-move it was left behind — a real drag ends up trailing a
  // one-cell stub while the part sails away disconnected (andre: "why is the connection to ground
  // severed"). Re-deriving from the base each move makes the gesture idempotent: the bridge is built
  // once, from the full delta, and the wire-end indices stay valid.
  const [drag, setDrag] = useState<
    | { id: string; ox: number; oy: number; attached: WireEndRef[] }
    | { ids: string[]; wireEnds: string[]; startGx: number; startGy: number }
    | null
  >(null)
  const dragBase = useRef<Schematic | null>(null)
  const [placeRotation, setPlaceRotation] = useState(0)
  const [placeMirror, setPlaceMirror] = useState(false) // ghost pre-flip (Stage 4)
  // On-screen paper skin (white / green pad / blueprint) — view-only; export is always white.
  // Persisted; first run defaults to the GREEN pad (andre: the ruling is the point of
  // engineering paper — it reads as a workspace and helps align parts).
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(() => {
    try {
      const r = localStorage.getItem(PAPER_KEY)
      if (r === 'white' || r === 'green' || r === 'blueprint') return r
    } catch { /* ignore */ }
    return 'green'
  })
  useEffect(() => { try { localStorage.setItem(PAPER_KEY, paperStyle) } catch { /* quota */ } }, [paperStyle])
  // Right-click context menu on a part: rotate/flip/duplicate/delete without the keyboard.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  // Place-time type selectors: when the Op-amp / In-amp tool is active a sub-selector below the
  // toolbar picks the exact part to drop. These map to (kind, opModel) at placement time.
  const [simStatus, setSimStatus] = useState('')
  const [simBusy, setSimBusy] = useState(false)
  const engineRef = useRef<SpiceEngine | null>(null)
  const [hoverGrid, setHoverGrid] = useState<{ gx: number; gy: number } | null>(null)
  // Part under the cursor — R/F act on it in preference to the selection (Stage 2 hover-targeting).
  const [hoverPartId, setHoverPartId] = useState<string | null>(null)
  // INST-1: a brief message when a singleton placement/paste is blocked (Rule 3).
  const [placeMsg, setPlaceMsg] = useState<string | null>(null)
  // Stage 3 pin-magnetic modeless wiring (Select tool): the pin under the cursor (magnetic
  // highlight + snap target) and the start pin of a wiring gesture in progress.
  const [hoverPin, setHoverPin] = useState<{ x: number; y: number } | null>(null)
  const [pinWire, setPinWire] = useState<{ x: number; y: number } | null>(null)
  const [selectedWire, setSelectedWire] = useState<number | null>(null)

  // ---- FIT-1: the schematic is always fully framed on the pad ----------------------------------
  // The drawing is rendered through this transform. It is recomputed from the RENDERED extent of
  // the content layer (getBBox — glyphs, ground symbols and text labels included, which grid
  // coordinates alone would miss) after every change that can move the bounding box, so no part of
  // the circuit can end up past an edge where the student can neither see nor reach it.
  const [view, setView] = useState<View>(IDENTITY_VIEW)
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 }) // the pad's rendered size

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setVp((p) => (Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { w: r.width, h: r.height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure) // the split view is draggable — refit when the pad resizes
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Refit after the DOM holds the new content but before paint, so a load/place never flashes clipped.
  // Deliberately NOT run mid-drag: the drag is clamped to the framed region, so the part stays in
  // view; refitting on every mouse-move would make the canvas oscillate under the cursor. The drop
  // (drag → null) settles the final fit.
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || drag || marquee || vp.w < GRID || vp.h < GRID) return
    // getBBox measures the content group in its OWN (pre-transform) coordinates, so the fit cannot
    // feed back into what it measures — a reframe changes the viewport, never the content bbox.
    const b = sch.components.length || sch.wires.length ? content.getBBox() : null
    const next = fitToContent(
      b && b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null,
      vp,
      { margin: GRID },
    )
    setView((v) => (sameView(v, next) ? v : next)) // unchanged fit → same object → React bails out
  }, [sch, drag, marquee, vp])

  const viewTransform = `translate(${view.tx.toFixed(3)} ${view.ty.toFixed(3)}) scale(${view.scale.toFixed(5)})`
  // The visible pad in world coordinates — the region the grid layer has to cover once the content
  // is scaled/panned (a plain 100%-sized rect would only cover the un-transformed viewport).
  function worldRect(): { x: number; y: number; w: number; h: number } {
    const tl = toWorld(view, 0, 0), br = toWorld(view, vp.w || 1200, vp.h || 800)
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
  }

  // ---- Clipboard (copy/paste/cut). Undo/redo (snapshot/undo/redo) come from App via props. -----
  const dragSnapped = useRef(false) // snapshot once per drag/tune gesture, not per mouse-move
  const clip = useRef<{ components: Schematic['components']; wires: Schematic['wires'] } | null>(null)

  // Copy the current selection (parts + any wires whose both ends sit on selected parts' pins).
  function copySelection(): boolean {
    const ids = selSet.size ? [...selSet] : (selected ? [selected] : [])
    if (!ids.length) return false
    const comps = sch.components.filter((c) => ids.includes(c.id))
    const term = new Set<string>()
    for (const c of comps) for (const t of terminalsOf(c)) term.add(`${t.gx},${t.gy}`)
    const wires = sch.wires.filter((w) => term.has(`${w.x1},${w.y1}`) && term.has(`${w.x2},${w.y2}`))
    clip.current = { components: comps.map((c) => ({ ...c })), wires: wires.map((w) => ({ ...w })) }
    return true
  }
  function pasteClipboard() {
    if (!clip.current || !clip.current.components.length) return
    snapshot()
    const dx = 2, dy = 2 // offset the copy so it doesn't sit on the original
    const existing = [...sch.components]
    // Rule 3: a paste must not clone a singleton that already exists (nor two of one from the clip).
    const dropped: SchKind[] = []
    const pasteSeen = new Set<SchKind>()
    const newComps = clip.current.components
      .filter((c) => {
        if (!SINGLETON_KINDS.has(c.kind)) return true
        if (existing.some((e) => e.kind === c.kind) || pasteSeen.has(c.kind)) { dropped.push(c.kind); return false }
        pasteSeen.add(c.kind); return true
      })
      .map((c) => {
        const nc = { ...c, id: newId(c.kind, existing), gx: c.gx + dx, gy: c.gy + dy }
        existing.push(nc)
        return nc
      })
    setPlaceMsg(dropped.length ? `Skipped ${[...new Set(dropped.map(singletonLabel))].join(', ')} on paste — one of each on the M2K.` : null)
    const newWires = clip.current.wires.map((w) => ({ x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }))
    setSch((s) => ({ components: [...s.components, ...newComps], wires: [...s.wires, ...newWires] }))
    setSelSet(new Set(newComps.map((c) => c.id)))
    setSelected(newComps.length === 1 ? newComps[0].id : null)
    setSelWires(new Set()); setSelectedWire(null)
  }
  function cutSelection() {
    if (copySelection()) deleteSelected()
  }

  const result = useMemo(() => toCircuit(sch, 'Schematic'), [sch])

  // Create the SPICE engine (worker) once for the Simulate action.
  useEffect(() => {
    engineRef.current = createSpiceEngine()
    return () => { engineRef.current?.dispose(); engineRef.current = null }
  }, [])

  // FIT-1 supersedes SCH-14's mount-time recovery clamp (`clampAllInBounds` on mount/open), which is
  // REMOVED. It rewrote the drawing to fit whatever pane the editor happened to mount in — and in the
  // short stacked Board pane (maxGy ≈ 4) it did not merely nudge parts, it sheared them into each
  // other: every example lost nets (rc-lp 6→4, summing 9→4), silently changing the circuit and
  // autosaving the damage. Its purpose — "an off-canvas part must not be unreachable" — is now met by
  // the viewport instead of by mutating the model: the fit always frames the whole drawing, so there
  // is nothing to recover. The INTERACTIVE clamps (drag/rotate, below) still hold the SCH-14
  // invariant; they now clamp to the framed region, so they are pane-size independent too.

  // SCH-2: build the netlist from the drawing and run it through the engine.
  async function simulate() {
    if (result.warnings.length) { setSimStatus('Cannot simulate — ' + result.warnings.join(' ')); return }
    setSimBusy(true)
    setSimStatus('simulating…')
    try {
      const nl = buildNetlist(result.circuit, { kind: 'ac', sweep: 'dec', points: 30, fStart: 10, fStop: 1e6 })
      const res = await engineRef.current!.run(nl)
      let extra = ''
      try {
        const tf = transferFunction(res, 'out', 'in')
        const ref = tf.magDb[0]
        let fc: number | null = null
        for (let i = 1; i < tf.magDb.length; i++) {
          if (tf.magDb[i - 1] >= ref - 3 && tf.magDb[i] < ref - 3) { fc = tf.freq[i]; break }
        }
        if (fc) extra = ' · -3 dB ' + (fc >= 1000 ? (fc / 1000).toFixed(2) + ' kHz' : fc.toFixed(0) + ' Hz')
      } catch { /* not a simple low-pass — skip the cutoff readout */ }
      setSimStatus('OK — simulated ' + res.numPoints + ' points' + extra)
    } catch (e) {
      setSimStatus('engine error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSimBusy(false)
    }
  }

  // SCH-3: save the circuit to a .json file the student names. Uses the native Save dialog
  // (File System Access API) when the browser supports it, else falls back to a name prompt.
  async function saveCircuit() {
    // Tag the file so it self-identifies as a circuit (vs a board "lab" bundle). Old untagged
    // files (just {components,wires}) still load fine.
    const json = JSON.stringify({ kind: 'm2k-circuit', version: 1, ...sch }, null, 2)
    const sfp = (window as unknown as {
      showSaveFilePicker?: (o: {
        suggestedName?: string
        types?: { description?: string; accept: Record<string, string[]> }[]
      }) => Promise<{ name: string; createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>
    }).showSaveFilePicker
    if (typeof sfp === 'function') {
      try {
        const handle = await sfp({
          suggestedName: 'm2k-circuit.json',
          types: [{ description: 'M2K circuit', accept: { 'application/json': ['.json'] } }],
        })
        const w = await handle.createWritable()
        await w.write(json)
        await w.close()
        setSimStatus('saved ' + handle.name)
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // user cancelled the dialog
        // any other error: fall through to the download fallback below
      }
    }
    let name = prompt('Save circuit as:', 'm2k-circuit.json')
    if (name === null) return // cancelled
    name = name.trim() || 'm2k-circuit.json'
    if (!name.toLowerCase().endsWith('.json')) name += '.json'
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    setSimStatus('saved ' + name)
  }
  function openCircuit(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result))
        // Accept either a circuit file ({components,wires}) or a board "lab" bundle (the circuit
        // lives under .schematic) — so loading a lab file here still loads its circuit.
        const fromLab = d && d.schematic && Array.isArray(d.schematic.components) && Array.isArray(d.schematic.wires)
        const src = fromLab ? d.schematic : d
        if (Array.isArray(src.components) && Array.isArray(src.wires)) {
          snapshot()
          // migrate pre-two-terminal saves (standalone 1-/2- ports → the scope's − pin). FIT-1: the
          // opened drawing is framed, not clamped — an old save keeps its geometry exactly as drawn.
          setSch(migrateSchematic({ components: src.components, wires: src.wires }))
          setSelected(null)
          setSelectedWire(null)
          setSimStatus(fromLab
            ? `loaded circuit from lab file ${f.name} — use the Board tab's Open to also restore the board`
            : `loaded ${f.name}`)
        } else {
          setSimStatus('not a valid circuit or lab file')
        }
      } catch {
        setSimStatus('could not read file')
      }
    }
    reader.readAsText(f)
    e.target.value = '' // allow re-loading the same file
  }

  // Mouse position → snapped grid coordinates. FIT-1: the content is drawn through a fit transform,
  // so a screen point goes back through `toWorld` before it means anything in grid space.
  function gridAt(e: React.MouseEvent): { gx: number; gy: number } {
    const r = svgRef.current!.getBoundingClientRect()
    const w = toWorld(view, e.clientX - r.left, e.clientY - r.top)
    return {
      gx: Math.max(0, Math.round((w.x - PAD) / GRID)),
      gy: Math.max(0, Math.round((w.y - PAD) / GRID)),
    }
  }
  // SCH-14: the usable grid region — a part's terminals must stay inside [0..maxGx] × [0..maxGy] or
  // it is dragged/rotated somewhere the student can't see or reach. FIT-1 measures it from the FRAMED
  // world region rather than the raw pane: the fit always frames the whole drawing, so this region
  // always contains every existing part (a short pane can no longer squash the circuit into itself),
  // and it grows as the view zooms out — you can always drag a part outward to make room, and the
  // drop reframes. Fallback bounds if the pad isn't measured yet.
  function canvasBounds(): { maxGx: number; maxGy: number } {
    if (vp.w < GRID || vp.h < GRID) return { maxGx: 40, maxGy: 24 }
    const r = worldRect()
    return {
      maxGx: Math.max(1, Math.floor((r.x + r.w - PAD) / GRID)),
      maxGy: Math.max(1, Math.floor((r.y + r.h - PAD) / GRID)),
    }
  }

  // Nearest wireable pin (a component terminal or an existing wire endpoint) within the magnetic
  // radius of the RAW mouse position — sub-grid distance, so the snap feels magnetic rather than
  // cell-quantized. Recomputed in the down handlers (not read from hover state) to avoid staleness.
  function pinNear(e: React.MouseEvent): { x: number; y: number } | null {
    const r = svgRef.current!.getBoundingClientRect()
    const m = toWorld(view, e.clientX - r.left, e.clientY - r.top)
    let best: { x: number; y: number } | null = null
    // The magnetic radius is a SCREEN distance, so it feels the same at any fit zoom.
    let bd = PIN_SNAP_PX / view.scale
    const consider = (gx: number, gy: number) => {
      const d = Math.hypot(m.x - (gx * GRID + PAD), m.y - (gy * GRID + PAD))
      if (d < bd) { bd = d; best = { x: gx, y: gy } }
    }
    for (const c of sch.components) for (const t of terminalsOf(c)) consider(t.gx, t.gy)
    for (const w of sch.wires) { consider(w.x1, w.y1); consider(w.x2, w.y2) }
    return best
  }

  // Pin-magnetic wiring gesture: first pin-down starts it, second commits the orthogonal route,
  // a down anywhere that is not a pin cancels (the grid-click Wire tool remains the free-form path).
  function pinWireDown(target: { x: number; y: number } | null) {
    if (!pinWire) {
      if (target) setPinWire(target)
      return
    }
    if (target && (target.x !== pinWire.x || target.y !== pinWire.y)) {
      const segs = orthoRoute(pinWire, target)
      if (segs.length) {
        snapshot()
        setSch((s) => ({ ...s, wires: [...s.wires, ...segs] }))
      }
    }
    setPinWire(null)
  }

  // Background mouse-down: in the Select tool, start a marquee (drag a box to select). Components
  // stop propagation on their own mouse-down, so this only fires on empty canvas.
  // Bounding box (grid units) of the current multi-selection, or null if nothing is boxed.
  function selectionBounds(): { minx: number; miny: number; maxx: number; maxy: number } | null {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false
    const ext = (x: number, y: number) => { any = true; minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y) }
    for (const c of sch.components) if (selSet.has(c.id)) for (const t of terminalsOf(c)) ext(t.gx, t.gy)
    sch.wires.forEach((w, i) => { if (selWires.has(`${i}:1`)) ext(w.x1, w.y1); if (selWires.has(`${i}:2`)) ext(w.x2, w.y2) })
    return any ? { minx, miny, maxx, maxy } : null
  }

  function onSvgDown(e: React.MouseEvent) {
    if (tool !== 'select') return
    // Pin-magnetic wiring takes precedence: a down on a pin starts/commits a wire; a down
    // anywhere else while wiring cancels it (and does not fall through to marquee/drag).
    const pin = pinNear(e)
    if (pinWire || pin) { pinWireDown(pin); return }
    const { gx, gy } = gridAt(e)
    marqueeMoved.current = false
    dragSnapped.current = false
    // Press inside an existing selection → drag the whole group; press outside → start a new box.
    const b = selectionBounds()
    if (b && gx >= b.minx - 1 && gx <= b.maxx + 1 && gy >= b.miny - 1 && gy <= b.maxy + 1) {
      dragBase.current = sch
      setDrag({ ids: [...selSet], wireEnds: [...selWires], startGx: gx, startGy: gy })
      return
    }
    setMarquee({ x0: gx, y0: gy, x1: gx, y1: gy })
  }

  function onBackgroundClick(e: React.MouseEvent) {
    if (marqueeMoved.current) { marqueeMoved.current = false; return } // a box-drag, not a click
    const { gx, gy } = gridAt(e)
    setSelectedWire(null)
    if (tool === 'select') { setSelected(null); setSelSet(new Set()); setSelWires(new Set()); return }
    if (tool === 'wire') {
      if (!wireStart) setWireStart({ x: gx, y: gy })
      else {
        if (wireStart.x !== gx || wireStart.y !== gy) {
          snapshot()
          setSch((s) => ({ ...s, wires: [...s.wires, { x1: wireStart.x, y1: wireStart.y, x2: gx, y2: gy }] }))
        }
        setWireStart(null)
      }
      return
    }
    // place a component. The Op-amp / In-amp tools resolve to a specific kind+model via the
    // place-time sub-selector; everything else places its own kind directly.
    const kind = tool as SchKind
    // Rule 3: the M2K I/O are singletons — block a second CH1/CH2/W1/W2/V+/V− (GND is repeatable).
    if (SINGLETON_KINDS.has(kind) && hasKind(sch, kind)) {
      setPlaceMsg(`Only one ${singletonLabel(kind)} — the M2K has one of each.`)
      return
    }
    setPlaceMsg(null)
    // Op-amp places kind 'opamp' (LMC662); INA125 places kind 'ina125'. Power implied in sim, DIP on board.
    const c: SchComponent = { id: newId(kind, sch.components), kind, gx, gy, rotation: placeRotation, mirror: (placeMirror && canMirror(kind)) || undefined, value: DEFAULT_VALUE[kind], part: DEFAULT_PART[kind] }
    snapshot()
    setSch((s) => ({ ...s, components: [...s.components, c] }))
    setSelected(c.id)
    setSelSet(new Set([c.id]))
    setSelWires(new Set())
  }

  function onComponentDown(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    // Grab a pin → wire; grab the body → select/drag (the standard EDA split). Terminal dots
    // paint inside the component group, so the wiring check must run here too.
    if (tool === 'select') {
      const pin = pinNear(e)
      if (pinWire || pin) { pinWireDown(pin); return }
    }
    setSelectedWire(null)
    dragSnapped.current = false
    if (e.shiftKey) {
      // Shift-click toggles membership in the multi-selection (no drag starts).
      setSelSet((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
      setSelected(id)
      return
    }
    setSelected(id) // clicking a placed part selects it in any tool (so R / Rotate act on it)
    const groupDrag = selSet.has(id) && selSet.size > 1
    if (!groupDrag) { setSelSet(new Set([id])); setSelWires(new Set()) }
    if (tool !== 'select') return
    const { gx, gy } = gridAt(e)
    dragBase.current = sch
    if (groupDrag) {
      setDrag({ ids: [...selSet], wireEnds: [...selWires], startGx: gx, startGy: gy })
    } else {
      const c = sch.components.find((x) => x.id === id)!
      setDrag({ id, ox: gx - c.gx, oy: gy - c.gy, attached: attachedWireEnds(sch, c) })
    }
  }
  function onWireClick(e: React.MouseEvent, i: number) {
    e.stopPropagation()
    if (tool === 'wire') return // don't select while drawing wires
    if (pinWire || pinNear(e)) return // the down already started/committed a pin wire — not a select
    setSelectedWire(i)
    setSelected(null)
  }
  // Hover-targeting (Stage 2): the part whose terminal bounding box contains the snapped grid
  // point — computed from the model, not DOM enter/leave on the artwork, so the gaps between a
  // symbol's thin strokes still count as "over the part". Topmost (last rendered) wins.
  function partAt(gx: number, gy: number): string | null {
    for (let i = sch.components.length - 1; i >= 0; i--) {
      const ts = terminalsOf(sch.components[i])
      let minx = ts[0].gx, maxx = ts[0].gx, miny = ts[0].gy, maxy = ts[0].gy
      for (const t of ts) {
        minx = Math.min(minx, t.gx); maxx = Math.max(maxx, t.gx)
        miny = Math.min(miny, t.gy); maxy = Math.max(maxy, t.gy)
      }
      if (gx >= minx && gx <= maxx && gy >= miny && gy <= maxy) return sch.components[i].id
    }
    return null
  }
  function onMouseMove(e: React.MouseEvent) {
    const { gx, gy } = gridAt(e)
    setHoverGrid({ gx, gy }) // live snap indicator for the wire tool
    setHoverPartId(partAt(gx, gy))
    setHoverPin(tool === 'select' && !drag && !marquee ? pinNear(e) : null)
    if (marquee) {
      if (gx !== marquee.x0 || gy !== marquee.y0) marqueeMoved.current = true
      setMarquee((m) => (m ? { ...m, x1: gx, y1: gy } : m))
      return
    }
    if (!drag) return
    const base = dragBase.current ?? sch // the drawing as it was at mousedown — see `dragBase`
    if ('ids' in drag) {
      // Group drag: translate the whole selection by the TOTAL delta from the grab point, clamped so
      // no selected part's terminal crosses ANY edge (SCH-14 — parts can't be dragged off-canvas).
      let ddx = gx - drag.startGx, ddy = gy - drag.startGy
      const b = canvasBounds()
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity
      for (const id of drag.ids) {
        const c = base.components.find((x) => x.id === id); if (!c) continue
        const tb = componentTerminalBox(c)
        gMinX = Math.min(gMinX, tb.minx); gMinY = Math.min(gMinY, tb.miny)
        gMaxX = Math.max(gMaxX, tb.maxx); gMaxY = Math.max(gMaxY, tb.maxy)
      }
      ddx = Math.min(Math.max(ddx, -gMinX), b.maxGx - gMaxX)
      ddy = Math.min(Math.max(ddy, -gMinY), b.maxGy - gMaxY)
      if (ddx !== 0 || ddy !== 0) {
        if (!dragSnapped.current) { snapshot(); dragSnapped.current = true }
        marqueeMoved.current = true
      }
      setSch(moveSelectionBy(base, new Set(drag.ids), new Set(drag.wireEnds), ddx, ddy))
      return
    }
    const b = canvasBounds()
    const c = base.components.find((x) => x.id === drag.id)
    if (!c) return
    const t = clampMoveTarget(c, gx - drag.ox, gy - drag.oy, b.maxGx, b.maxGy) // keep every terminal on-canvas
    if (t.gx === c.gx && t.gy === c.gy) { setSch(base); return }
    if (!dragSnapped.current) { snapshot(); dragSnapped.current = true }
    setSch(moveComponentWithWires(base, drag.id, t.gx, t.gy, drag.attached))
  }
  function onMouseUp() {
    const dropped = drag
    const didMove = dragSnapped.current // a part/selection actually translated this gesture
    dragSnapped.current = false
    dragBase.current = null
    // SCH-15: on drop, re-route the moved part's attached wires orthogonally so they read clean
    // instead of stretching to diagonals. No new snapshot — part of the same one-undo drag gesture.
    if (dropped && didMove) {
      const ids = 'ids' in dropped ? new Set(dropped.ids) : new Set([dropped.id])
      setSch((s) => rerouteAttachedWires(s, ids))
    }
    if (marquee) {
      if (marqueeMoved.current) {
        const xlo = Math.min(marquee.x0, marquee.x1), xhi = Math.max(marquee.x0, marquee.x1)
        const ylo = Math.min(marquee.y0, marquee.y1), yhi = Math.max(marquee.y0, marquee.y1)
        const inBox = (x: number, y: number) => x >= xlo && x <= xhi && y >= ylo && y <= yhi
        // a part is selected if ANY of its pins is in the box (forgiving for big parts like the DIP)
        const hit = sch.components.filter((c) => terminalsOf(c).some((t) => inBox(t.gx, t.gy)))
        const we = new Set<string>()
        sch.wires.forEach((w, i) => { if (inBox(w.x1, w.y1)) we.add(`${i}:1`); if (inBox(w.x2, w.y2)) we.add(`${i}:2`) })
        setSelSet(new Set(hit.map((c) => c.id)))
        setSelWires(we)
        setSelected(hit.length === 1 ? hit[0].id : null)
        setSelectedWire(null)
      }
      setMarquee(null)
    }
    setDrag(null)
  }

  function deleteSelected() {
    if (selectedWire === null && selSet.size === 0 && !selected) return
    setHoverPartId(null) // a removed element fires no mouseleave — drop the hover id explicitly
    snapshot()
    if (selectedWire !== null) {
      setSch((s) => ({ ...s, wires: s.wires.filter((_, i) => i !== selectedWire) }))
      setSelectedWire(null)
      return
    }
    if (selSet.size > 1) {
      const wi = new Set([...selWires].map((e) => Number(e.split(':')[0])))
      setSch((s) => deleteComponentsWithWires(s, selSet, wi))
      setSelSet(new Set()); setSelWires(new Set()); setSelected(null)
      return
    }
    if (!selected) return
    setSch((s) => deleteComponentsWithWires(s, new Set([selected])))
    setSelSet(new Set()); setSelWires(new Set()); setSelected(null)
  }
  // R/F target: the part under the cursor wins, else the selection. Resolved against the live
  // component list because a delete can leave a stale hover id (no mouseleave fires for a
  // removed element).
  function keyTarget(): SchComponent | null {
    for (const id of [hoverPartId, selected]) {
      const c = id ? sch.components.find((x) => x.id === id) : undefined
      if (c) return c
    }
    return null
  }
  // With a part tool active the user is placing: R/F pre-rotate/pre-flip the ghost that rides
  // the cursor (Stage 4), never a part already on the canvas.
  const placing = tool !== 'select' && tool !== 'wire'
  function rotate() {
    if (placing) { setPlaceRotation((r) => (r + 1) % 4); return }
    const target = keyTarget()
    if (target) {
      snapshot()
      const b = canvasBounds()
      setSch((s) => rotateComponentInBounds(s, target.id, b.maxGx, b.maxGy))
    } else {
      setPlaceRotation((r) => (r + 1) % 4)
    }
  }
  function flip() {
    if (placing) { if (canMirror(tool as SchKind)) setPlaceMirror((m) => !m); return }
    const target = keyTarget()
    if (!target || !canMirror(target.kind)) return
    snapshot()
    setSch((s) => mirrorComponentWithWires(s, target.id))
  }
  function rotatePart(id: string) {
    snapshot()
    const b = canvasBounds()
    setSch((s) => rotateComponentInBounds(s, id, b.maxGx, b.maxGy))
  }
  function flipPart(id: string) {
    snapshot()
    setSch((s) => mirrorComponentWithWires(s, id))
  }
  function duplicatePart(id: string) {
    const c = sch.components.find((x) => x.id === id)
    if (!c) return
    // Rule 3: a singleton can't be duplicated (there is only one on the M2K).
    if (SINGLETON_KINDS.has(c.kind)) { setPlaceMsg(`Only one ${singletonLabel(c.kind)} — the M2K has one of each.`); return }
    const copy: SchComponent = { ...c, id: newId(c.kind, sch.components), gx: c.gx + 1, gy: c.gy + 1 }
    snapshot()
    setSch((s) => ({ ...s, components: [...s.components, copy] }))
    setSelected(copy.id); setSelSet(new Set([copy.id])); setSelWires(new Set())
  }
  function deletePart(id: string) {
    setHoverPartId(null)
    snapshot()
    setSch((s) => deleteComponentsWithWires(s, new Set([id])))
    setSelSet(new Set()); setSelWires(new Set()); setSelected(null)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return // let text fields keep their own keys
      const mod = e.ctrlKey || e.metaKey
      if (mod) {
        const k = e.key.toLowerCase()
        const clearSel = () => { setSelected(null); setSelectedWire(null); setSelSet(new Set()); setSelWires(new Set()) }
        if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); clearSel() }
        else if (k === 'y') { e.preventDefault(); redo(); clearSel() }
        else if (k === 'c') { e.preventDefault(); copySelection() }
        else if (k === 'v') { e.preventDefault(); pasteClipboard() }
        else if (k === 'x') { e.preventDefault(); cutSelection() }
        return
      }
      // Delete/R/F act only when the pointer is over THIS panel: in the stacked Board view the
      // Breadboard is mounted alongside with its own global keys, and without the gate one press
      // hit both — deleting/rotating the selected schematic part while the user worked the board.
      // Within the panel, R/F prefer the part under the cursor over the selection (keyTarget).
      if (!pointerInsideRef.current) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selected || selectedWire !== null || selSet.size)) deleteSelected()
      else if (e.key === 'r' || e.key === 'R') rotate()
      else if (e.key === 'f' || e.key === 'F') flip()
      else if (e.key === 'Escape') { setPinWire(null); setWireStart(null); setCtxMenu(null) } // abandon gesture/menu
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  // Any press outside the context menu dismisses it (the menu stops its own mousedown).
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  const sel = sch.components.find((c) => c.id === selected) || null

  function setSelId(text: string) {
    const name = text.trim()
    if (!name || !sel || name === sel.id) return
    if (sch.components.some((c) => c.id !== sel.id && c.id === name)) {
      setSimStatus(`Ref "${name}" is already in use`)
      return
    }
    const oldId = sel.id
    snapshot()
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === oldId ? { ...c, id: name } : c) }))
    setSelected(name)
  }

  function setSelValue(text: string) {
    const v = parseEng(text)
    if (v === undefined || !sel) return
    snapshot()
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, value: v } : c) }))
  }

  // LOOP-2: live numeric setter for the tune slider (no string round-trip), drives a debounced re-sim.
  function setSelValueNum(v: number) {
    if (!sel) return
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, value: v } : c) }))
  }

  // Convert a placed diode between plain / LED / Zener / Photodiode; reset value to the new type's
  // sensible default (LED Vf 2 V, Zener BV 3.3 V, Photodiode 80 µA; plain diode has no value).
  function setSelDiodeKind(k: 'diode' | 'led' | 'zener' | 'photodiode') {
    if (!sel) return
    snapshot()
    const value = k === 'led' ? 2.0 : k === 'zener' ? 3.3 : k === 'photodiode' ? 80e-6 : undefined
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, kind: k, value } : c) }))
  }

  // Option B: presentational scope/voltmeter view on the shared measurement input (1+/2+).
  // Same port, same nets, same sim — only the badge glyph changes.
  function setSelView(v: 'scope' | 'voltmeter') {
    if (!sel) return
    snapshot()
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, view: v === 'scope' ? undefined : v } : c) }))
  }

  // SCH-8: choose the ADALP2000 transistor part (sets the NPN/PNP or N/P-channel model body).
  function setSelPart(part: string) {
    if (!sel) return
    snapshot()
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, part } : c) }))
  }

  // SCH-9: estimate an op-amp's closed-loop noise gain (1 + Rf/Rg) from the resistors on its inN
  // node, so the inspector can fire the OP37 "min stable gain 5" warning. Returns null if the
  // topology isn't a recognisable resistive-feedback amp. A direct out→inN short (unity buffer) → 1;
  // feedback with no gain-setting leg (e.g. transimpedance) → Infinity (treated as ≥ stable).
  function opampNoiseGain(op: SchComponent): number | null {
    const nets = computeNets(sch)
    const ts = terminalsOf(op)
    const inN = ts.find((t) => t.name === 'inN'); const out = ts.find((t) => t.name === 'out')
    if (!inN || !out) return null
    const inNnet = nets.get(`${inN.gx},${inN.gy}`); const outnet = nets.get(`${out.gx},${out.gy}`)
    if (!inNnet || !outnet) return null
    if (inNnet === outnet) return 1 // out tied straight back to inN → unity-gain follower
    let rf: number | null = null; let rg: number | null = null
    for (const c of sch.components) {
      if (c.kind !== 'resistor') continue
      const rt = terminalsOf(c)
      const a = nets.get(`${rt[0].gx},${rt[0].gy}`); const b = nets.get(`${rt[1].gx},${rt[1].gy}`)
      if (a !== inNnet && b !== inNnet) continue
      const other = a === inNnet ? b : a
      const ohms = c.value ?? 0
      if (other === outnet) rf = ohms                          // feedback resistor
      else if (rg === null || ohms < rg) rg = ohms             // smallest gain-setting leg
    }
    if (rf === null) return null              // no resistive feedback recognised
    if (rg === null) return Infinity          // feedback only (transimpedance) → high noise gain
    return rg > 0 ? 1 + rf / rg : Infinity
  }

  // A pin is powered if a wire reaches it or another part's terminal sits on it.
  function pinConnected(gx: number, gy: number, selfId: string): boolean {
    if (sch.wires.some((w) => (w.x1 === gx && w.y1 === gy) || (w.x2 === gx && w.y2 === gy))) return true
    return sch.components.some((c) => c.id !== selfId && terminalsOf(c).some((t) => t.gx === gx && t.gy === gy))
  }

  // Build parts (LMC662 op-amp / DIP) need their rails wired; warn if V+/V- is floating.
  function unwiredRails(c: SchComponent): string[] {
    if (ampCategory(c) !== 'build') return []
    return terminalsOf(c)
      .filter((t) => (t.name === 'vpos' || t.name === 'vneg') && !pinConnected(t.gx, t.gy, c.id))
      .map((t) => (t.name === 'vpos' ? 'V+' : 'V−'))
  }

  const px = (g: number) => g * GRID + PAD

  // True when the cursor is over a committed multi-selection → show the "move" cursor so the
  // grab-to-move step is discoverable (matches the +/-1 grab pad in onSvgDown).
  const overSelection = (() => {
    if (tool !== 'select' || drag || marquee || !hoverGrid || (selSet.size + selWires.size) < 2) return false
    const b = selectionBounds()
    return !!b && hoverGrid.gx >= b.minx - 1 && hoverGrid.gx <= b.maxx + 1 && hoverGrid.gy >= b.miny - 1 && hoverGrid.gy <= b.maxy + 1
  })()

  return (
    <div className="instrument-panel"
      onMouseEnter={() => { pointerInsideRef.current = true }}
      onMouseLeave={() => { pointerInsideRef.current = false }}>
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Schematic Editor</span>
          <div className="display-controls">
            <button className="run-btn active" onClick={simulate} disabled={simBusy}>{simBusy ? 'Simulating…' : '▶ Simulate'}</button>
            <button className="run-btn" onClick={rotate}>Rotate (R)</button>
            <button className="run-btn" onClick={flip}>Flip (F)</button>
            <button className="run-btn" onClick={deleteSelected} disabled={!selected && selectedWire === null}>Delete</button>
            <button className="run-btn" onClick={saveCircuit}>Save</button>
            <button className="run-btn" onClick={() => fileRef.current?.click()}>Open</button>
            <button className="run-btn" title="Save the schematic as a white-paper PNG figure for your prelab"
              onClick={() => { if (svgRef.current) exportSvgToPng(svgRef.current, 'schematic.png', { paper: true, vars: EXPORT_PAPER_VARS }).catch((e) => setSimStatus('Export failed: ' + e.message)) }}>
              Export PNG
            </button>
            <select className="run-btn" title="Paper style — on-screen editing skin only; the PNG export is always white"
              value={paperStyle} onChange={(e) => setPaperStyle(e.target.value as PaperStyle)}>
              <option value="white">White paper</option>
              <option value="green">Green pad</option>
              <option value="blueprint">Blueprint</option>
            </select>
            <select className="run-btn" title="Load an example circuit" value=""
              onChange={(e) => {
                const ex = EXAMPLES.find((x) => x.id === e.target.value)
                if (ex) {
                  snapshot()
                  setSch(JSON.parse(JSON.stringify(ex.schematic)))
                  setSelected(null); setSelectedWire(null)
                  // Drop to the Select tool so the first click on the canvas doesn't drop a resistor.
                  setTool('select'); setWireStart(null)
                  if (ex.w1 || ex.w2) onLoadGenerators?.(ex.w1, ex.w2)
                  // Always: the board hard-resets on an example load (to the example's pre-built
                  // board when it ships one, else empty — stale same-id placements must not survive).
                  onLoadBoard?.(ex.board)
                  onLoadScope?.({ xy: !!ex.xy, ch1Vdiv: ex.ch1Vdiv, ch2Vdiv: ex.ch2Vdiv })
                  if (ex.tracer) onOpenTracer?.()
                  setSimStatus('loaded example: ' + ex.name)
                }
              }}>
              <option value="">Examples ▾</option>
              {['Passive', 'Amplifiers'].map((g) => (
                <optgroup key={g} label={g}>
                  {EXAMPLES.filter((x) => x.group === g).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="run-btn" onClick={() => { if (!window.confirm('Clear the entire circuit? You can undo this with Ctrl+Z.')) return; snapshot(); setSch({ components: [], wires: [] }); setSelected(null); setSelectedWire(null) }}>Clear</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={openCircuit} />
          </div>
        </div>
        <svg
          ref={svgRef}
          className="plotly-display"
          style={{ ...PAPER_STYLES[paperStyle], cursor: tool !== 'select' || hoverPin || pinWire ? 'crosshair' : (overSelection ? 'move' : 'default') }}
          onClick={onBackgroundClick}
          onMouseDown={onSvgDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { setMarquee(null); setDrag(null); dragBase.current = null; setHoverPartId(null); setHoverPin(null); setHoverGrid(null) }}
          onContextMenu={(e) => {
            // Right-click a part → action menu (mouse/touch discoverability for R/F etc.).
            e.preventDefault()
            const { gx, gy } = gridAt(e)
            const id = partAt(gx, gy)
            if (id) {
              setSelected(id); setSelSet(new Set([id])); setSelWires(new Set()); setSelectedWire(null)
              setCtxMenu({ x: e.clientX, y: e.clientY, id })
            } else setCtxMenu(null)
          }}
        >
          {/* grid dots */}
          <defs>
            <pattern id="gridDots" x={PAD} y={PAD} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
              {paperStyle === 'white'
                ? <circle cx={0} cy={0} r={1} fill="var(--sch-grid)" />
                // engineering pad / blueprint: a printed line grid, one cell = one snap step;
                // the green pad also gets the classic 5×5 minor subdivision, kept very faint
                : <>
                    {paperStyle === 'green' && (
                      <path d={[1, 2, 3, 4].map((i) => `M ${i * GRID / 5} 0 V ${GRID} M 0 ${i * GRID / 5} H ${GRID}`).join(' ')}
                        fill="none" stroke="var(--sch-grid-minor)" strokeWidth={0.4} />
                    )}
                    <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="var(--sch-grid)" strokeWidth={0.6} />
                  </>}
            </pattern>
          </defs>
          {/* FIT-1 grid layer: transformed with the content so the ruling stays aligned to the
              parts at any fit zoom, and sized in world units so it still covers the whole pad. */}
          <g transform={viewTransform}>
            {(() => {
              const r = worldRect()
              return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="url(#gridDots)" />
            })()}
          </g>

          {/* FIT-1 content layer — the drawing itself, and the ONLY thing the fit measures. Transient
              overlays (cursor ghost, marquee, wire preview) live in the layer below so they can't
              inflate the bounding box and pull the view around while you hover. */}
          <g ref={contentRef} transform={viewTransform}>

          {/* wires (thin visible line + a fat transparent hit area for easy clicking) */}
          {sch.wires.map((w, i) => (
            <g key={i}>
              <line x1={px(w.x1)} y1={px(w.y1)} x2={px(w.x2)} y2={px(w.y2)}
                stroke={selectedWire === i || selWires.has(`${i}:1`) || selWires.has(`${i}:2`) ? 'var(--accent-blue)' : 'var(--wire-color)'}
                strokeWidth={selectedWire === i ? 3 : 2} />
              <line x1={px(w.x1)} y1={px(w.y1)} x2={px(w.x2)} y2={px(w.y2)}
                stroke="transparent" strokeWidth={12}
                style={{ cursor: tool === 'wire' ? 'crosshair' : 'pointer', pointerEvents: tool === 'wire' ? 'none' : 'auto' }}
                onClick={(e) => onWireClick(e, i)} />
            </g>
          ))}

          {/* components */}
          {sch.components.map((c) => (
            <g key={c.id} onMouseDown={(e) => onComponentDown(e, c.id)} onClick={(e) => e.stopPropagation()}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer', pointerEvents: tool === 'wire' ? 'none' : 'auto' }}>
              {renderSymbol(c, px, c.id === selected || selSet.has(c.id), c.kind === 'awg1' ? w1Wave : c.kind === 'awg2' ? w2Wave : undefined)}
              {terminalsOf(c).map((t, i) => (
                <circle key={i} cx={px(t.gx)} cy={px(t.gy)} r={3} fill="var(--node-color)" />
              ))}
            </g>
          ))}

          {/* junction dots — a filled dot where two pins butt together (a touch-connection) or three
              or more pins/wires meet, so "these are electrically connected here" is always visible. */}
          {(() => {
            const cnt = new Map<string, { t: number; w: number; x: number; y: number }>()
            const bump = (x: number, y: number, k: 't' | 'w') => {
              const e = cnt.get(`${x},${y}`) ?? { t: 0, w: 0, x, y }
              e[k]++; cnt.set(`${x},${y}`, e)
            }
            for (const c of sch.components) for (const t of terminalsOf(c)) bump(t.gx, t.gy, 't')
            for (const w of sch.wires) { bump(w.x1, w.y1, 'w'); bump(w.x2, w.y2, 'w') }
            const dots: ReactElement[] = []
            for (const e of cnt.values()) {
              if (e.t >= 2 || e.t + e.w >= 3) {
                dots.push(<circle key={`j${e.x},${e.y}`} cx={px(e.x)} cy={px(e.y)} r={4} fill="var(--wire-color)" pointerEvents="none" />)
              }
            }
            return dots
          })()}
          </g>{/* end content layer */}

          {/* FIT-1 overlay layer: transient, cursor-following art. World-space (so it lands on the
              grid) but OUTSIDE the measured content, so the ghost riding your cursor toward an edge
              doesn't drag the whole view around with it. */}
          <g transform={viewTransform}>
            {/* wire-in-progress: start marker + rubber-band to the snapped cursor point */}
            {wireStart && (
              <circle cx={px(wireStart.x)} cy={px(wireStart.y)} r={4} fill="none" stroke="var(--accent-blue)" strokeWidth={2} pointerEvents="none" />
            )}
            {tool === 'wire' && wireStart && hoverGrid && (
              <line x1={px(wireStart.x)} y1={px(wireStart.y)} x2={px(hoverGrid.gx)} y2={px(hoverGrid.gy)}
                stroke="var(--accent-blue)" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
            )}
            {/* live snap indicator: shows exactly which grid point the wire/part will land on */}
            {tool === 'wire' && hoverGrid && (
              <circle cx={px(hoverGrid.gx)} cy={px(hoverGrid.gy)} r={5} fill="none"
                stroke="var(--accent-blue)" strokeWidth={1.5} pointerEvents="none" />
            )}

            {/* Stage 3 pin-magnetic wiring: highlight ring on the snapped pin, and while a gesture
                is live, the exact orthogonal route that a commit would add (dashed). */}
            {hoverPin && !drag && !marquee && (
              <circle cx={px(hoverPin.x)} cy={px(hoverPin.y)} r={7} fill="none"
                stroke="var(--accent-blue)" strokeWidth={2} pointerEvents="none" />
            )}
            {pinWire && (
              <circle cx={px(pinWire.x)} cy={px(pinWire.y)} r={4.5} fill="var(--accent-blue)" pointerEvents="none" />
            )}
            {pinWire && hoverGrid && (() => {
              const end = hoverPin ?? { x: hoverGrid.gx, y: hoverGrid.gy }
              return orthoRoute(pinWire, end).map((w, i) => (
                <line key={`pw${i}`} x1={px(w.x1)} y1={px(w.y1)} x2={px(w.x2)} y2={px(w.y2)}
                  stroke="var(--accent-blue)" strokeWidth={1.5} strokeDasharray="5 3" pointerEvents="none" />
              ))
            })()}

            {/* marquee box-select */}
            {marquee && (
              <rect x={px(Math.min(marquee.x0, marquee.x1))} y={px(Math.min(marquee.y0, marquee.y1))}
                width={Math.abs(marquee.x1 - marquee.x0) * GRID} height={Math.abs(marquee.y1 - marquee.y0) * GRID}
                fill="var(--accent-blue)" fillOpacity={0.12} stroke="var(--accent-blue)" strokeWidth={1}
                strokeDasharray="4 3" pointerEvents="none" />
            )}

            {/* committed multi-selection: a visible grab-box so it's clear you can press inside and
                drag to move. The +/-1 pad matches the hit area in onSvgDown. Hidden while marquee-ing. */}
            {!marquee && (selSet.size + selWires.size) >= 2 && (() => {
              const b = selectionBounds()
              if (!b) return null
              return (
                <rect x={px(b.minx - 1)} y={px(b.miny - 1)}
                  width={(b.maxx - b.minx + 2) * GRID} height={(b.maxy - b.miny + 2) * GRID}
                  fill="var(--accent-blue)" fillOpacity={0.06} stroke="var(--accent-blue)" strokeWidth={1}
                  strokeDasharray="2 4" pointerEvents="none" />
              )
            })()}

            {/* Stage 4 ghost-place: the active palette part rides the cursor (R/F pre-rotate/flip);
                the click that commits it is unchanged (onBackgroundClick places at the same snap). */}
            {placing && hoverGrid && (() => {
              const kind = tool as SchKind
              const ghost: SchComponent = {
                id: newId(kind, sch.components), kind, gx: hoverGrid.gx, gy: hoverGrid.gy,
                rotation: placeRotation, mirror: (placeMirror && canMirror(kind)) || undefined,
                value: DEFAULT_VALUE[kind], part: DEFAULT_PART[kind],
              }
              return (
                <g opacity={0.45} pointerEvents="none">
                  {renderSymbol(ghost, px, false)}
                  {terminalsOf(ghost).map((t, i) => (
                    <circle key={i} cx={px(t.gx)} cy={px(t.gy)} r={3} fill="var(--node-color)" />
                  ))}
                </g>
              )
            })()}
          </g>

          {/* Stage 4 hover hint chip — screen-space (never scaled by the fit) */}
          <g pointerEvents="none" style={{ opacity: tool === 'select' && hoverPartId && !drag && !marquee && !pinWire ? 0.92 : 0, transition: 'opacity 0.25s' }}>
            <rect x={8} y={8} width={272} height={20} rx={10} fill="var(--bg-panel)" stroke="var(--sch-grid)" />
            <text x={144} y={22} fontSize={10} fill="var(--text-secondary)" textAnchor="middle">drag to move (wires follow) · R rotate · F flip · right-click</text>
          </g>
        </svg>

        {/* Stage 4 right-click menu — rotate/flip/duplicate/delete without the keyboard */}
        {ctxMenu && (() => {
          const c = sch.components.find((x) => x.id === ctxMenu.id)
          if (!c) return null
          const item = (label: string, fn: () => void, disabled = false) => (
            <button key={label} className="run-btn" disabled={disabled}
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() => { fn(); setCtxMenu(null) }}>{label}</button>
          )
          return (
            <div onMouseDown={(e) => e.stopPropagation()}
              style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 1000, background: 'var(--bg-panel)', border: '1px solid #4a4a4a', borderRadius: 6, padding: 4, minWidth: 150, boxShadow: '0 4px 14px rgba(0,0,0,0.45)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '2px 6px 4px' }}>{c.id} ({c.kind})</div>
              {item('Rotate (R)', () => rotatePart(c.id))}
              {item('Flip (F)', () => flipPart(c.id), !canMirror(c.kind))}
              {item('Duplicate', () => duplicatePart(c.id))}
              {item('Delete', () => deletePart(c.id))}
            </div>
          )
        })()}
      </div>

      <div className="settings-panel">
        <div className="section-title">Tools</div>
        <div className="wave-selector">
          {TOOLS.map((t) => {
            // Rule 3: grey an already-placed singleton so the user sees why a second is blocked.
            const blocked = SINGLETON_KINDS.has(t.tool as SchKind) && hasKind(sch, t.tool as SchKind)
            return (
              <button key={t.tool} className={tool === t.tool ? 'active' : ''} disabled={blocked}
                style={blocked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                title={blocked ? `Already placed — the M2K has one ${singletonLabel(t.tool as SchKind)}` : undefined}
                onClick={() => { setTool(t.tool); setWireStart(null); setPlaceMsg(null) }}>{t.label}</button>
            )
          })}
        </div>
        {placeMsg && (
          <div style={{ fontSize: 10, marginTop: 6, color: 'var(--awg-color, #e0c020)' }}>{placeMsg}</div>
        )}
        {tool === 'opamp' && (
          <div style={{ fontSize: 10, marginTop: 6, color: 'var(--text-secondary)' }}>
            Op-amp — defaults to a kit part (OP484); pick the exact ADALP2000 op-amp in the Selected panel. Power implied in simulation; a DIP on the breadboard.
          </div>
        )}
        {tool === 'ina125' && (
          <div style={{ fontSize: 10, marginTop: 6, color: 'var(--text-secondary)' }}>
            INA125 instrumentation amp. Gain = 4 + 60 kΩ/R_G — set it with an external resistor across the
            RG pins. Power implied in sim; on the breadboard it's a 16-pin DIP whose V+/V− you wire.
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
          M2K pins — <b style={{ color: '#e0c020' }}>W1/W2</b> outputs, <b style={{ color: 'var(--ch1-color)' }}>1+/1-</b> Ch1 in,
          <b style={{ color: 'var(--ch2-color)' }}> 2+/2-</b> Ch2 in, <b style={{ color: '#e04040' }}>V+</b> /
          <b style={{ color: '#4a9eff' }}>V-</b> supply, <b style={{ color: '#cccccc' }}>GND</b>.
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Place angle: {placeRotation * 90}°{placeMirror ? ' · flipped' : ''} &nbsp;(placing: R/F turn and flip the ghost on the cursor; otherwise R/F act on the part under the cursor, else the selection)
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
          Select tool: <b>drag a box</b> over parts to select them (or Shift+click), then drag any to move the group{selSet.size > 1 ? ` (${selSet.size} selected)` : ''}.
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
          Wiring: <b>click a pin</b> (blue ring), then another pin — no Wire tool needed. Esc cancels.
        </div>

        <div className="section-title">Selected</div>
        {sel ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-primary)', marginBottom: 6 }}>
              {sel.id} ({sel.kind}) — {(sel.rotation ?? 0) * 90}°{sel.mirror ? ' · flipped' : ''}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button className="run-btn" onClick={rotate}>Rotate (R)</button>
              {canMirror(sel.kind) && <button className="run-btn" onClick={flip}>Flip (F)</button>}
            </div>
            <div className="control-row-inline">
              <label>Ref</label>
              <input type="text" defaultValue={sel.id} key={'ref-' + sel.id}
                onBlur={(e) => setSelId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                style={{ width: 80 }} />
            </div>
            {(sel.kind === 'diode' || sel.kind === 'led' || sel.kind === 'zener' || sel.kind === 'photodiode') && (
              <div className="control-row-inline">
                <label>Type</label>
                <select value={sel.kind} onChange={(e) => setSelDiodeKind(e.target.value as 'diode' | 'led' | 'zener' | 'photodiode')} style={{ width: 150 }}>
                  <option value="diode">Diode (silicon)</option>
                  <option value="led">LED (set Vf)</option>
                  <option value="zener">Zener (set BV)</option>
                  <option value="photodiode">Photodiode (set Iₚ)</option>
                </select>
              </div>
            )}
            {(sel.kind === 'scope1' || sel.kind === 'scope2') && (() => {
              const ch = sel.kind === 'scope1' ? 1 : 2
              return (
                <>
                  <div className="control-row-inline">
                    <label>View as</label>
                    <select value={sel.view ?? 'scope'} onChange={(e) => setSelView(e.target.value as 'scope' | 'voltmeter')} style={{ width: 150 }}>
                      <option value="scope">Oscilloscope</option>
                      <option value="voltmeter">Voltmeter</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                    The shared CH{ch} input — scope and voltmeter read the same pins. Leave the
                    {ch}− lead unwired for single-ended (referenced to GND); wire it to a node
                    to measure differentially across a part.
                  </div>
                </>
              )
            })()}
            {(sel.kind === 'bjt' || sel.kind === 'mosfet') && (
              <div className="control-row-inline">
                <label>Part</label>
                <select value={sel.part ?? ''} onChange={(e) => setSelPart(e.target.value)} style={{ width: 150 }}>
                  {Object.entries(TRANSISTOR_PARTS)
                    .filter(([, p]) => sel.kind === 'bjt' ? (p.type === 'npn' || p.type === 'pnp') : (p.type === 'nmos' || p.type === 'pmos'))
                    .map(([name, p]) => <option key={name} value={name}>{name} ({p.type.toUpperCase()})</option>)}
                </select>
              </div>
            )}
            {KIT_PASSIVE.has(sel.kind) ? (() => {
              // SCH-10 kit picker: a value can only be one the student physically has. A loaded
              // off-kit value (legacy file / live-tuned) is NOT mutated — it shows flagged with a
              // one-click snap to the nearest kit value.
              const pk = sel.kind as PassiveKind
              const v = sel.value ?? 0
              const onKit = isKitValue(pk, v)
              const near = nearestKitValue(pk, v)
              return (
                <>
                  <div className="control-row-inline" title="Pick a value from your ADALP2000 parts kit">
                    <label>Value</label>
                    <select value={onKit ? String(near.value) : '__off'}
                      onChange={(e) => { if (e.target.value !== '__off') { snapshot(); setSelValueNum(Number(e.target.value)) } }}
                      style={{ width: 150 }}>
                      {!onKit && <option value="__off">{formatValue(pk, v)} — not in kit</option>}
                      {kitValues(pk).map((p) => (
                        <option key={p.value} value={String(p.value)}>{p.label}{p.partNumber ? ` (${p.partNumber})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  {!onKit && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, color: '#ffaa55', border: '1px solid #ffaa55' }}>
                        ⚠ not in your parts kit
                      </span>
                      <button className="run-btn" title={`Snap to the nearest kit value (${near.label})`}
                        onClick={() => { snapshot(); setSelValueNum(near.value) }}>
                        Snap to {near.label}
                      </button>
                    </div>
                  )}
                </>
              )
            })() : UNIT[sel.kind] ? (
              <div className="control-row-inline">
                <label>Value ({UNIT[sel.kind]})</label>
                <input type="text" defaultValue={fmtEng(sel.value ?? 0)} key={sel.id + ':' + (sel.value ?? 0)}
                  onBlur={(e) => setSelValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 80 }} />
              </div>
            ) : null}
            {TUNE_RANGE[sel.kind] && (() => {
              const [lo, hi] = TUNE_RANGE[sel.kind]!
              return (
                <div className="control-row-inline" title="Drag to tune live — the Bode/scope update as you go">
                  <label>Tune</label>
                  <input type="range" min={0} max={1000} value={tunePos(sel.value ?? lo, lo, hi)}
                    onPointerDown={() => snapshot()}
                    onChange={(e) => setSelValueNum(tuneValue(Number(e.target.value), lo, hi))}
                    style={{ width: 90 }} />
                </div>
              )
            })()}
            {sel.kind === 'photodiode' && (() => {
              // TIA-3: compensation hint. If this photodiode drives an op-amp TIA, suggest the
              // stabilising feedback Cf ≈ √(Cin/(2π·Rf·GBW)); otherwise just show the formula + Cj0.
              const hint = tiaHintFor(sch, sel.id)
              return (
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
                  <div>Junction cap C<sub>j0</sub> ≈ 72 pF. In a transimpedance amp this forms the input
                    pole with R<sub>f</sub>; add a feedback C<sub>f</sub> ≈ √(C<sub>in</sub>/(2π·R<sub>f</sub>·GBW)) to keep it stable.</div>
                  {hint ? (
                    <div style={{ marginTop: 3 }}>
                      Detected TIA: R<sub>f</sub> = {fmtEng(hint.rfOhms)}Ω, GBW = {fmtEng(hint.gbwHz)}Hz →
                      <b> suggested C<sub>f</sub> ≈ {fmtEng(hint.comp.cfRecommended)}F</b> (BW ≈ {fmtEng(hint.comp.bandwidthHz)}Hz).
                      {' '}{hint.cfActual !== undefined ? `Your Cf = ${fmtEng(hint.cfActual)}F.` : 'No Cf yet.'}
                      {hint.comp.peaking && (
                        <span style={{ color: '#ffaa55' }}> ⚠ C<sub>f</sub> is below the suggested value — expect peaking/ringing.</span>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: 3 }}>Wire the cathode to an op-amp inverting input with a feedback R<sub>f</sub> to see a specific C<sub>f</sub> suggestion.</div>
                  )}
                </div>
              )
            })()}
            {sel.kind === 'opamp' && (() => {
              // SCH-9 kit op-amp picker. No kit `part` → legacy LMC662 model (off-kit) with a swap.
              const kind = sel.part && isKitOpamp(sel.part) ? sel.part : null
              const onKit = kind !== null
              const part = kind ? getOpamp(kind) : null
              const gain = opampNoiseGain(sel)
              const op37LowGain = part?.kind === 'op37' && gain !== null && gain < 5
              // TIA-0: the simulated supply is the part's auto-rail default (±5 V kit; single +5 V for
              // a low-voltage part like the TLV9062), so the over-max warning tracks the actual rails.
              const railDef = part?.supplyDefault ?? { vcc: 5, vee: -5 }
              const supplyTotal = railDef.vcc - railDef.vee
              const railLabel = railDef.vee === 0 ? `+${railDef.vcc} V single-supply` : `±${railDef.vcc} V`
              const overSupply = part ? supplyTotal > part.supplyMax : false
              return (
                <>
                  <div className="control-row-inline" title="Pick an op-amp from your ADALP2000 parts kit">
                    <label>Op-amp</label>
                    <select value={kind ?? '__off'}
                      onChange={(e) => { if (e.target.value !== '__off') setSelPart(e.target.value) }}
                      style={{ width: 150 }}>
                      {!onKit && <option value="__off">LMC662 — not in kit</option>}
                      {opampList().map((p) => (
                        <option key={p.kind} value={p.kind}>{p.name} ({p.package})</option>
                      ))}
                    </select>
                  </div>
                  {part && (
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                      {part.name}: GBW {fmtEng(part.gbwHz)}Hz, slew {part.slewRate} V/µs,
                      {part.railToRailOut ? ' rail-to-rail output' : ` output to ~${part.outputHeadroom} V of each rail`}.
                    </div>
                  )}
                  {part?.origin === 'course' && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, color: 'var(--accent-blue)', border: '1px solid var(--accent-blue)' }}>
                        course part
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        supplied for the course (not in the ADALP2000 kit); boards as a SOIC-8 on a DIP adapter
                      </span>
                    </div>
                  )}
                  {!onKit && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, color: '#ffaa55', border: '1px solid #ffaa55' }}>
                        ⚠ not in your parts kit
                      </span>
                      <button className="run-btn" title="Swap to the kit OP484 (rail-to-rail, ±5 V)"
                        onClick={() => setSelPart('op484')}>Swap to OP484</button>
                    </div>
                  )}
                  {op37LowGain && (
                    <div style={{ fontSize: 10, color: '#ffaa55', marginTop: 4, lineHeight: 1.4 }}>
                      ⚠ OP37 is decompensated — stable only at closed-loop gain ≥ 5 (this stage ≈ {gain === Infinity ? '∞' : gain.toFixed(1)}). Use OP27 for low gain.
                    </div>
                  )}
                  {overSupply && (
                    <div style={{ fontSize: 10, color: '#ffaa55', marginTop: 4, lineHeight: 1.4 }}>
                      ⚠ {part!.name} max supply is {part!.supplyMin}–{part!.supplyMax} V — the simulated {railLabel} ({supplyTotal} V total) exceeds its max.
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                    Power is implied in simulation (auto {railLabel}); on the breadboard it's a DIP whose V+/V− you wire to the rails.
                  </div>
                </>
              )
            })()}
            {sel.kind === 'ina125' && (
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                INA125 in-amp. Gain = 4 + 60 kΩ/R_G (external R_G across the RG pins). Output referred to
                IAREF (tie to GND). 16-pin DIP on the board; wire V+/V− to the rails.
              </div>
            )}
            {ampCategory(sel) && (() => {
              const cat = ampCategory(sel)
              const rails = unwiredRails(sel)
              return (
                <div style={{ marginTop: 4 }}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    color: cat === 'build' ? 'var(--accent-orange)' : 'var(--theory-color)',
                    border: `1px solid ${cat === 'build' ? 'var(--accent-orange)' : 'var(--theory-color)'}`,
                  }}>
                    {cat === 'build' ? 'Simulation + build' : 'Simulation only'}
                  </span>
                  {cat === 'sim' && (
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
                      Ideal model — no power supply needed to simulate.
                    </div>
                  )}
                  {rails.length > 0 && (
                    <div style={{ fontSize: 10, color: '#ffaa55', marginTop: 3, lineHeight: 1.4 }}>
                      ⚠ {rails.join(' and ')} not connected — a real part needs power to work.
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        ) : selectedWire !== null ? (
          <div style={{ fontSize: 11, color: 'var(--accent-blue)' }}>Wire selected — press Delete to remove</div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Nothing selected</div>
        )}

        <div className="section-title">Circuit</div>
        {result.warnings.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--theory-color)' }}>
            ✓ valid — {result.circuit.components.filter((c) => c.kind !== 'ground').length} parts
          </div>
        ) : (
          <ul style={{ fontSize: 11, color: '#ffaa55', margin: 0, paddingLeft: 16 }}>
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        {simStatus && (
          <div style={{ fontSize: 11, marginTop: 6, fontFamily: 'monospace', color: simStatus.startsWith('OK') ? 'var(--theory-color)' : '#ffaa55' }}>
            {simStatus}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
          Tip: place parts, wire them, then press Simulate. Needs a V src, a Ground, and a
          Probe on the output. The Network Analyzer plots the result.
        </div>
      </div>
    </div>
  )
}

// SCH-11 I/O instrument badges: a small catalog glyph next to each M2K port's label, teaching
// which instrument the port is (W1→generator, 1±/2±→scope/voltmeter input, V±→supply). The
// glyph is clipped to its BODY (the bipole leads cropped away) and scaled to BADGE_PX, ink =
// currentColor so identity/selection tinting flows through. Render-only: the port keeps its
// single pin, its instrument binding, and the sim path untouched.
const BADGE_PX = 20
function badgeArt(uid: string, symId: string, cx: number, cy: number, bodyFrac = 0.5): ReactElement | null {
  const sym = SYMBOL_CATALOG[symId]
  if (!sym) return null
  const [vx, vy, vw, vh] = sym.viewBox.split(/\s+/).map(Number)
  const side = vw + 3 // bipole bodies are ≈ as tall as the glyph is wide (+ a little margin)
  const bcx = vx + vw / 2
  const bcy = vy + vh * bodyFrac // body centre as a fraction down the glyph (oscilloscope's is high)
  const s = BADGE_PX / side
  const clipId = `bclip-${uid}`
  return (
    <g transform={`translate(${(cx - bcx * s).toFixed(2)} ${(cy - bcy * s).toFixed(2)}) scale(${s.toFixed(4)})`}>
      <clipPath id={clipId}>
        <rect x={bcx - side / 2} y={bcy - side / 2} width={side} height={side} />
      </clipPath>
      {/* invisible grab pad: the glyph is unfilled line art, so without this a press inside
          the badge falls through to the canvas (marquee) instead of dragging the port */}
      <rect x={bcx - side / 2} y={bcy - side / 2} width={side} height={side} fill="transparent" stroke="none" />
      <g clipPath={`url(#${clipId})`} dangerouslySetInnerHTML={{ __html: inkedInner(symId, sym, s) }} />
    </g>
  )
}

function renderSymbol(c: SchComponent, px: (g: number) => number, selected: boolean, waveType?: import('../core/signal').WaveType) {
  const stroke = selected ? 'var(--accent-blue)' : 'var(--sch-ink)'
  const sw = selected ? 2.5 : 1.8
  const ax = px(c.gx), ay = px(c.gy)
  const rot = (c.rotation ?? 0) * 90
  const G = (n: number) => n * GRID
  // Keep text upright despite the group rotation (counter-rotate about the label point).
  const upright = (tx: number, ty: number, el: ReactElement) => (
    <g transform={`rotate(${-rot} ${tx} ${ty})`}>{el}</g>
  )

  let inner: ReactElement
  // SCH-11: kinds with a circuitikz catalog symbol render from it, the artwork
  // transformed so every catalog pin sits exactly on the app's grid terminals
  // (baseTerminals stays authoritative — the symbol conforms to the model).
  const art = symbolFor(c, waveType)
  if (art) {
    const pinById = new Map(art.sym.pins.map((p) => [p.id, p]))
    const src = art.pinIds.map((id) => pinById.get(id)!).filter(Boolean)
    // localTerminals bakes the model-space mirror into the destination points, so the
    // alignment transform re-derives a flipped render — no scaleX stacked on top (which
    // would double-flip symbols whose alignment already reflects, like the op-amp).
    const dst = localTerminals(c).map((t) => ({ x: ax + G(t.gx), y: ay + G(t.gy) }))
    const m = alignTransform(src, dst)
    const html = inkedInner(art.id, art.sym, matScale(m))
    // M2K instruments keep their identity hue (channel orange/purple, generator amber)
    const PORT_INK: Partial<Record<SchKind, string>> = {
      scope1: 'var(--ch1-color)', scope2: 'var(--ch2-color)',
      awg1: 'var(--awg-color)', awg2: 'var(--awg-color)',
    }
    const ink = selected ? 'var(--accent-blue)' : (PORT_INK[c.kind] ?? 'var(--sch-ink)')
    const cx = ax + G(1), y = ay
    const idText = (tx: number, ty: number, size = 10, fill = 'var(--text-secondary)') =>
      upright(tx, ty, <text x={tx} y={ty} fill={fill} fontSize={size} textAnchor="middle">{c.id}</text>)
    const labels: ReactElement[] = []
    switch (c.kind) {
      case 'resistor':
      case 'capacitor':
      case 'inductor':
        // Placed in SCREEN space below (outside the rotation) — see `outerLabels`. A local-frame
        // label rotates with the part, which swung a vertical part's value onto its left-hand
        // neighbour's value (the RC low-pass printed "1.5kΩ" and "100nF" on top of each other).
        break
      case 'vsource':
        labels.push(idText(cx, y - 18))
        break
      case 'diode':
      case 'zener':
        labels.push(idText(cx, y - 15, 9))
        break
      case 'led':
      case 'photodiode':
        labels.push(idText(cx, y + 20, 9))
        break
      case 'bjt':
      case 'mosfet':
        labels.push(idText(cx, ay - 5, 9))
        labels.push(upright(cx, ay + G(2) + 13, <text x={cx} y={ay + G(2) + 13} fill="var(--text-primary)" fontSize={8} textAnchor="middle">{c.part ?? (c.kind === 'bjt' ? 'BJT' : 'MOSFET')}</text>))
        break
      case 'opamp':
        labels.push(idText(ax + G(2) + 4, ay + G(1) + 4))
        break
      case 'lmc662': {
        // catalog DIP body is unlabeled — keep the app's pin/name labels on top
        const w = G(4), bx0 = ax + 12, bx1 = ax + w - 12, cxm = ax + w / 2
        // pin columns swap sides when the DIP is mirrored — labels follow the pins
        const colA = ['OUTA', '−A', '+A', 'V−'], colB = ['V+', 'OUTB', '−B', '+B']
        const [lLab, rLab] = c.mirror ? [colB, colA] : [colA, colB]
        for (let i = 0; i < 4; i++) {
          labels.push(upright(bx0 + 13, ay + G(i) + 3, <text x={bx0 + 13} y={ay + G(i) + 3} fill="var(--text-secondary)" fontSize={8} textAnchor="start">{lLab[i]}</text>))
          labels.push(upright(bx1 - 13, ay + G(i) + 3, <text x={bx1 - 13} y={ay + G(i) + 3} fill="var(--text-secondary)" fontSize={8} textAnchor="end">{rLab[i]}</text>))
        }
        labels.push(idText(cxm, ay + G(1) + 2, 9, 'var(--sch-ink)'))
        labels.push(upright(cxm, ay + G(2) + 2, <text x={cxm} y={ay + G(2) + 2} fill="var(--text-secondary)" fontSize={8} textAnchor="middle">LMC662</text>))
        break
      }
      case 'ground':
        labels.push(upright(ax, ay + 28, <text x={ax} y={ay + 28} fill="var(--sch-ink)" fontSize={9} textAnchor="middle">GND</text>))
        break
      case 'awg1':
      case 'awg2':
        labels.push(upright(ax + 16, ay + G(1) + 3, <text x={ax + 16} y={ay + G(1) + 3} fill={ink} fontSize={10} textAnchor="start">{c.kind === 'awg1' ? 'W1' : 'W2'}</text>))
        break
      case 'scope1':
      case 'scope2': {
        const ch = c.kind === 'scope1' ? '1' : '2'
        labels.push(upright(ax - 8, ay + 4, <text x={ax - 8} y={ay + 4} fill={ink} fontSize={10} textAnchor="end">{ch}+</text>))
        labels.push(upright(ax - 8, ay + G(2) + 4, <text x={ax - 8} y={ay + G(2) + 4} fill={ink} fontSize={10} textAnchor="end">{ch}−</text>))
        break
      }
    }
    // W1/W2's return lead carries a DRAWN ground: the M2K bonds both returns to its one internal
    // ground (node 0), so the schematic shows that fixed bond honestly at the return pin. The scope
    // − is NOT a fixed bond — it is a designer choice (Rule 2), so it is NEVER auto-grounded here;
    // a single-ended channel shows a ground only because the designer placed one on the − lead.
    let extraArt: ReactElement | null = null
    const drawReturnGround = c.kind === 'awg1' || c.kind === 'awg2'
    if (drawReturnGround) {
      const gsym = SYMBOL_CATALOG['ground']
      if (gsym) {
        const gm = alignTransform([{ x: gsym.pins[0].x, y: gsym.pins[0].y }], [dst[1]])
        extraArt = (
          <g transform={`matrix(${gm.map((n) => +n.toFixed(5)).join(' ')})`}
            style={{ color: ink }}
            dangerouslySetInnerHTML={{ __html: inkedInner('ground', gsym, matScale(gm)) }} />
        )
      }
    }
    inner = (
      <g>
        <g transform={`matrix(${m.map((n) => +n.toFixed(5)).join(' ')})`}
          style={{ color: ink }}
          dangerouslySetInnerHTML={{ __html: html }} />
        {extraArt}
        {labels.map((l, i) => <g key={i}>{l}</g>)}
      </g>
    )
  } else if (c.kind === 'ina125') {
    const xL = ax + G(1), xR = ax + G(6), yT = ay, yB = ay + G(2), yM = ay + G(1), yBot = ay + G(4)
    const top = yT - 12, bot = yB + 12
    inner = (
      <g>
        {/* VIN+ / VIN− input stubs (left), VO output stub (right) */}
        <line x1={ax} y1={yT} x2={xL} y2={yT} stroke={stroke} strokeWidth={sw} />
        <line x1={ax} y1={yB} x2={xL} y2={yB} stroke={stroke} strokeWidth={sw} />
        <line x1={xR} y1={yM} x2={ax + G(7)} y2={yM} stroke={stroke} strokeWidth={sw} />
        <rect x={xL} y={top} width={xR - xL} height={bot - top} rx={3} fill="var(--bg-panel)" stroke={stroke} strokeWidth={sw} />
        {/* bottom stubs: RG (×2, left/centre) and IAREF (right, separated) */}
        <line x1={ax + G(2)} y1={bot} x2={ax + G(2)} y2={yBot} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + G(4)} y1={bot} x2={ax + G(4)} y2={yBot} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + G(6)} y1={bot} x2={ax + G(6)} y2={yBot} stroke={stroke} strokeWidth={sw} />
        {upright(xL + 11, yT + 4, <text x={xL + 11} y={yT + 4} fill="var(--text-primary)" fontSize={11} textAnchor="middle">+</text>)}
        {upright(xL + 11, yB + 1, <text x={xL + 11} y={yB + 1} fill="var(--text-primary)" fontSize={13} textAnchor="middle">−</text>)}
        {upright(ax + G(3.5), yM + 3, <text x={ax + G(3.5)} y={yM + 3} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">INA125</text>)}
        {upright(ax + G(3), yBot + 9, <text x={ax + G(3)} y={yBot + 9} fill="var(--text-secondary)" fontSize={7} textAnchor="middle">R_G</text>)}
        {upright(ax + G(6), yBot + 9, <text x={ax + G(6)} y={yBot + 9} fill="var(--text-secondary)" fontSize={7} textAnchor="middle">IAREF→GND</text>)}
        {upright(ax + G(3.5), top - 4, <text x={ax + G(3.5)} y={top - 4} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'dcrail' || c.kind === 'vplus' || c.kind === 'vminus') {
    // supply port: label + battery (supply) badge; single clean connection point at the pin.
    // The M2K's V+/V− are FIXED rails referenced to the shared board ground (not floating), so
    // draw that reference explicitly on the badge's reference pole (opposite the output pin):
    // the SAME catalog ground glyph W1/W2 use on their return, flipped 180° so its bars point up,
    // away from the badge. Render-only — the rail keeps its single output pin and its sim path.
    const x = ax, y = ay
    const v = c.value ?? (c.kind === 'vminus' ? -5 : 5)
    const neg = c.kind === 'vminus' || v < 0
    const col = selected ? 'var(--accent-blue)' : neg ? '#2a6ad0' : '#c22a2a' // V- blue, V+ red
    const lbl = c.kind === 'vplus' ? 'V+' : c.kind === 'vminus' ? 'V-' : (v >= 0 ? '+' : '') + v + 'V'
    const gsym = SYMBOL_CATALOG['ground']
    const conn = y - 35 // reference-pole connection point, just above the badge top (~y-32)
    let refGround: ReactElement | null = null
    if (gsym) {
      const gm = alignTransform([{ x: gsym.pins[0].x, y: gsym.pins[0].y }], [{ x, y: conn }])
      // flip 180° about the connection point so the ground bars face up, clear of the badge
      const fm = [-gm[0], -gm[1], -gm[2], -gm[3], 2 * x - gm[4], 2 * conn - gm[5]]
      refGround = (
        <g transform={`matrix(${fm.map((n) => +n.toFixed(5)).join(' ')})`}
          dangerouslySetInnerHTML={{ __html: inkedInner('ground', gsym, matScale(gm)) }} />
      )
    }
    inner = (
      <g style={{ color: col }}>
        {refGround}
        <line x1={x} y1={y - 31} x2={x} y2={conn} stroke="currentColor" strokeWidth={sw} />
        {badgeArt(c.id, 'battery', x, y - 22)}
        {upright(x - 13, y - 19, <text x={x - 13} y={y - 19} fill={col} fontSize={10} textAnchor="end">{lbl}</text>)}
      </g>
    )
  } else {
    const x = ax, y = ay
    inner = (
      <g>
        <polygon points={`${x},${y - 9} ${x + 8},${y} ${x},${y + 9} ${x - 8},${y}`} fill="none" stroke="var(--theory-color)" strokeWidth={sw} />
        {upright(x, y - 12, <text x={x} y={y - 12} fill="var(--theory-color)" fontSize={9} textAnchor="middle">OUT</text>)}
      </g>
    )
  }
  // Passive id/value labels live OUTSIDE the rotation, positioned from the part's actual (rotated)
  // terminals: a horizontal part keeps id above / value below, a vertical one stacks both to its
  // right. Inside the rotated group the value label swings around with the body and collides with
  // the neighbouring part's label — which is what made the RC low-pass unreadable.
  const outerLabels: ReactElement[] = []
  if (c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor') {
    const ts = terminalsOf(c)
    const p0 = { x: px(ts[0].gx), y: px(ts[0].gy) }, p1 = { x: px(ts[1].gx), y: px(ts[1].gy) }
    const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2
    const val = `${fmtEng(c.value ?? 0)}${UNIT[c.kind] ?? ''}`
    const idFill = selected ? 'var(--accent-blue)' : 'var(--text-secondary)'
    if (p0.x === p1.x) { // vertical: stack both labels clear of the body, to its right
      outerLabels.push(
        <text key="id" x={mx + 15} y={my - 4} fill={idFill} fontSize={10} textAnchor="start">{c.id}</text>,
        <text key="val" x={mx + 15} y={my + 11} fill="var(--text-primary)" fontSize={9} textAnchor="start">{val}</text>,
      )
    } else { // horizontal: id above, value below (unchanged)
      outerLabels.push(
        <text key="id" x={mx} y={my - 15} fill={idFill} fontSize={10} textAnchor="middle">{c.id}</text>,
        <text key="val" x={mx} y={my + 20} fill="var(--text-primary)" fontSize={9} textAnchor="middle">{val}</text>,
      )
    }
  }
  return (
    <g>
      <g transform={`rotate(${rot} ${ax} ${ay})`}>{inner}</g>
      {outerLabels}
    </g>
  )
}
