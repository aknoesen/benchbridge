// Breadboard layout (Track F, phase F-2) — transfer a schematic to a solderless board and verify
// it. Place the schematic's R/C/L parts and M2K ports by clicking holes, run jumpers, then Check
// that the board is electrically the drawn circuit. Practice colours each node live; Bench hides
// the nodes until Check. See docs/specs/breadboard.md.
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type CSSProperties, type ReactNode } from 'react'
import {
  buildHoles, boardNets, boardWidth, boardHeight, PAD, PITCH, CHANNEL_SLOT,
  schematicExpectation, checkEquivalence, boardNodeMap, autoRouteJumpers, type AutoJumper,
  type BoardLayout, type CheckResult, type PlacedPart, type PlacedDip, type PlacedTransistor,
  normalizeBoardOrder, nextBoardSeq,
  MIN_RESISTOR_HOLES, parseHoleKey, shiftHole, canDropPart, canDropDip, canDropTransistor,
  movePart, moveDip, moveTransistor,
  dipPinHoles, dipCols, holeKey, DIP_TOP_ROW, DIP_BOT_ROW, DIP_DEFS, type DipPkg,
  to92PinHoles, to92Legend, TO92_ROW,
  TERMINALS, type Terminal, POWER_WIRES, PORT_TERMINAL, unboardable,
} from '../core/breadboard'
import { type Schematic, type SchKind } from '../core/schematic'
import { type SignalParams } from '../core/signal'
import { resistorBands, ledColor, ledBrightness, jumperArc } from '../core/partvisuals'
import { exportSvgToPng } from './exportImage'
import './Instrument.css'

type Mode = 'practice' | 'bench'
// F-7/ARB-3: the inter-column jumper-routing state. `manual` = today's behaviour, `hint` = a
// non-committing "show a valid wiring" overlay, `auto` = generated read-only jumpers. The value is
// App-owned (the `boardRouting` key of the uiSettings toggle object) and arrives as a prop.
export type BoardRouting = 'manual' | 'hint' | 'auto'
type Tool =
  | { kind: 'select' }
  | { kind: 'jumper' }
  | { kind: 'placePart'; id: string; partKind: SchKind }
  | { kind: 'placeDip'; id: string; partKind: DipPkg }
  | { kind: 'placeTransistor'; id: string; partKind: SchKind }

const NET_COLORS = ['#f0a030', '#40c0e0', '#44dd88', '#e06fd0', '#d0d040', '#7a8cff', '#ff8855', '#55ddcc']
// A ¼ W axial resistor's body is ~0.25"; with its leads bent down it spans about 5 holes (0.5") and
// can be crammed to ~4 holes at the tightest. Enforce that floor so legs can't sit unrealistically
// close (e.g. adjacent holes). Pitch is 0.1" per hole.
// DIP pin functions / names / rail pins now live in core (DIP_DEFS, keyed by DipPkg) so the board
// render and the equivalence check share one source of truth (F-4).
// TO-92 discrete transistors (SCH-8). Leg order matches to92Legend / the schematic terminal order.
const TR_NAME: Record<string, string> = { bjt: 'BJT', mosfet: 'MOSFET' }

// ── ARB-4: Fritzing-look tuning constants (art direction — adjust these, not the markup) ─────────
// Substrate
const BOARD_CREAM_TOP = '#f3ecd8'   // cream board gradient, top edge …
const BOARD_CREAM_BOT = '#e4d8b8'   // … to bottom edge
const BOARD_BEVEL_TOP = '#fbf6e8'   // 1 px light bevel along the board's top edge
const BOARD_BEVEL_BOT = '#cfc098'   // 1 px darker edge along the bottom
const BOARD_BORDER = '#b7a87e'      // board outline stroke
const BENCH_FILL = '#17181b'        // dark bench bezel behind the cream board (kills the theme seam)
const BENCH_EDGE = '#2c2d31'
const GROOVE_TOP = '#a99a72'        // recessed centre channel: shadowed top lip …
const GROOVE_BOT = '#e8ddbe'        // … down to the lit bottom lip
const EDGE_INK = '#9c8f6b'          // faint moulded a–j / column-number legend
// Sockets
const SOCKET_SIZE = 5.2             // metal-clip socket square, px
const SOCKET_RECESS = 8.6           // moulded recess square around each socket, px
const RECESS_FILL = 'rgba(0,0,0,0.08)'
const HOVER_RING = '#1b1b1f'        // hover = dark ring (a white fill is invisible on cream)
const PENDING_RING = '#2f6fd4'      // first-click marker while placing a jumper/part
// Rails on cream
const RAIL_RED = '#d24a3a'
const RAIL_BLUE = '#3b6fb0'
const RAIL_GND = '#3d4046'
const RAIL_UNWIRED = '#8a7f5f'
// Parts
const LABEL_INK = '#4a4136'         // part/pin labels sitting on the cream substrate
const SHADOW_DY = 1.5               // drop shadow: vertical offset …
const SHADOW_BLUR = 1.2             // … blur (feGaussianBlur stdDeviation via feDropShadow) …
const SHADOW_OPACITY = 0.33         // … and strength (#00000055 ≈ 0.33)
// Jumpers
const WIRE_BOW_MIN = 6              // arc bow (px) for the shortest jumpers …
const WIRE_BOW_MAX = 14             // … clamped here for the longest …
const WIRE_BOW_FRAC = 0.1           // … plus this fraction of the span length
const WIRE_W = 3.4                  // insulation casing width
const WIRE_SHADOW = 'rgba(0,0,0,0.30)'
const WIRE_GLOSS = 'rgba(255,255,255,0.35)'

// The single <defs> block every ARB-4 gradient/filter lives in. IDs carry an `arb4-` prefix so they
// can't collide with other inline SVGs in the app; the PNG export clones defs along with the board,
// so exported figures stay self-contained.
function BoardDefs(): ReactNode {
  const grad = (id: string, stops: [number, string, number?][], x2 = 0, y2 = 1) => (
    <linearGradient id={id} x1={0} y1={0} x2={x2} y2={y2}>
      {stops.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />)}
    </linearGradient>
  )
  return (
    <defs>
      {grad('arb4-board', [[0, BOARD_CREAM_TOP], [1, BOARD_CREAM_BOT]])}
      {grad('arb4-groove', [[0, GROOVE_TOP], [0.22, '#c9bb94'], [0.7, '#cfc198'], [1, GROOVE_BOT]])}
      {grad('arb4-strip', [[0, '#143c63'], [1, '#0a2138']])}
      {/* the metal clip inside each socket: dark toward the top-left = a moulded inner shadow */}
      <linearGradient id="arb4-socket" x1={0} y1={0} x2={1} y2={1}>
        <stop offset={0} stopColor="#232327" /><stop offset={0.55} stopColor="#3a3a3e" /><stop offset={1} stopColor="#4b4b52" />
      </linearGradient>
      {/* metallic leads: shading across a horizontal lead, and the transpose for vertical DIP/TO-92 legs */}
      {grad('arb4-lead', [[0, '#8f939a'], [0.4, '#d7dade'], [1, '#75787e']])}
      {grad('arb4-leg', [[0, '#9a9ea6'], [0.5, '#d7dade'], [1, '#84888f']], 1, 0)}
      {/* one glossy-cylinder sheen overlaid on every tube body (it shades the resistor bands too) */}
      {grad('arb4-sheen', [[0, '#000000', 0.2], [0.18, '#ffffff', 0.38], [0.45, '#ffffff', 0.06], [1, '#000000', 0.26]])}
      {grad('arb4-resistor', [[0, '#c9b587'], [0.28, '#f0e2bc'], [0.6, '#e3d4a9'], [1, '#c9b587']])}
      {grad('arb4-ecap', [[0, '#2e3b60'], [0.3, '#5c6fa3'], [1, '#1a2440']])}
      {grad('arb4-diode', [[0, '#3f3f47'], [0.3, '#565660'], [1, '#141419']])}
      {grad('arb4-inductor', [[0, '#6b5540'], [0.3, '#83694c'], [1, '#3a2c1e']])}
      {grad('arb4-dip', [[0, '#2a2a2e'], [0.55, '#1b1b1f'], [1, '#0c0c0e']])}
      {grad('arb4-to92', [[0, '#3a3a40'], [0.4, '#26262b'], [1, '#121215']])}
      <radialGradient id="arb4-ceramic" cx={0.4} cy={0.35} r={0.75}>
        <stop offset={0} stopColor="#f2d98f" /><stop offset={0.65} stopColor="#e6c25c" /><stop offset={1} stopColor="#b08a32" />
      </radialGradient>
      {/* colour-agnostic domed-lens overlay: white specular falloff into a darkened rim */}
      <radialGradient id="arb4-dome" cx={0.38} cy={0.32} r={0.85}>
        <stop offset={0} stopColor="#ffffff" stopOpacity={0.7} />
        <stop offset={0.4} stopColor="#ffffff" stopOpacity={0.15} />
        <stop offset={0.78} stopColor="#ffffff" stopOpacity={0} />
        <stop offset={1} stopColor="#000000" stopOpacity={0.28} />
      </radialGradient>
      {/* the one soft drop shadow every part body shares */}
      <filter id="arb4-shadow" x="-40%" y="-40%" width="180%" height="220%">
        <feDropShadow dx={0} dy={SHADOW_DY} stdDeviation={SHADOW_BLUR} floodColor="#000000" floodOpacity={SHADOW_OPACITY} />
      </filter>
    </defs>
  )
}

