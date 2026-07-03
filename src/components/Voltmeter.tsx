// Voltmeter (DMM-1) — M2K-style two-channel DC voltmeter. Runs an .op on the drawn circuit
// and reads each ADC channel: Ch1 = V(1+) - V(1-), Ch2 = V(2+) - V(2-). Single-ended when the
// '-' input is wired to ground (the default). See docs/specs/schematic-ngspice.md (WIRE-2).
import { useEffect, useRef, useState } from 'react'
import { SignalParams } from '../core/signal'
import { createSpiceEngine, SpiceEngine, hasNode, differentialVoltage } from '../core/spice'
import { buildNetlist, applyGeneratorParams, applySupplyRails, type Circuit, type SupplySettings } from '../core/netlist'
import { savePngBlob } from './exportImage'
import './Instrument.css'

interface Props {
  circuit: Circuit
  // Actual probe node names from toCircuit (ch1/ch2 with optional differential '-' nodes). Reading
  // these instead of hardcoded 'out'/'scope2' lets the voltmeter work when a probe shares a net with
  // the input (e.g. the divider's 2+ on the applied-voltage node, which keeps its 'in' name).
  probes?: { ch1?: string; ch1n?: string; ch2?: string; ch2n?: string }
  w1?: SignalParams
  w2?: SignalParams
  psu?: SupplySettings
  compact?: boolean
}

// M2K voltmeter ranges + practical resolution from EEC1 Lab 1 (±25 V → 20 mV, ±2.5 V → 2 mV).
const RANGES = [
  { label: '±25 V', res: 0.02 },
  { label: '±2.5 V', res: 0.002 },
]
const CH1_COLOR = '#f0a030'
const CH2_COLOR = '#40c0e0'

// ── One warm engine for the whole session (module-level singleton) ──────────────────────────────
// The ngspice WASM worker takes seconds to boot; the panel used to spawn it on every mount and
// dispose it on unmount, so each visit paid the full worker + 20 MB WASM startup — the
// "measuring…" latency. Created lazily on first use, then kept alive across panel switches: a .op
// on a warm engine is ~100 ms, so readings appear near-instantly on every visit after the first.
let sharedEngine: SpiceEngine | null = null
function getEngine(): SpiceEngine {
  if (!sharedEngine) sharedEngine = createSpiceEngine()
  return sharedEngine
}
// The last readings survive the panel unmounting, so a revisit shows numbers immediately while the
// warm engine refreshes them in the background.
let lastCh1: number | null = null
let lastCh2: number | null = null

export default function Voltmeter({ circuit, probes, w1, w2, psu, compact }: Props) {
  const [range, setRange] = useState(0)
  // Seed from the module-level cache: a revisit shows the previous numbers instantly.
  const [ch1, setCh1] = useState<number | null>(lastCh1)
  const [ch2, setCh2] = useState<number | null>(lastCh2)
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  async function measure() {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setStatus('measuring…')
    try {
      let ckt = applyGeneratorParams(circuit, w1, w2)
      if (psu) ckt = applySupplyRails(ckt, psu)
      const nl = buildNetlist(ckt, { kind: 'op' })
      const r = await getEngine().run(nl)
      const read = (pos?: string, neg?: string) =>
        pos && hasNode(r, pos) ? differentialVoltage(r, pos, neg && hasNode(r, neg) ? neg : '0') : null
      lastCh1 = read(probes?.ch1 ?? 'out', probes?.ch1n ?? 'out_n')
      lastCh2 = read(probes?.ch2 ?? 'scope2', probes?.ch2n ?? 'scope2_n')
      setCh1(lastCh1)
      setCh2(lastCh2)
      setStatus('measured (.op)')
    } catch (e) {
      lastCh1 = null
      lastCh2 = null
      setCh1(null)
      setCh2(null)
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }

  // Re-measure when the drawn circuit or generator settings change. The shared engine stays warm
  // across mounts (no per-mount create/dispose), so this is just the fast .op.
  useEffect(() => { void measure() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuit, probes, w1, w2, psu])

  const fmt = (v: number | null) => {
    if (v === null) return '—'
    const res = RANGES[range].res
    const rounded = Math.round(v / res) * res
    return rounded.toFixed(res < 0.01 ? 3 : 2) + ' V'
  }

  // The voltmeter is an HTML readout (no plot), so draw the two readings onto a white canvas and
  // save it through the same dialog the plots/diagrams use.
  function exportPng() {
    const rows = [
      { label: 'Channel 1  (1+ − 1−)', value: fmt(ch1), color: CH1_COLOR },
      { label: 'Channel 2  (2+ − 2−)', value: fmt(ch2), color: CH2_COLOR },
    ]
    const s = 2, W = 460, rowH = 92, pad = 24, H = pad * 2 + 24 + rows.length * rowH + 18
    const canvas = document.createElement('canvas')
    canvas.width = W * s; canvas.height = H * s
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.scale(s, s)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#222'; ctx.font = '600 16px sans-serif'
    ctx.fillText('Voltmeter — DC', pad, pad + 6)
    let y = pad + 28
    for (const r of rows) {
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(pad, y, W - pad * 2, rowH - 16)
      ctx.strokeStyle = '#dcdcdc'; ctx.strokeRect(pad, y, W - pad * 2, rowH - 16)
      ctx.fillStyle = r.color; ctx.font = '600 13px sans-serif'
      ctx.fillText(r.label, pad + 16, y + 26)
      ctx.fillStyle = '#111'; ctx.font = '30px monospace'
      ctx.fillText(r.value, pad + 16, y + 60)
      y += rowH
    }
    ctx.fillStyle = '#888'; ctx.font = '11px monospace'
    ctx.fillText(status, pad, y + 4)
    canvas.toBlob((b) => { if (b) void savePngBlob(b, 'voltmeter.png') }, 'image/png')
  }

  const reading = (label: string, v: number | null, color: string) => (
    <div style={{ background: 'var(--bg-display)', border: '1px solid var(--border)', borderRadius: 4, padding: '14px 18px', marginBottom: 12 }}>
      <div style={{ fontSize: 12, color, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 30, fontFamily: 'monospace', color: v === null ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{fmt(v)}</div>
    </div>
  )

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Voltmeter — DC</span>
          <div className="display-controls">
            <button className={`run-btn ${busy ? '' : 'active'}`} onClick={() => void measure()} disabled={busy}>
              {busy ? 'Measuring…' : '▶ Measure'}
            </button>
            <button className="run-btn" title="Save the readings as a PNG" onClick={exportPng}>Export PNG</button>
          </div>
        </div>
        <div style={{ padding: 20, overflow: 'auto' }}>
          {reading('Channel 1  (1+ − 1−)', ch1, CH1_COLOR)}
          {reading('Channel 2  (2+ − 2−)', ch2, CH2_COLOR)}
          <div style={{ fontSize: 11, color: 'var(--accent-blue)', fontFamily: 'monospace', marginTop: 4 }}>{status}</div>
        </div>
      </div>

      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Range</div>
        <div className="control-row-inline">
          <label>Full scale</label>
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} style={{ width: 90 }}>
            {RANGES.map((r, i) => <option key={i} value={i}>{r.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          resolution ≈ {RANGES[range].res * 1000} mV
        </div>
        <div className="section-title">How to use</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          In the Circuit tab, wire <b style={{ color: CH1_COLOR }}>1+</b> to a node and
          <b style={{ color: CH1_COLOR }}> 1−</b> to GND (single-ended) or another node
          (differential). Channel 1 reads V(1+) − V(1−); same for Channel 2. Needs a ground.
        </div>
      </div>
    </div>
  )
}