// ── ARB-4: one insulated jumper in the Fritzing style — a gentle arc lifting off the board, drawn
// as shadow arc + coloured casing + gloss highlight, ending in plated cups at the sockets. The
// F-7 semantics survive unchanged: `dashedCore` is the auto-mode "machine-generated, read-only"
// cue (the old dashed centre line), and colour still comes from wireColor / the power convention.
function JumperWire({ ax, ay, bx, by, color, dashedCore }: {
  ax: number; ay: number; bx: number; by: number; color: string; dashedCore?: boolean
}): ReactNode {
  const arc = jumperArc(ax, ay, bx, by, WIRE_BOW_MIN, WIRE_BOW_MAX, WIRE_BOW_FRAC)
  return (
    <>
      <path d={arc.d} fill="none" stroke={WIRE_SHADOW} strokeWidth={WIRE_W + 1.4} strokeLinecap="round"
        transform={`translate(0 ${SHADOW_DY + 0.7})`} />
      <path d={arc.d} fill="none" stroke={color} strokeWidth={WIRE_W} strokeLinecap="round" />
      {dashedCore
        ? <path d={arc.d} fill="none" stroke="#ffffff" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 5" strokeLinecap="round" />
        : <path d={arc.d} fill="none" stroke={WIRE_GLOSS} strokeWidth={1} strokeLinecap="round" transform="translate(0 -0.7)" />}
      {/* plated cups: the two points the wire actually connects */}
      {([[ax, ay], [bx, by]] as const).map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={4.4} fill={color} stroke="#101013" strokeWidth={1} />
          <circle cx={x} cy={y} r={1.6} fill="#000000" opacity={0.35} />
        </g>
      ))}
    </>
  )
}

// ── ARB-1/ARB-4: realistic 2-pin part bodies (kit-scoped, rendering only) ────────────────────────
// A realistic body for a placed 2-pin part, drawn along the a→b axis (leads bent to the holes). Pure
// SVG; no model/Check involvement. Cathode-side features (diode band, LED flat) sit toward b.
// ARB-4 gives every body a cylindrical gradient + the shared drop shadow and metallic leads; the
// `glow` prop (ARB-2: LED emission 0..1 from the live sim via ledBrightness) is preserved exactly —
// the halo circles keep their radii/opacity and now layer UNDER the shaded lens.
function PartBody({ kind, value, ax, ay, bx, by, glow }: { kind: SchKind; value?: number; ax: number; ay: number; bx: number; by: number; glow?: number }): ReactNode {
  const mx = (ax + bx) / 2, my = (ay + by) / 2
  const len = Math.hypot(bx - ax, by - ay) || 1
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
  // PL-1: a real part's BODY is a fixed size — only the leads stretch. Scaling the body-edge (±h)
  // with the span left gaps between the leads and the fixed-size bodies (LED dome, ceramic disc) at
  // wide placements. Fixed half-width per kind; clamped down only when the holes are very close.
  const FIXED_HALF: Partial<Record<SchKind, number>> = {
    resistor: 16, capacitor: 12, inductor: 14, diode: 12, zener: 12, led: 9, photodiode: 9,
  }
  const h = Math.min(FIXED_HALF[kind] ?? 12, Math.max(6, len / 2 - 3))
  // Metallic leads: thin rects (not lines) so the cross-axis gradient shades them round; they tuck
  // 1.5 px under the body so the joint never shows.
  const LW = 1.7
  const lead = (
    <>
      <rect x={-len / 2} y={-LW / 2} width={len / 2 - h + 1.5} height={LW} rx={LW / 2} fill="url(#arb4-lead)" />
      <rect x={h - 1.5} y={-LW / 2} width={len / 2 - h + 1.5} height={LW} rx={LW / 2} fill="url(#arb4-lead)" />
    </>
  )
  let body: ReactNode
  let halo: ReactNode = null // LED glow, drawn under the shadowed body (never inside the filter)
  if (kind === 'resistor') {
    const bands = resistorBands(value ?? 0), bh = 13
    body = (
      <>
        <rect x={-h} y={-bh / 2} width={2 * h} height={bh} rx={bh / 2} fill="url(#arb4-resistor)" stroke="#a89468" strokeWidth={0.8} />
        {bands.map((c, i) => <rect key={i} x={-h * 0.55 + i * (h * 0.42)} y={-bh / 2 + 0.7} width={2.6} height={bh - 1.4} fill={c} />)}
        <rect x={-h} y={-bh / 2} width={2 * h} height={bh} rx={bh / 2} fill="url(#arb4-sheen)" />
      </>
    )
  } else if (kind === 'capacitor') {
    body = (value ?? 0) >= 1e-6 ? (
      <>
        <rect x={-h} y={-9} width={2 * h} height={18} rx={4} fill="url(#arb4-ecap)" stroke="#16223f" strokeWidth={0.8} />
        <ellipse cx={h - 2.2} cy={0} rx={2.2} ry={8.2} fill="#55689e" />{/* lit can end */}
        <rect x={-h} y={-9} width={4} height={18} fill="#cdd6ea" />{/* polarity stripe (electrolytic) */}
        <text x={-h + 2} y={2.8} fontSize={7} fontWeight={800} fill="#1a2440" textAnchor="middle">−</text>
        <rect x={-h} y={-9} width={2 * h} height={18} rx={4} fill="url(#arb4-sheen)" />
      </>
    ) : (
      <ellipse cx={0} cy={0} rx={Math.min(h, 11)} ry={9} fill="url(#arb4-ceramic)" stroke="#a8892e" strokeWidth={0.8} />
    )
  } else if (kind === 'diode' || kind === 'zener') {
    body = (
      <>
        <rect x={-h} y={-6.5} width={2 * h} height={13} rx={2.5} fill="url(#arb4-diode)" stroke="#101014" strokeWidth={0.8} />
        <rect x={h - 4} y={-6.5} width={2.6} height={13} fill="#e6e6ea" />{/* cathode band, toward b */}
        <rect x={-h} y={-6.5} width={2 * h} height={13} rx={2.5} fill="url(#arb4-sheen)" />
      </>
    )
  } else if (kind === 'led') {
    // Live glow: an unlit LED is a dull dome; forward current adds a soft halo + brightens the lens.
    // The two halo circles are ARB-2 verbatim — do not retune them here.
    const g = Math.max(0, Math.min(1, glow ?? 0))
    const col = ledColor(value)
    halo = (
      <>
        {g > 0 && <circle cx={0} cy={0} r={9 + 12 * g} fill={col} opacity={0.28 * g} />}
        {g > 0 && <circle cx={0} cy={0} r={9 + 5 * g} fill={col} opacity={0.45 * g} />}
      </>
    )
    body = (
      <>
        <circle cx={0} cy={0} r={10.4} fill={col} fillOpacity={0.22} stroke="#00000033" strokeWidth={0.8} />{/* base flange */}
        <circle cx={0} cy={0} r={9} fill={col} fillOpacity={0.55 + 0.45 * g} stroke="#00000055" strokeWidth={1} />
        <circle cx={0} cy={0} r={9} fill="url(#arb4-dome)" />{/* translucent dome shading */}
        <circle cx={-2.5} cy={-2.5} r={2.5} fill="#ffffff" fillOpacity={0.45 + 0.45 * g} />
      </>
    )
  } else if (kind === 'photodiode') {
    body = (
      <>
        <circle cx={0} cy={0} r={10.2} fill="#bcd6ec" fillOpacity={0.3} stroke="#00000022" strokeWidth={0.8} />
        <circle cx={0} cy={0} r={9} fill="#bcd6ec" fillOpacity={0.75} stroke="#7fa8c9" strokeWidth={1} />
        <circle cx={0} cy={0} r={9} fill="url(#arb4-dome)" />
        <circle cx={-2.5} cy={-2.5} r={2.5} fill="#ffffff" fillOpacity={0.55} />
      </>
    )
  } else if (kind === 'inductor') {
    body = (
      <>
        <rect x={-h} y={-6} width={2 * h} height={12} rx={6} fill="url(#arb4-inductor)" stroke="#3a2c1e" strokeWidth={0.8} />
        <rect x={-h} y={-6} width={2 * h} height={12} rx={6} fill="url(#arb4-sheen)" />
      </>
    )
  } else {
    body = (
      <>
        <rect x={-h} y={-6} width={2 * h} height={12} rx={3} fill="#1b1b1f" stroke="#888" strokeWidth={1} />
        <rect x={-h} y={-6} width={2 * h} height={12} rx={3} fill="url(#arb4-sheen)" />
      </>
    )
  }
  return (
    <g transform={`translate(${mx} ${my}) rotate(${angle})`}>
      {halo}
      <g filter="url(#arb4-shadow)">{lead}{body}</g>
    </g>
  )
}

// F-4: a parametric DIP-pinout legend driven by DIP_DEFS, so any op-amp package (8-pin single,
// 8-pin dual, 14-pin quad) renders correctly with the right name and pin functions — replacing the
// old hardcoded LMC662 SVG. Standard DIP numbering: pin 1 top-left, down the left to pin n/2, then
// pin n/2+1 bottom-right up to pin n; notch at the top. V+/V− pins are colour-coded.
function DipPinoutLegend({ pkg, name }: { pkg: DipPkg; name: string }) {
  const def = DIP_DEFS[pkg]
  const n = def.pins, half = n / 2
  const rowH = 20, bodyTop = 20, bodyX = 88, bodyW = 30
  const bodyH = half * rowH + 8
  const W = 200, H = bodyTop + bodyH + 16
  const colOf = (idx0: number) => def.rails && idx0 === def.rails.vpos ? '#e04040'
    : def.rails && idx0 === def.rails.vneg ? '#4a9eff' : '#cfcfcf'
  const rowY = (j: number) => bodyTop + 16 + j * rowH
  const cx = bodyX + bodyW / 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`${name} ${n}-pin DIP pinout`} style={{ display: 'block', width: '100%', height: Math.min(260, H), flexShrink: 0, margin: '4px 0' }}>
      <rect x={bodyX} y={bodyTop} width={bodyW} height={bodyH} rx={4} fill="#1b1b1f" stroke="#888" strokeWidth={1.5} />
      <path d={`M ${cx - 7} ${bodyTop} a 7 7 0 0 0 14 0`} fill="#0c0d0f" stroke="#888" strokeWidth={1.5} />
      <text x={cx} y={bodyTop + bodyH / 2 + 3} fontSize={8} fill="#9aa0a6" textAnchor="middle"
        transform={`rotate(90 ${cx} ${bodyTop + bodyH / 2})`}>{name}</text>
      {Array.from({ length: half }, (_, j) => {
        const pL = j + 1, pR = n - j, y = rowY(j)            // left top→bottom 1..half; right top→bottom n..half+1
        return (
          <g key={j}>
            <line x1={bodyX - 10} y1={y} x2={bodyX} y2={y} stroke="#888" strokeWidth={1.5} />
            <text x={bodyX - 4} y={y - 2} fontSize={8} fontWeight={800} fill={colOf(pL - 1)} textAnchor="end">{pL}</text>
            <text x={bodyX - 14} y={y + 3} fontSize={8} fill="var(--text-secondary)" textAnchor="end">{def.fn[pL - 1]}</text>
            <line x1={bodyX + bodyW} y1={y} x2={bodyX + bodyW + 10} y2={y} stroke="#888" strokeWidth={1.5} />
            <text x={bodyX + bodyW + 4} y={y - 2} fontSize={8} fontWeight={800} fill={colOf(pR - 1)} textAnchor="start">{pR}</text>
            <text x={bodyX + bodyW + 14} y={y + 3} fontSize={8} fill="var(--text-secondary)" textAnchor="start">{def.fn[pR - 1]}</text>
          </g>
        )
      })}
    </svg>
  )
}

interface Props {
  schematic: Schematic
  setSchematic: Dispatch<SetStateAction<Schematic>>
  board: BoardLayout
  setBoard: Dispatch<SetStateAction<BoardLayout>>
  // Generator settings (W1/W2) travel inside a saved lab so a loaded circuit runs at the right
  // input level — e.g. a gain-10 amp wants a ~0.3 V input, not the 1 V default that clips.
  generators?: { w1: SignalParams; w2: SignalParams }
  onLoadGenerators?: (w1: SignalParams, w2: SignalParams) => void
  // Push the current schematic onto the shared undo history before a lab Open replaces it.
  snapshotSchematic?: () => void
  // ARB-2 active board: the circuit loop's live sim state. liveNodeVolts = settled DC voltage per
  // circuit node (what a DMM reads); liveLedCurrents = average forward current per schematic LED id.
  // Null/omitted (no valid drawn circuit) → the board renders passively, exactly as before.
  liveNodeVolts?: Map<string, number> | null
  liveLedCurrents?: Map<string, number> | null
  // F-7/ARB-3: jumper-routing state + setter (App-owned setting; default manual = today's behaviour).
  routing?: BoardRouting
  onRoutingChange?: (r: BoardRouting) => void
}

export default function Breadboard({ schematic, setSchematic, board, setBoard, generators, onLoadGenerators, snapshotSchematic, liveNodeVolts, liveLedCurrents, routing = 'manual', onRoutingChange }: Props) {
  const holes = useMemo(() => buildHoles(), [])
  const holeByKey = useMemo(() => new Map(holes.map((h) => [h.key, h])), [holes])
  const exp = useMemo(() => schematicExpectation(schematic), [schematic])
  // F-7/ARB-3: the generated wiring. `hint` overlays it on demand; `auto` applies it read-only.
  const autoJumpers = useMemo<AutoJumper[]>(
    () => (routing === 'manual' ? [] : autoRouteJumpers(schematic, board, holes)),
    [routing, schematic, board, holes],
  )
  // The wiring in effect: the student's own jumpers, or the generated set under `auto`. Everything
  // downstream (nets, colouring, the probe map, Check) reads this, so `auto` behaves like a fully
  // wired board while board.jumpers itself is never touched (switching back restores manual work).
  const effJumpers = routing === 'auto' ? autoJumpers : board.jumpers
  const effBoard = useMemo<BoardLayout>(
    () => (routing === 'auto' ? { ...board, jumpers: autoJumpers } : board),
    [routing, board, autoJumpers],
  )
  const nets = useMemo(() => boardNets(holes, effJumpers), [holes, effJumpers])
  // ARB-2: board-net → circuit-node bridge, so a hovered pin can look up its live sim voltage.
  const nodeMap = useMemo(() => boardNodeMap(schematic, effBoard, holes), [schematic, effBoard, holes])

  const [mode, setMode] = useState<Mode>('practice')
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [pending, setPending] = useState<string | null>(null)
  const [hoverNet, setHoverNet] = useState<string | null>(null)
  // ARB-2 hover probe: the hovered pin's key (hole or terminal), tracked in BOTH modes — probing a
  // voltage mirrors the real bench DMM and reveals no wiring answers (net colouring stays
  // practice-only via hoverNet). Readout renders only when the live sim has a value for its node.
  const [probeKey, setProbeKey] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null) // for the jumper rubber-band
  // ARB-2b MOVE: an in-progress component drag (Select tool, pointer-down on a part body). Below
  // the click threshold pointer-up is a plain click (delete, as today); past it the part is "in
  // hand" and pointer-up commits or snaps back. dSlots/dCols is the current whole-hole translation.
  const [drag, setDrag] = useState<null | {
    type: 'part' | 'dip' | 'tr'; id: string
    startX: number; startY: number
    dSlots: number; dCols: number
    moved: boolean
  }>(null)
  const justDraggedRef = useRef(false)
  // F-7 hint mode: whether the "one valid wiring" ghost overlay is revealed. Never writes to
  // board.jumpers and never touches the student's Check — it is a reference to reproduce.
  const [showHint, setShowHint] = useState(false)
  useEffect(() => { if (routing !== 'hint') setShowHint(false) }, [routing])
  // Entering `auto` retires the Jumper tool: routing is generated, manual jumper drawing is off.
  useEffect(() => {
    if (routing === 'auto') { setTool((t) => (t.kind === 'jumper' ? { kind: 'select' } : t)); setPending(null) }
  }, [routing])

  // ARB-2: the hovered pin's live DC voltage — board net → circuit node → settled sim value.
  // Null when there's no live sim, the pin is unwired, or its net is ambiguous (boardNodeMap drops
  // mis-wired nets, so a shorted column shows no reading rather than a wrong one).
  const probeVolts = useMemo(() => {
    if (!probeKey || !liveNodeVolts) return null
    const bnet = nets.get(probeKey)
    if (!bnet) return null
    const node = nodeMap.get(bnet)
    if (node === undefined) return null
    return liveNodeVolts.get(node) ?? null
  }, [probeKey, liveNodeVolts, nets, nodeMap])

  const W = boardWidth(), H = boardHeight()
  const STRIP = 48                 // height of each fixed M2K terminal strip
  const OY = STRIP                 // board content shifts down to leave room for the top strip
  const H2 = STRIP + H + STRIP     // total SVG height (top strip + board + bottom strip)
  const RM = 42                    // right margin so the rail labels (GND/V+/V−) are not clipped
  const W2 = W + RM                // total SVG width
  const railY = (slot: number) => PAD + slot * PITCH + OY
  const termByKey = useMemo(() => new Map(TERMINALS.map((t) => [t.key, t])), [])
  const termX = (t: Terminal) => PAD + (t.col - 1) * PITCH
  const termY = (t: Terminal) => (t.side === 'top' ? STRIP - 18 : OY + H + 18)
  const TERM_COLOR: Record<string, string> = { pos: '#e04040', neg: '#4a9eff', gnd: '#c9cdd2', signal: '#8fb3cf' }
  // Absolute SVG position of any node key — a board hole or a fixed M2K terminal.
  const pos = (key: string) => {
    const h = holeByKey.get(key)
    if (h) return { x: h.x, y: h.y + OY }
    const t = termByKey.get(key)!
    return { x: termX(t), y: termY(t) }
  }

  // Colour the nodes the student has actually wired (any net with a leg / port / jumper).
  const activeColor = useMemo(() => {
    const used = new Set<string>()
    for (const p of board.parts) { used.add(nets.get(p.aHole)!); used.add(nets.get(p.bHole)!) }
    for (const j of effJumpers) { used.add(nets.get(j.a)!); used.add(nets.get(j.b)!) }
    for (const d of (board.dips ?? [])) for (const k of (dipPinHoles(d.kind, d.col) ?? [])) used.add(nets.get(k)!)
    for (const t of (board.transistors ?? [])) for (const k of (to92PinHoles(t.col, t.row) ?? [])) used.add(nets.get(k)!)
    const m = new Map<string, string>()
    let i = 0
    for (const n of used) { if (n) { m.set(n, NET_COLORS[i % NET_COLORS.length]); i++ } }
    return m
  }, [board, effJumpers, nets])

  const showNets = mode === 'practice' || revealed
  // Wire colouring follows the power convention: a jumper touching a terminal, OR sitting on the
  // V+/V−/GND net (e.g. one daisy-chained off the rail), takes that supply's colour. Any other
  // hole-to-hole jumper keeps its node colour.
  const wireColor = (ak: string, bk: string) => {
    const t = termByKey.get(ak) ?? termByKey.get(bk)
    if (t) return TERM_COLOR[t.color]
    const sup = supplyOf(ak) ?? supplyOf(bk)
    if (sup) return SUPPLY_LINE[sup]
    const jnet = nets.get(ak)
    return (showNets && jnet && activeColor.get(jnet)) || '#c9cdd2'
  }
  // Which supply a node carries, by comparing its net to the V+/V−/GND terminal nets. Drives the
  // bus-rail colour-coding (a rail is whatever it is wired to — by default V+, V−, or GND).
  const supplyOf = (key: string): 'pos' | 'neg' | 'gnd' | null => {
    const net = nets.get(key)
    if (!net) return null
    if (net === nets.get(PORT_TERMINAL['V+'])) return 'pos'
    if (net === nets.get(PORT_TERMINAL['V-'])) return 'neg'
    if (net === nets.get(PORT_TERMINAL['GND'])) return 'gnd'
    return null
  }
  // ARB-4: same semantics as always (pos = red, neg = blue, gnd = neutral), values re-tuned to
  // read on the cream board — rail lines/wires go saturated-dark, hole markers become recess tints.
  const SUPPLY_LINE: Record<string, string> = { pos: RAIL_RED, neg: RAIL_BLUE, gnd: RAIL_GND }
  const SUPPLY_HOLE: Record<string, string> = { pos: 'rgba(210,74,58,0.16)', neg: 'rgba(59,111,176,0.16)', gnd: 'rgba(0,0,0,0.12)' }
  const placedPart = new Map(board.parts.map((p) => [p.id, p]))
  const placedDip = new Map((board.dips ?? []).map((d) => [d.id, d]))
  const placedTr = new Map((board.transistors ?? []).map((t) => [t.id, t]))
  // Components with no board footprint (op-amps/in-amps) → this circuit can't be transferred.
  const blockers = useMemo(() => unboardable(schematic), [schematic])
  const boardable = blockers.length === 0

  // Non-blocking nudge: if a + input is wired into the circuit but its − partner is left floating,
  // remind the student to tie it (GND for single-ended, the reference node for differential). The
  // real M2K inputs float, so an un-wired − reads garbage — but differential is valid, so we warn
  // rather than block.
  const floatingMinus = useMemo(() => {
    const wired = (k?: string) => !!k && effJumpers.some((j) => j.a === k || j.b === k)
    const out: string[] = []
    for (const [plus, minus, label] of [['1+', '1-', '1−'], ['2+', '2-', '2−']] as const) {
      if (wired(PORT_TERMINAL[plus]) && !wired(PORT_TERMINAL[minus]))
        out.push(`${label} input is floating — tie it to GND for a single-ended measurement, or to your reference node for a differential one.`)
    }
    return out
  }, [effJumpers])

  function onNode(key: string, isTerminal = false) {
    setCheck(null)
    if (tool.kind === 'jumper') {
      if (!pending) setPending(key)
      else { if (pending !== key) setBoard((b) => ({ ...b, jumpers: [...b.jumpers, { a: pending, b: key }] })); setPending(null) }
      return
    }
    if (isTerminal) return // fixed M2K terminals: only jumpers attach to them
    if (tool.kind === 'placePart') {
      if (!pending) { setPending(key); return }
      if (pending === key) { setPending(null); return }
      // A through-hole resistor's leads can't be crammed closer than its body allows. Keep the first
      // leg pending so the student just clicks a hole farther out.
      if (tool.partKind === 'resistor') {
        const A = pos(pending), B = pos(key)
        const span = Math.hypot(B.x - A.x, B.y - A.y) / PITCH
        if (span < MIN_RESISTOR_HOLES) {
          setCheck({ ok: false, message: `Too tight: a resistor's legs span ~5 holes (0.5"). Place them at least ${MIN_RESISTOR_HOLES} holes apart — pick a farther hole.` })
          return
        }
      }
      // Carry the schematic part's value so the board render can draw a value-correct body
      // (resistor colour bands, ceramic vs electrolytic cap). ARB-1 polish.
      const part = { id: tool.id, kind: tool.partKind, aHole: pending, bHole: key, value: schematic.components.find((c) => c.id === tool.id)?.value }
      setBoard((b) => ({ ...b, parts: [...b.parts.filter((p) => p.id !== tool.id), { ...part, seq: nextBoardSeq(b) }] }))
      setPending(null); setTool({ kind: 'select' })
      return
    }
    if (tool.kind === 'placeDip') {
      const h = holeByKey.get(key)!
      // Anchor must be the top-left pin: a hole in the channel-adjacent top row, with room to span.
      if (h.row !== DIP_TOP_ROW || !dipPinHoles(tool.partKind, h.col)) {
        setCheck({ ok: false, message: `Click a hole in row ${DIP_TOP_ROW} so the chip straddles the channel (needs ${dipCols(tool.partKind)} columns).` })
        return
      }
      const dip = { id: tool.id, kind: tool.partKind, col: h.col }
      setBoard((b) => ({ ...b, dips: [...(b.dips ?? []).filter((d) => d.id !== tool.id), { ...dip, seq: nextBoardSeq(b) }] }))
      setTool({ kind: 'select' })
      return
    }
    if (tool.kind === 'placeTransistor') {
      const h = holeByKey.get(key)!
      // Anchor is the left leg: ANY term-row hole with two more free columns to its right (each column
      // is its own net). Accept whichever term row the student clicks and place the TO-92 there.
      if (h.kind !== 'term' || !to92PinHoles(h.col, h.row)) {
        setCheck({ ok: false, message: `Click a term-row hole (left leg) with 3 free columns to its right.` })
        return
      }
      const tr = { id: tool.id, kind: tool.partKind, col: h.col, row: h.row }
      setBoard((b) => ({ ...b, transistors: [...(b.transistors ?? []).filter((t) => t.id !== tool.id), { ...tr, seq: nextBoardSeq(b) }] }))
      setTool({ kind: 'select' })
      return
    }
  }

  // Check reads the wiring in effect: under `auto` that is the generated jumper set (the spec's
  // "Check reflects the generated wiring"); under manual/hint it is the student's own jumpers.
  function runCheck() { if (!boardable) return; setCheck(checkEquivalence(schematic, effBoard, holes)); if (mode === 'bench') setRevealed(true) }

  // Pointer position in SVG coordinates (shared by the jumper rubber-band and the move drag).
  function svgPoint(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  // Track the pointer while a jumper rubber-band or an ARB-2b move drag is in progress.
  function onSvgMove(e: React.MouseEvent<SVGSVGElement>) {
    const p = svgPoint(e)
    if (!p) return
    if (drag) {
      // Whole-hole translation of the drag; `moved` flips once past the click threshold so a plain
      // click (delete, as today) is never mistaken for a move.
      const dCols = Math.round((p.x - drag.startX) / PITCH)
      const dSlots = Math.round((p.y - drag.startY) / PITCH)
      const moved = drag.moved || Math.hypot(p.x - drag.startX, p.y - drag.startY) > 5
      if (moved !== drag.moved || dCols !== drag.dCols || dSlots !== drag.dSlots)
        setDrag({ ...drag, dCols, dSlots, moved })
      return
    }
    if (tool.kind !== 'jumper' || !pending) { if (cursor) setCursor(null); return }
    setCursor({ x: p.x, y: p.y })
  }

  // ARB-2b: the drag's snapped target — the candidate hole set, its validity, and the committed
  // board if dropped here. Recomputed only when the pointer crosses a hole boundary.
  const dragTarget = useMemo(() => {
    if (!drag || !drag.moved || (drag.dCols === 0 && drag.dSlots === 0)) return null
    if (drag.type === 'part') {
      const p = board.parts.find((x) => x.id === drag.id); if (!p) return null
      const aHole = shiftHole(p.aHole, drag.dSlots, drag.dCols), bHole = shiftHole(p.bHole, drag.dSlots, drag.dCols)
      if (!aHole || !bHole) return { holes: [], err: 'off the board (a leg would leave the grid)', commit: null }
      return { holes: [aHole, bHole], err: canDropPart(p.kind, aHole, bHole, board, p.id), commit: () => movePart(board, p.id, aHole, bHole) }
    }
    if (drag.type === 'dip') {
      const d = (board.dips ?? []).find((x) => x.id === drag.id); if (!d) return null
      const col = d.col + drag.dCols // a DIP always straddles the channel — horizontal moves only
      return { holes: dipPinHoles(d.kind, col) ?? [], err: canDropDip(d.kind, col, board, d.id), commit: () => moveDip(board, d.id, col) }
    }
    const t = (board.transistors ?? []).find((x) => x.id === drag.id); if (!t) return null
    const col = t.col + drag.dCols
    const anchor = shiftHole(holeKey(t.row ?? TO92_ROW, t.col), drag.dSlots, 0)
    const row = anchor ? parseHoleKey(anchor)!.row : undefined
    if (drag.dSlots !== 0 && !row) return { holes: [], err: 'off the board (no terminal row there)', commit: null }
    const rr = row ?? t.row ?? TO92_ROW
    return { holes: to92PinHoles(col, rr) ?? [], err: canDropTransistor(col, rr, board, t.id), commit: () => moveTransistor(board, t.id, col, rr) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, board])

  // Commit or cancel the move on pointer-up anywhere over the board.
  function onSvgUp() {
    if (!drag) return
    if (drag.moved) {
      // The click event that follows this mouse-up must not delete the part we just dragged.
      justDraggedRef.current = true
      setTimeout(() => { justDraggedRef.current = false }, 0)
      if (dragTarget && !dragTarget.err && dragTarget.commit) {
        snapshotSchematic?.() // one undo step per committed drag (restores position + jumpers)
        setBoard(dragTarget.commit())
        setCheck(null)
      } else if (dragTarget) {
        setCheck({ ok: false, message: `Move cancelled — ${dragTarget.err}. The part snapped back.` })
      }
    }
    setDrag(null)
  }

  // F-3 save/load: a "lab" bundle holds the circuit AND its board layout in one .json, so opening
  // it restores both and Check works immediately. Mirrors the Schematic editor's Save (SCH-3):
  // native Save dialog when available, else a download fallback.
  const fileRef = useRef<HTMLInputElement>(null)
  async function saveLab() {
    // F-7 follow-up (andre 2026-07-02): a lab saved in `auto` mode bundles the generated wiring as
    // plain jumpers, so a reloaded/shared lab reproduces it and Check passes. The live board still
    // never mutates board.jumpers — the set is materialised only into the saved file.
    const savedBoard = routing === 'auto' ? { ...board, jumpers: autoJumpers.map(({ a, b }) => ({ a, b })) } : board
    const json = JSON.stringify({ kind: 'm2k-lab', version: 2, schematic, board: savedBoard, generators }, null, 2)
    const sfp = (window as unknown as {
      showSaveFilePicker?: (o: {
        suggestedName?: string
        types?: { description?: string; accept: Record<string, string[]> }[]
      }) => Promise<{ name: string; createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>
    }).showSaveFilePicker
    if (typeof sfp === 'function') {
      try {
        const handle = await sfp({
          suggestedName: 'm2k-lab.json',
          types: [{ description: 'M2K lab (circuit + board)', accept: { 'application/json': ['.json'] } }],
        })
        const w = await handle.createWritable(); await w.write(json); await w.close()
        setCheck({ ok: true, message: 'saved ' + handle.name }); return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    let name = prompt('Save lab as:', 'm2k-lab.json')
    if (name === null) return
    name = name.trim() || 'm2k-lab.json'
    if (!name.toLowerCase().endsWith('.json')) name += '.json'
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
    setCheck({ ok: true, message: 'saved ' + name })
  }
  function openLab(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result))
        const s = d.schematic, b = d.board
        const isLab = s && Array.isArray(s.components) && Array.isArray(s.wires) && b && Array.isArray(b.parts) && Array.isArray(b.jumpers)
        const isCircuit = Array.isArray(d.components) && Array.isArray(d.wires)
        if (isLab) {
          snapshotSchematic?.()
          setSchematic({ components: s.components, wires: s.wires })
          // normalizeBoardOrder: labs saved before the z-order field stack as they used to (BUG-1)
          setBoard(normalizeBoardOrder({ parts: b.parts, jumpers: b.jumpers, ports: Array.isArray(b.ports) ? b.ports : [], dips: Array.isArray(b.dips) ? b.dips : [], transistors: Array.isArray(b.transistors) ? b.transistors : [] }))
          const g = d.generators
          if (g && g.w1 && g.w2 && onLoadGenerators) onLoadGenerators(g.w1, g.w2)
          setTool({ kind: 'select' }); setPending(null)
          setCheck({ ok: true, message: 'loaded ' + f.name })
        } else if (isCircuit) {
          // A plain circuit file: load the circuit and start the board empty so the student places it.
          snapshotSchematic?.()
          setSchematic({ components: d.components, wires: d.wires })
          setBoard({ parts: [], jumpers: [], ports: [], dips: [], transistors: [] })
          setTool({ kind: 'select' }); setPending(null)
          setCheck({ ok: true, message: `loaded circuit ${f.name} — board starts empty, place the parts` })
        } else {
          setCheck({ ok: false, message: 'not a valid circuit or lab file' })
        }
      } catch {
        setCheck({ ok: false, message: 'could not read file' })
      }
    }
    reader.readAsText(f)
    e.target.value = '' // allow re-loading the same file
  }

  // ── BUG-1 z-order: one render function per component class so the board can stack ALL placed
  // components by placement order (`seq`, last placed/moved on top) in a single sorted pass; the
  // wire layers then draw above every component. Bodies unchanged — only the layering moved. ────
  function renderPart(p: PlacedPart): ReactNode {
    const a = pos(p.aHole), b = pos(p.bHole)
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    return (
      <g key={p.id} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}
        onMouseDown={(e) => { if (tool.kind !== 'select') return; const p0 = svgPoint(e); if (!p0) return; e.preventDefault(); setDrag({ type: 'part', id: p.id, startX: p0.x, startY: p0.y, dSlots: 0, dCols: 0, moved: false }) }}
        onClick={() => { if (justDraggedRef.current) return; if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, parts: bb.parts.filter((x) => x.id !== p.id) })); setCheck(null) } }}>
        {p.kind === 'led' && liveLedCurrents?.has(p.id) && (
          <title>{`${p.id}: ${(liveLedCurrents.get(p.id)! * 1000).toFixed(2)} mA average forward current`}</title>
        )}
        <PartBody kind={p.kind} value={p.value ?? schematic.components.find((c) => c.id === p.id)?.value}
          ax={a.x} ay={a.y} bx={b.x} by={b.y}
          glow={p.kind === 'led' ? ledBrightness(liveLedCurrents?.get(p.id) ?? 0) : undefined} />
        {/* pin dots at the two holes, coloured by net when nets are shown */}
        <circle cx={a.x} cy={a.y} r={3} fill={(showNets && activeColor.get(nets.get(p.aHole)!)) || '#cfcfcf'} stroke="#000" strokeWidth={0.5} />
        <circle cx={b.x} cy={b.y} r={3} fill={(showNets && activeColor.get(nets.get(p.bHole)!)) || '#cfcfcf'} stroke="#000" strokeWidth={0.5} />
        <text x={mx} y={my + 16} fontSize={8} fill={LABEL_INK} textAnchor="middle">{p.id}</text>
      </g>
    )
  }
  function renderDip(d: PlacedDip): ReactNode {
    const pins = dipPinHoles(d.kind, d.col); if (!pins) return null
    const n = dipCols(d.kind)
    const def = DIP_DEFS[d.kind]
    // Display the real part name (from the current schematic), falling back to the package.
    const dipName = exp.dips.find((e) => e.id === d.id)?.name ?? d.name ?? def?.name ?? d.kind
    const tl = pos(holeKey(DIP_TOP_ROW, d.col)), br = pos(holeKey(DIP_BOT_ROW, d.col + n - 1))
    // ARB-4: like the real package, the moulded body sits BETWEEN the two pin rows and the
    // silver legs reach out to the sockets. Same anchor holes as always — geometry frozen.
    const bx = tl.x - 7, bw = (br.x - tl.x) + 14
    const INSET = 4.5
    const by = tl.y + INSET, bh = (br.y - tl.y) - 2 * INSET
    return (
      <g key={d.id} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}
        onMouseDown={(e) => { if (tool.kind !== 'select') return; const p0 = svgPoint(e); if (!p0) return; e.preventDefault(); setDrag({ type: 'dip', id: d.id, startX: p0.x, startY: p0.y, dSlots: 0, dCols: 0, moved: false }) }}
        onClick={() => { if (justDraggedRef.current) return; if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, dips: (bb.dips ?? []).filter((x) => x.id !== d.id) })); setCheck(null) } }}>
        {/* silver legs, one shaded trapezoid per pin seating into its socket */}
        {pins.map((k, i) => {
          const h = pos(k)
          const isBottom = i < n
          const edgeY = isBottom ? by + bh : by
          const holeY = isBottom ? h.y + 1 : h.y - 1
          return <path key={'leg' + i} d={`M ${h.x - 2.1} ${edgeY} L ${h.x + 2.1} ${edgeY} L ${h.x + 1.2} ${holeY} L ${h.x - 1.2} ${holeY} Z`}
            fill="url(#arb4-leg)" stroke="#00000044" strokeWidth={0.4} />
        })}
        {/* glossy black body with a top specular sheen */}
        <rect x={bx} y={by} width={bw} height={bh} rx={3} fill="url(#arb4-dip)" stroke="#000000" strokeWidth={0.8} filter="url(#arb4-shadow)" />
        <rect x={bx + 4} y={by + 2.5} width={bw - 8} height={3.4} rx={1.7} fill="#ffffff" opacity={0.1} />
        {/* notch on the left edge + pin-1 dimple mark the datasheet orientation */}
        <path d={`M ${bx + 5} ${by + bh / 2 - 5} a 5 5 0 0 0 0 10`} fill="#101013" stroke="#3a3a40" strokeWidth={1} />
        <circle cx={bx + 7} cy={by + bh - 5.5} r={2} fill="#0b0b0d" stroke="#404046" strokeWidth={0.6} />
        {pins.map((k, i) => {
          const h = pos(k); const net = nets.get(k)!
          const col = (showNets && activeColor.get(net)) || '#cfcfcf'
          const isBottom = i < n           // pins 1..n on the bottom row, n+1..2n on top
          const numY = isBottom ? h.y + 12 : h.y - 7
          const rails = def?.rails
          const numCol = rails && i === rails.vpos ? '#e04040' : rails && i === rails.vneg ? '#4a9eff' : '#6b6255'
          return (
            <g key={i}>
              <circle cx={h.x} cy={h.y} r={3.2} fill={col} stroke="#000" strokeWidth={0.5}>
                <title>{`pin ${i + 1}: ${(def?.fn ?? [])[i] ?? ''}`}</title>
              </circle>
              <text x={h.x} y={numY} fontSize={9} fontWeight={800} fill={numCol} textAnchor="middle">{i + 1}</text>
            </g>
          )
        })}
        <text x={(bx + bx + bw) / 2} y={by + bh / 2 + 3} fontSize={8} fill="#c3c6cc" textAnchor="middle">{d.id} · {dipName}</text>
      </g>
    )
  }
  function renderTransistor(t: PlacedTransistor): ReactNode {
    const pins = to92PinHoles(t.col, t.row); if (!pins) return null
    const legs = pins.map((k) => pos(k))
    const labels = to92Legend(t.kind)
    const cx = legs[1].x
    const legTopY = legs[0].y - 13       // where the legs disappear into the body
    const bodyBot = legTopY, bodyTop = bodyBot - 24
    const halfW = (legs[2].x - legs[0].x) / 2 + 7
    return (
      <g key={t.id} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}
        onMouseDown={(e) => { if (tool.kind !== 'select') return; const p0 = svgPoint(e); if (!p0) return; e.preventDefault(); setDrag({ type: 'tr', id: t.id, startX: p0.x, startY: p0.y, dSlots: 0, dCols: 0, moved: false }) }}
        onClick={() => { if (justDraggedRef.current) return; if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, transistors: (bb.transistors ?? []).filter((x) => x.id !== t.id) })); setCheck(null) } }}>
        {/* legs: one short metallic lead from each hole up to the package face */}
        {legs.map((lp, i) => {
          const net = nets.get(pins[i])!
          const col = (showNets && activeColor.get(net)) || '#cfcfcf'
          return (
            <g key={i}>
              <rect x={lp.x - 0.85} y={legTopY} width={1.7} height={lp.y - legTopY} rx={0.85} fill="url(#arb4-leg)" />
              <circle cx={lp.x} cy={lp.y} r={3.2} fill={col} stroke="#000" strokeWidth={0.5}>
                <title>{`${t.id} ${labels[i]}`}</title>
              </circle>
              <text x={lp.x} y={lp.y + 12} fontSize={9} fontWeight={800} fill={LABEL_INK} textAnchor="middle">{labels[i]}</text>
            </g>
          )
        })}
        {/* TO-92 package: flat front (bottom edge), rounded back (top) — datasheet face order */}
        <path d={`M ${cx - halfW} ${bodyBot} L ${cx + halfW} ${bodyBot} L ${cx + halfW} ${bodyTop + 7} A ${halfW} 7 0 0 0 ${cx - halfW} ${bodyTop + 7} Z`}
          fill="url(#arb4-to92)" stroke="#0a0a0c" strokeWidth={1} filter="url(#arb4-shadow)" />
        <path d={`M ${cx - halfW + 4} ${bodyTop + 6} A ${halfW - 4} 5 0 0 1 ${cx + halfW - 4} ${bodyTop + 6}`}
          fill="none" stroke="#ffffff" strokeOpacity={0.12} strokeWidth={2} />{/* top sheen */}
        <text x={cx} y={(bodyBot + bodyTop) / 2 + 5} fontSize={8} fill="#c3c6cc" textAnchor="middle">{t.id} · {TR_NAME[t.kind] ?? t.kind}</text>
      </g>
    )
  }

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Breadboard</span>
          <div style={{ flex: 1, display: 'flex', gap: 14, alignItems: 'center', overflow: 'hidden', margin: '0 12px' }}>
            {!boardable && (
              <span title={`These parts have no breadboard footprint: ${blockers.map((b) => `${b.id} (${b.kind})`).join(', ')}`}
                style={{ fontSize: 12, color: '#ff7a7a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ⛔ Can't build on a board: {blockers.map((b) => b.id).join(', ')} ({blockers[0].kind}) has no footprint yet.
              </span>
            )}
            {boardable && check && (
              // Compact status only; the full message is in the side panel (FB-3).
              <span style={{ fontSize: 12, color: check.ok ? 'var(--theory-color)' : '#ffaa55', whiteSpace: 'nowrap' }}>
                {check.ok ? '✓ Match' : '✗ Check — see result panel →'}
              </span>
            )}
            {boardable && floatingMinus.length > 0 && (
              <span title={floatingMinus.join('  ')} style={{ fontSize: 12, color: '#ffbf00', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ⚠ {floatingMinus.length === 1 ? floatingMinus[0] : `${floatingMinus.length} − inputs floating — tie each to a node`}
              </span>
            )}
            {routing === 'auto' && (
              <span style={{ fontSize: 12, color: 'var(--theory-color)', whiteSpace: 'nowrap' }}>
                ⚙ Auto wiring — jumpers are generated (read-only)
              </span>
            )}
          </div>
          <div className="display-controls">
            <button className={`run-btn ${mode === 'practice' ? 'active' : ''}`} onClick={() => { setMode('practice'); setRevealed(false) }}>Practice</button>
            <button className={`run-btn ${mode === 'bench' ? 'active' : ''}`} onClick={() => { setMode('bench'); setRevealed(false); setHoverNet(null) }}>Bench</button>
            <button className={`run-btn ${boardable ? 'active' : ''}`} onClick={runCheck} disabled={!boardable}
              title={boardable ? 'Check board vs schematic' : 'This circuit has no breadboard footprint'} style={!boardable ? { opacity: 0.5 } : undefined}>✓ Check</button>
            <button className="run-btn" onClick={saveLab}>Save</button>
            <button className="run-btn" onClick={() => fileRef.current?.click()}>Open</button>
            {/* ARB-4: export as-is (no light-inversion pass). The board is now itself a light cream
                figure on a self-contained dark bezel; `light: true` would invert the cream to
                near-black AND strip every gradient body (exportImage drops url() fills in light
                mode, which used to be just the schematic grid). */}
            <button className="run-btn" title="Save the board layout as a PNG for your prelab"
              onClick={() => { if (svgRef.current) exportSvgToPng(svgRef.current, 'breadboard.png').catch((e) => setCheck({ ok: false, message: `Export failed: ${e.message}` })) }}>
              Export PNG
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={openLab} />
          </div>
        </div>
        <div className="plotly-display" style={{ overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 8 }}>
          <svg ref={svgRef} viewBox={`0 0 ${W2} ${H2}`} width={W2} height={H2} style={{ maxWidth: '100%', height: 'auto' }}
            onMouseMove={onSvgMove} onMouseUp={onSvgUp}
            onMouseLeave={() => { if (cursor) setCursor(null); if (drag) setDrag(null) /* leave = snap back */ }}>
            <BoardDefs />
            {/* ARB-4: the whole scene sits on a dark bench bezel, so the cream board reads as a
                thing ON the bench (not a light-theme seam) and the exported PNG is self-contained */}
            <rect x={0.75} y={0.75} width={W2 - 1.5} height={H2 - 1.5} rx={10} fill={BENCH_FILL} stroke={BENCH_EDGE} strokeWidth={1.5} />
            {/* fixed M2K adaptor-board connector strips, top & bottom (brushed navy) */}
            <rect x={2} y={2} width={W - 4} height={STRIP - 8} rx={5} fill="url(#arb4-strip)" stroke="#1d4d7a" />
            <rect x={2} y={OY + H + 6} width={W - 4} height={STRIP - 8} rx={5} fill="url(#arb4-strip)" stroke="#1d4d7a" />
            {/* board body: cream plastic with a light top bevel and a darker bottom edge */}
            <rect x={2} y={OY + 2} width={W - 4} height={H - 4} rx={10} fill="url(#arb4-board)" stroke={BOARD_BORDER} strokeWidth={1.5} />
            <line x1={9} y1={OY + 3.6} x2={W - 9} y2={OY + 3.6} stroke={BOARD_BEVEL_TOP} strokeWidth={1.2} strokeLinecap="round" />
            <line x1={9} y1={OY + H - 3.6} x2={W - 9} y2={OY + H - 3.6} stroke={BOARD_BEVEL_BOT} strokeWidth={1.2} strokeLinecap="round" />
            {/* faint moulded legend: row letters + column numbers, Fritzing-style */}
            <g pointerEvents="none" fill={EDGE_INK} fontSize={7.5}>
              {holes.filter((hh) => hh.col === 1 && hh.kind === 'term').map((hh) => (
                <g key={'rowl' + hh.row}>
                  <text x={9} y={hh.y + OY + 2.6} textAnchor="middle">{hh.row}</text>
                  <text x={W - 9} y={hh.y + OY + 2.6} textAnchor="middle">{hh.row}</text>
                </g>
              ))}
              {[1, 5, 10, 15, 20, 25, 30].map((c) => (
                <g key={'coll' + c}>
                  <text x={PAD + (c - 1) * PITCH} y={railY(2) + 2.6} textAnchor="middle">{c}</text>
                  <text x={PAD + (c - 1) * PITCH} y={railY(14) + 2.6} textAnchor="middle">{c}</text>
                </g>
              ))}
            </g>
            {([[0, 'TP'], [1, 'TN'], [15, 'BP'], [16, 'BN']] as const).map(([s, row]) => {
              const fn = supplyOf(holeKey(row, 1))
              const col = fn ? SUPPLY_LINE[fn] : RAIL_UNWIRED
              const glyph = fn === 'pos' ? '+' : fn === 'neg' ? '−' : ''
              return (
                <g key={s} pointerEvents="none">
                  <line x1={PAD - 10} y1={railY(s)} x2={W - PAD + 10} y2={railY(s)}
                    stroke={col} strokeOpacity={0.85} strokeWidth={2} />
                  {glyph && <text x={PAD - 15} y={railY(s) + 3.5} fontSize={11} fontWeight={800}
                    fill={col} textAnchor="middle">{glyph}</text>}
                </g>
              )
            })}
            {/* function label on each rail (outer = GND, top inner = V+, bottom inner = V−) */}
            {([[0, 'GND', 'gnd'], [1, 'V+', 'pos'], [15, 'V−', 'neg'], [16, 'GND', 'gnd']] as const).map(([s, lbl, c]) => (
              <text key={'rl' + s} x={W - PAD + 12} y={railY(s) + 4} fontSize={13} fontWeight={800}
                fill={TERM_COLOR[c]} textAnchor="start">{lbl}</text>
            ))}
            {/* recessed centre channel: a moulded valley (shadowed top lip, lit bottom lip) */}
            <rect x={2} y={railY(CHANNEL_SLOT) - PITCH / 2} width={W - 4} height={PITCH} fill="url(#arb4-groove)" />
            <line x1={2} y1={railY(CHANNEL_SLOT) - PITCH / 2 + 0.7} x2={W - 2} y2={railY(CHANNEL_SLOT) - PITCH / 2 + 0.7}
              stroke="#000000" strokeOpacity={0.2} strokeWidth={1.2} />
            <line x1={2} y1={railY(CHANNEL_SLOT) + PITCH / 2 - 0.7} x2={W - 2} y2={railY(CHANNEL_SLOT) + PITCH / 2 - 0.7}
              stroke="#ffffff" strokeOpacity={0.5} strokeWidth={1.2} />
            {holes.map((h) => {
              const net = nets.get(h.key)!
              const aCol = showNets ? activeColor.get(net) : undefined
              const hover = mode === 'practice' && hoverNet === net
              const railFn = (h.kind === 'railP' || h.kind === 'railN') ? supplyOf(h.key) : null
              const cy = h.y + OY
              const S = SOCKET_SIZE, RS = SOCKET_RECESS
              return (
                <g key={h.key} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => { if (mode === 'practice') setHoverNet(net); setProbeKey(h.key) }}
                  onMouseLeave={() => { setHoverNet(null); setProbeKey(null) }}
                  onClick={() => onNode(h.key)}>
                  {/* generous invisible hit target (the whole cell) so clicks don't need to be precise */}
                  <circle cx={h.x} cy={cy} r={PITCH / 2 - 1} fill="transparent" />
                  <g style={{ pointerEvents: 'none' }}>
                    {/* moulded recess, tinted toward the rail's function on the power rows */}
                    <rect x={h.x - RS / 2} y={cy - RS / 2} width={RS} height={RS} rx={2}
                      fill={railFn ? SUPPLY_HOLE[railFn] : RECESS_FILL} />
                    {/* the metal clip; Practice paints it with the net colour + a dark rim so it reads on cream */}
                    <rect x={h.x - S / 2} y={cy - S / 2} width={S} height={S} rx={1.3}
                      fill={aCol ?? 'url(#arb4-socket)'} stroke={aCol ? HOVER_RING : '#00000066'} strokeWidth={aCol ? 0.9 : 0.5} />
                    {/* hover / first-click: a dark ring + soft outer glow (white is invisible on cream) */}
                    {(hover || pending === h.key) && (
                      <>
                        <rect x={h.x - S / 2 - 3} y={cy - S / 2 - 3} width={S + 6} height={S + 6} rx={2.6} fill="none"
                          stroke={pending === h.key ? PENDING_RING : HOVER_RING} strokeWidth={1.6} />
                        <rect x={h.x - S / 2 - 5} y={cy - S / 2 - 5} width={S + 10} height={S + 10} rx={3.4} fill="none"
                          stroke={pending === h.key ? PENDING_RING : HOVER_RING} strokeOpacity={0.25} strokeWidth={2.4} />
                      </>
                    )}
                  </g>
                </g>
              )
            })}
            {/* BUG-1 z-order: all placed components render in ONE pass sorted by placement order
                (`seq` — the last-placed or last-moved item stacks on top), and every wire layer
                draws AFTER them, so a part never hides under a chip and wires never hide under
                parts. Check/nets ignore the order entirely. */}
            {([
              ...board.parts.map((p) => ({ seq: p.seq ?? 0, el: renderPart(p) })),
              ...(board.dips ?? []).map((d) => ({ seq: d.seq ?? 0, el: renderDip(d) })),
              ...(board.transistors ?? []).map((t) => ({ seq: t.seq ?? 0, el: renderTransistor(t) })),
            ] as { seq: number; el: ReactNode }[])
              .sort((x, y) => x.seq - y.seq).map((x) => x.el)}
            {/* standard power distribution — always present, coloured by terminal, not deletable */}
            {POWER_WIRES.map((w, i) => {
              const a = pos(w.a), b = pos(w.b)
              return (
                <g key={'pw' + i} style={{ pointerEvents: 'none' }}>
                  <JumperWire ax={a.x} ay={a.y} bx={b.x} by={b.y} color={TERM_COLOR[w.color]} />
                </g>
              )
            })}
            {routing !== 'auto' && board.jumpers.map((j, i) => {
              const a = pos(j.a), b = pos(j.b)
              return (
                <g key={'j' + i} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}
                  onClick={() => { if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, jumpers: bb.jumpers.filter((_, k) => k !== i) })); setCheck(null) } }}>
                  {/* arced insulated wire, coloured by its node so it matches the bus/column it joins */}
                  <JumperWire ax={a.x} ay={a.y} bx={b.x} by={b.y} color={wireColor(j.a, j.b)} />
                </g>
              )
            })}
            {/* F-7 auto mode: the generated wiring — clearly machine-made (dashed centre line) and
                read-only (no delete click); hovering shows why the jumper exists */}
            {routing === 'auto' && autoJumpers.map((j, i) => {
              const a = pos(j.a), b = pos(j.b)
              return (
                <g key={'aj' + i} style={{ cursor: 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}>
                  <title>{`auto-routed (read-only): ${j.note}`}</title>
                  <JumperWire ax={a.x} ay={a.y} bx={b.x} by={b.y} color={wireColor(j.a, j.b)} dashedCore />
                </g>
              )
            })}
            {TERMINALS.map((t) => {
              const x = termX(t), y = termY(t)
              const net = nets.get(t.key)
              const aCol = showNets && net ? activeColor.get(net) : undefined
              const c = TERM_COLOR[t.color]
              const hover = mode === 'practice' && hoverNet === net
              const labelY = t.side === 'top' ? y - 13 : y + 19
              return (
                <g key={t.key} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => { if (mode === 'practice' && net) setHoverNet(net); setProbeKey(t.key) }}
                  onMouseLeave={() => { setHoverNet(null); setProbeKey(null) }}
                  onClick={() => onNode(t.key, true)}>
                  {/* generous invisible hit target around the pad + its label */}
                  <rect x={x - 13} y={y - 16} width={26} height={32} fill="transparent" />
                  <rect x={x - 9} y={y - 9} width={18} height={18} rx={3}
                    fill={hover ? '#ffffff' : (aCol ?? '#15202c')}
                    stroke={pending === t.key ? '#fff' : c} strokeWidth={pending === t.key ? 2 : 1.5} />
                  <circle cx={x} cy={y} r={3.1} fill={c} stroke="#000" strokeWidth={0.5} />
                  <text x={x} y={labelY} fontSize={9} fontWeight={700} fill={c} textAnchor="middle">{t.name}</text>
                </g>
              )
            })}
            {/* F-7 hint mode: one valid wiring as a ghost overlay — dashed, numbered (the "why" list
                sits in the side panel), never written into board.jumpers, never part of Check */}
            {routing === 'hint' && showHint && autoJumpers.map((j, i) => {
              const a = pos(j.a), b = pos(j.b)
              // Ghosted in the same arced style as a real jumper; the badge pins to the arc's apex.
              const arc = jumperArc(a.x, a.y, b.x, b.y, WIRE_BOW_MIN, WIRE_BOW_MAX, WIRE_BOW_FRAC)
              return (
                <g key={'hj' + i} style={{ pointerEvents: 'none' }}>
                  <path d={arc.d} fill="none" stroke="var(--theory-color)" strokeOpacity={0.85} strokeWidth={2.5} strokeDasharray="6 5" strokeLinecap="round" />
                  <circle cx={a.x} cy={a.y} r={4} fill="none" stroke="var(--theory-color)" strokeWidth={1.5} />
                  <circle cx={b.x} cy={b.y} r={4} fill="none" stroke="var(--theory-color)" strokeWidth={1.5} />
                  <circle cx={arc.apexX} cy={arc.apexY} r={7} fill="#101418" stroke="var(--theory-color)" strokeWidth={1} />
                  <text x={arc.apexX} y={arc.apexY + 3} fontSize={9} fontWeight={800} fill="var(--theory-color)" textAnchor="middle">{i + 1}</text>
                </g>
              )
            })}
            {/* rubber-band: from the first jumper click to the pointer (dark underlay so it reads on cream) */}
            {tool.kind === 'jumper' && pending && cursor && (
              <g style={{ pointerEvents: 'none' }}>
                <line x1={pos(pending).x} y1={pos(pending).y} x2={cursor.x} y2={cursor.y}
                  stroke={HOVER_RING} strokeOpacity={0.4} strokeWidth={4} strokeLinecap="round" />
                <line x1={pos(pending).x} y1={pos(pending).y} x2={cursor.x} y2={cursor.y}
                  stroke={wireColor(pending, pending)} strokeOpacity={0.9} strokeWidth={2.5}
                  strokeDasharray="5 4" strokeLinecap="round" />
              </g>
            )}
            {/* ARB-2b: move-drag ghost — the snapped target holes ring green (legal) or red
                (illegal, will snap back), with a dashed outline where the body would sit */}
            {drag?.moved && dragTarget && dragTarget.holes.length > 0 && (() => {
              const ok = !dragTarget.err
              const col = ok ? 'var(--theory-color)' : '#ff5555'
              const pts = dragTarget.holes.map((k) => pos(k))
              const minX = Math.min(...pts.map((q) => q.x)), maxX = Math.max(...pts.map((q) => q.x))
              const minY = Math.min(...pts.map((q) => q.y)), maxY = Math.max(...pts.map((q) => q.y))
              return (
                <g pointerEvents="none">
                  <rect x={minX - 9} y={minY - 9} width={maxX - minX + 18} height={maxY - minY + 18} rx={5}
                    fill={col} fillOpacity={0.08} stroke={col} strokeWidth={1.5} strokeDasharray="5 4" />
                  {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={5} fill="none" stroke={col} strokeWidth={1.8} />)}
                </g>
              )
            })()}
            {/* ARB-2 hover probe: the pin's live DC voltage from the running sim (like a bench DMM) */}
            {probeKey && probeVolts !== null && (() => {
              const p = pos(probeKey)
              const label = Math.abs(probeVolts) < 1
                ? `${(probeVolts * 1000).toFixed(0)} mV`
                : `${probeVolts.toFixed(2)} V`
              const w = 20 + label.length * 6.6
              const x = p.x + 12 + w > W2 ? p.x - 12 - w : p.x + 12 // flip left near the right edge
              return (
                <g pointerEvents="none">
                  <rect x={x} y={p.y - 27} width={w} height={18} rx={4}
                    fill="#101418" stroke="var(--theory-color)" strokeWidth={1} opacity={0.95} />
                  <text x={x + w / 2} y={p.y - 14} fontSize={11} fontWeight={700}
                    fill="var(--theory-color)" textAnchor="middle">{label}</text>
                </g>
              )
            })()}
          </svg>
        </div>
      </div>

      <div className="settings-panel">
        {/* FB-3: the Check result lives here in the side panel (full, wrapping text) instead of a
            truncated header string, so it reads on a small monitor and never overlays the board. */}
        {boardable && check && (
          <div style={{
            marginBottom: 10, padding: '7px 9px', borderRadius: 4, fontSize: 11, lineHeight: 1.5,
            color: check.ok ? 'var(--theory-color)' : '#ffaa55',
            border: `1px solid ${check.ok ? 'var(--theory-color)' : '#ffaa55'}`,
            background: 'rgba(0,0,0,0.25)',
          }}>
            <b>{check.ok ? '✓ Check passed' : '✗ Check'}</b><br />
            {check.message}
          </div>
        )}
        <div className="section-title">Place from schematic</div>
        {!boardable && (
          <div style={{ fontSize: 11, color: '#ff7a7a', lineHeight: 1.5, marginBottom: 6 }}>
            This circuit can't be transferred to a breadboard: {blockers.map((b) => `${b.id} (${b.kind})`).join(', ')} {blockers.length === 1 ? 'has' : 'have'} no board footprint yet. The breadboard currently supports passive and 2-terminal parts; op-amp / in-amp boarding is still to come.
          </div>
        )}
        {exp.parts.length === 0 && exp.dips.length === 0 && exp.transistors.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Draw a circuit in the Circuit tab above.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {exp.parts.map((p) => (
              <button key={p.id} style={chip(placedPart.has(p.id), tool.kind === 'placePart' && tool.id === p.id)}
                onClick={() => { setTool({ kind: 'placePart', id: p.id, partKind: p.kind }); setPending(null); setCheck(null) }}>
                {placedPart.has(p.id) ? '✓ ' : ''}{p.id}
              </button>
            ))}
            {exp.dips.map((d) => (
              <button key={d.id} style={chip(placedDip.has(d.id), tool.kind === 'placeDip' && tool.id === d.id)}
                onClick={() => { setTool({ kind: 'placeDip', id: d.id, partKind: d.kind }); setPending(null); setCheck(null) }}>
                {placedDip.has(d.id) ? '✓ ' : ''}{d.id} (DIP)
              </button>
            ))}
            {exp.transistors.map((t) => (
              <button key={t.id} style={chip(placedTr.has(t.id), tool.kind === 'placeTransistor' && tool.id === t.id)}
                onClick={() => { setTool({ kind: 'placeTransistor', id: t.id, partKind: t.kind }); setPending(null); setCheck(null) }}>
                {placedTr.has(t.id) ? '✓ ' : ''}{t.id} (TO-92)
              </button>
            ))}
          </div>
        )}

        {(['opamp-single', 'opamp-quad', 'opamp-soic-adapter', 'lmc662'] as const)
          .filter((pkg) => exp.dips.some((d) => d.kind === pkg))
          .map((pkg) => {
            const def = DIP_DEFS[pkg]
            const a = def.amp!, r = def.rails!
            const nm = exp.dips.find((d) => d.kind === pkg)?.name ?? def.name
            return (
              <div key={pkg}>
                <div className="section-title">{nm} pinout ({def.pins}-pin DIP)</div>
                <DipPinoutLegend pkg={pkg} name={nm} />
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 2 }}>
                  Notch / pin 1 at the top — same orientation as the chip on the board. Your op-amp uses
                  <b> amplifier A</b>: +IN ({a.inP + 1}), −IN ({a.inN + 1}), OUT ({a.out + 1}); power
                  <b style={{ color: '#e04040' }}> V+</b> ({r.vpos + 1}) and
                  <b style={{ color: '#4a9eff' }}> V−</b> ({r.vneg + 1}). Other amplifiers in the package are unused.
                </div>
              </div>
            )
          })}

        {exp.dips.some((d) => d.kind === 'ina125') && (
          <>
            <div className="section-title">INA125 pinout (16-pin)</div>
            <svg viewBox="0 0 200 232" preserveAspectRatio="xMidYMid meet" role="img" aria-label="INA125 16-pin DIP pinout"
              style={{ display: 'block', width: '100%', height: 224, flexShrink: 0, margin: '2px 0' }}>
              <rect x={72} y={16} width={56} height={204} rx={4} fill="#1b1b1f" stroke="#888" strokeWidth={1.5} />
              <path d={`M ${86} 16 a 14 7 0 0 0 28 0`} fill="#0c0d0f" stroke="#888" strokeWidth={1.5} />
              {/* left column pins 1..8 (top→bottom); right column pins 16..9 */}
              {([[1, 'V+', 'pos'], [2, 'SLEEP', ''], [3, 'V−', 'neg'], [4, 'VREFOUT', ''], [5, 'IAREF', ''], [6, 'VIN−', ''], [7, 'VIN+', ''], [8, 'RG', '']] as const).map(([p, fn, c], i) => {
                const y = 38 + i * 24, col = c === 'pos' ? '#e04040' : c === 'neg' ? '#4a9eff' : '#cfcfcf'
                return (
                  <g key={p}>
                    <line x1={60} y1={y} x2={72} y2={y} stroke="#888" strokeWidth={1.5} />
                    <text x={84} y={y + 3} fontSize={9} fontWeight={700} fill={col} textAnchor="end">{p}</text>
                    <text x={56} y={y + 3} fontSize={9} fill="var(--text-secondary)" textAnchor="end">{fn}</text>
                  </g>
                )
              })}
              {([[16, 'VREF10', ''], [15, 'VREF5', ''], [14, 'VREF2.5', ''], [13, 'VREFBG', ''], [12, 'VREFCOM', ''], [11, 'Sense', ''], [10, 'VO', ''], [9, 'RG', '']] as const).map(([p, fn], i) => {
                const y = 38 + i * 24
                return (
                  <g key={p}>
                    <line x1={128} y1={y} x2={140} y2={y} stroke="#888" strokeWidth={1.5} />
                    <text x={116} y={y + 3} fontSize={9} fontWeight={700} fill="#cfcfcf" textAnchor="start">{p}</text>
                    <text x={144} y={y + 3} fontSize={9} fill="var(--text-secondary)" textAnchor="start">{fn}</text>
                  </g>
                )
              })}
            </svg>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
              <b>Signal:</b> wire <b>VIN+</b> (7), <b>VIN−</b> (6), <b>VO</b> (10), and external <b>R_G</b> across
              <b> 8–9</b> (sets gain). <b>Power:</b> <b style={{ color: '#e04040' }}>V+</b> (1) /
              <b style={{ color: '#4a9eff' }}>V−</b> (3) to the rails.
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
              <b style={{ color: 'var(--ch1-color)' }}>Required strapping</b> (the chip won't work without it):
              <b> SLEEP</b> (2)→V+, <b>VREFout</b> (4)→<b>VREF2.5</b> (14), <b>IAref</b> (5)→GND,
              <b> Sense</b> (11)→<b>VO</b> (10), <b>VREFcom</b> (12)→GND. The board <b>Check</b> enforces each one.
            </div>
          </>
        )}

        {exp.transistors.length > 0 && (
          <>
            <div className="section-title">TO-92 pinout</div>
            <svg viewBox="0 0 200 96" preserveAspectRatio="xMidYMid meet" role="img" aria-label="TO-92 transistor pinout"
              style={{ display: 'block', width: '100%', height: 92, flexShrink: 0, margin: '4px 0' }}>
              {/* package face: flat front, rounded back — same orientation as the chip on the board */}
              <path d="M 70 30 L 130 30 L 130 22 A 30 12 0 0 0 70 22 Z" fill="#1b1b1f" stroke="#888" strokeWidth={1.5} />
              {(to92Legend(exp.transistors[0].kind)).map((lbl, i) => {
                const x = 80 + i * 20
                return (
                  <g key={i}>
                    <line x1={x} y1={30} x2={x} y2={56} stroke="#9aa0a6" strokeWidth={1.5} />
                    <circle cx={x} cy={56} r={3} fill="#cfcfcf" />
                    <text x={x} y={72} fontSize={11} fontWeight={800} fill="#cfcfcf" textAnchor="middle">{lbl}</text>
                  </g>
                )
              })}
            </svg>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 2 }}>
              Legs in package-face order: <b>{to92Legend(exp.transistors[0].kind).join(' – ')}</b>
              {exp.transistors[0].kind === 'mosfet' ? ' (drain, gate, source).' : ' (collector, base, emitter).'} Click a hole to drop
              the left leg; the three legs fill adjacent columns in that order. No supply pins — a discrete transistor needs no rail wiring.
            </div>
          </>
        )}

        <div className="section-title">M2K terminals</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          The M2K connections are the fixed strips above and below the board — always there, like the
          real adaptor board. Use the <b>Jumper</b> tool to wire one into your circuit.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, marginTop: 6 }}>
          <span style={{ color: '#e04040' }}>● V+ (red)</span>
          <span style={{ color: '#4a9eff' }}>● V− (blue)</span>
          <span style={{ color: '#c9cdd2' }}>● GND</span>
          <span style={{ color: '#8fb3cf' }}>● signals (1±, 2±, W1, W2, TI)</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 6 }}>
          The power rails come pre-wired (kept that way on purpose): <b style={{ color: '#c9cdd2' }}>GND</b> on
          both outer rails, <b style={{ color: '#e04040' }}>V+</b> on the top inner rail,
          <b style={{ color: '#4a9eff' }}>V−</b> on the bottom inner rail — build from there. Jumpers from a
          terminal carry that terminal's colour.
        </div>

        {/* F-7/ARB-3: the three-state routing control. One valid wiring comes from the pure
            autoRouteJumpers engine; `hint` reveals it as a ghost, `auto` applies it read-only. */}
        <div className="section-title">Jumper wiring</div>
        <div className="wave-selector">
          <button className={routing === 'manual' ? 'active' : ''} title="You run every jumper yourself (default)"
            onClick={() => onRoutingChange?.('manual')}>Manual</button>
          <button className={routing === 'hint' ? 'active' : ''} title="Wire it yourself, with a reveal-a-valid-wiring hint"
            onClick={() => onRoutingChange?.('hint')}>Hint</button>
          <button className={routing === 'auto' ? 'active' : ''} title="Place parts only — jumpers are generated read-only"
            onClick={() => onRoutingChange?.('auto')}>Auto</button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
          {routing === 'manual'
            ? 'You place the parts and run every inter-column jumper yourself; Check verifies your wiring.'
            : routing === 'hint'
            ? 'You still wire it yourself — but you can reveal one valid wiring as a ghost overlay to compare against. It never fills in your jumpers, and Check still grades your own wiring.'
            : 'Place the parts only: the inter-column jumpers are generated for you and shown read-only. Check reflects the generated wiring. Your own jumpers are kept and come back in Manual/Hint.'}
        </div>
        {routing === 'hint' && (
          <>
            <button className={`run-btn ${showHint ? 'active' : ''}`} style={{ marginTop: 6 }}
              onClick={() => setShowHint((v) => !v)}>
              {showHint ? 'Hide the wiring hint' : 'Show a valid wiring'}
            </button>
            {showHint && (autoJumpers.length === 0 ? (
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
                Nothing to wire yet — place the parts first; the hint routes whatever is on the board.
              </div>
            ) : (
              <ol style={{ fontSize: 10, color: 'var(--theory-color)', lineHeight: 1.7, margin: '6px 0 0', paddingLeft: 18 }}>
                {autoJumpers.map((j, i) => <li key={i}>{j.note}</li>)}
              </ol>
            ))}
          </>
        )}

        <div className="section-title">Tools</div>
        <div className="wave-selector">
          <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => { setTool({ kind: 'select' }); setPending(null) }}>Select</button>
          {routing !== 'auto' && (
            <button className={tool.kind === 'jumper' ? 'active' : ''} onClick={() => { setTool({ kind: 'jumper' }); setPending(null) }}>Jumper</button>
          )}
          <button onClick={() => { setBoard({ parts: [], jumpers: [], ports: [], dips: [], transistors: [] }); setCheck(null); setPending(null) }}>Clear</button>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
          {tool.kind === 'placePart' ? `Placing ${tool.id}: click two holes for its legs.`
            : tool.kind === 'placeDip' ? `Placing ${tool.id}: click a hole in row ${DIP_TOP_ROW} (top-left pin); the chip drops across the channel.`
            : tool.kind === 'placeTransistor' ? `Placing ${tool.id}: click a hole in row ${TO92_ROW} (left leg); the TO-92's 3 legs drop into adjacent columns.`
            : tool.kind === 'jumper' ? 'Jumper: click two points — a hole or an M2K terminal — to wire them together.'
            : 'Select: click a placed part or jumper to remove it; drag a part to move it (its jumpers are removed — re-wire it).'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6 }}>
          {mode === 'practice' ? 'Practice: each node is coloured as you wire; hover a hole to highlight its node.'
            : 'Bench: nodes stay hidden until you press Check.'}
        </div>
      </div>
    </div>
  )
}

function chip(placed: boolean, active: boolean): CSSProperties {
  return {
    fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent-blue)' : placed ? 'var(--theory-color)' : 'var(--border)'}`,
    color: placed ? 'var(--theory-color)' : 'var(--text-primary)',
    background: active ? 'rgba(74,158,255,0.15)' : 'transparent',
  }
}
