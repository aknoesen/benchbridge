// Power Supply (PSU-1/PSU-2) — M2K two programmable DC rails: V+ (0..+5 V) and V- (-5..0 V), each
// with an enable and a tracking mode (V- mirrors -V+). The rail voltages flow into every circuit
// via applySupplyRails(). PSU-2 runs an .op of the drawn circuit and shows the current each rail
// delivers, against the M2K's ~50 mA per-rail limit. (W1/W2 are signal outputs, not a power source.)
import { useState, useEffect, useRef } from 'react'
import { SignalParams } from '../core/signal'
import { createSpiceEngine, SpiceEngine, sourceCurrent } from '../core/spice'
import { buildNetlist, applyGeneratorParams, applySupplyRails, type Circuit, type SupplySettings } from '../core/netlist'
import './Instrument.css'

interface Props {
  psu: SupplySettings
  onChange: (s: SupplySettings) => void
  circuit?: Circuit
  w1?: SignalParams
  w2?: SignalParams
  compact?: boolean
}

const VPLUS_COLOR = '#e04040' // red
const VMINUS_COLOR = '#4a9eff' // blue
const I_LIMIT = 0.05 // M2K programmable supply: ~50 mA per rail
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export default function PowerSupply({ psu, onChange, circuit, w1, w2, compact }: Props) {
  const [tracking, setTracking] = useState(false)
  const engineRef = useRef<SpiceEngine | null>(null)
  const runningRef = useRef(false)
  const [iPlus, setIPlus] = useState<number | null>(null)
  const [iMinus, setIMinus] = useState<number | null>(null)

  useEffect(() => {
    engineRef.current = createSpiceEngine()
    return () => { engineRef.current?.dispose(); engineRef.current = null }
  }, [])

  // PSU-2: .op the drawn circuit with these rails and sum the current each rail delivers.
  useEffect(() => {
    const eng = engineRef.current
    if (!eng || !circuit) { setIPlus(null); setIMinus(null); return }
    let cancelled = false
    const id = setTimeout(async () => {
      if (runningRef.current) return
      runningRef.current = true
      try {
        const ckt = applySupplyRails(applyGeneratorParams(circuit, w1, w2), psu)
        const rails = ckt.components.filter((c) => c.kind === 'dcrail')
        if (rails.length === 0) { if (!cancelled) { setIPlus(null); setIMinus(null) }; return }
        const r = await eng.run(buildNetlist(ckt, { kind: 'op' }))
        if (cancelled) return
        let ip = 0, im = 0
        for (const c of rails) {
          if (c.kind !== 'dcrail') continue
          const i = Math.abs(sourceCurrent(r, c.id))
          if (c.volts >= 0) ip += i; else im += i
        }
        setIPlus(psu.plusEnabled ? ip : 0)
        setIMinus(psu.minusEnabled ? im : 0)
      } catch {
        if (!cancelled) { setIPlus(null); setIMinus(null) }
      } finally {
        runningRef.current = false
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(id) }
  }, [circuit, w1, w2, psu])

  function setPlus(raw: number) {
    const plus = clamp(raw, 0, 5)
    onChange(tracking ? { ...psu, plus, minus: -plus } : { ...psu, plus })
  }
  function setMinus(raw: number) {
    onChange({ ...psu, minus: clamp(raw, -5, 0) })
  }

  const currentLine = (i: number | null, color: string) => {
    if (i === null) return (
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
        I: — (wire this rail to a load in the Circuit tab)
      </div>
    )
    const over = i > I_LIMIT
    return (
      <div style={{ fontSize: 13, fontFamily: 'monospace', marginTop: 8, color: over ? '#ff5555' : color }}>
        I = {(i * 1000).toFixed(1)} mA {over ? '⚠ over ~50 mA M2K limit' : '/ 50 mA'}
      </div>
    )
  }

  const channel = (
    label: string, color: string, value: number, enabled: boolean,
    min: number, max: number, onVal: (v: number) => void, onEnable: (b: boolean) => void,
    current: number | null, disabled = false,
  ) => (
    <div style={{ background: 'var(--bg-display)', border: '1px solid var(--border)', borderRadius: 4, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color, fontWeight: 600, fontSize: 13 }}>{label}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onEnable(e.target.checked)} />
          <span style={{ color: enabled ? color : 'var(--text-secondary)' }}>Enabled</span>
        </label>
      </div>
      <div style={{ fontSize: 32, fontFamily: 'monospace', color: enabled ? 'var(--text-primary)' : 'var(--text-secondary)', marginBottom: 8 }}>
        {value.toFixed(3)} V
      </div>
      <input type="range" min={min} max={max} step={0.001} value={value} disabled={disabled}
        onChange={(e) => onVal(Number(e.target.value))} style={{ width: '100%' }} />
      <div className="control-row-inline" style={{ marginTop: 8 }}>
        <label>Set (V)</label>
        <input type="number" min={min} max={max} step={0.005} value={value} disabled={disabled}
          onChange={(e) => onVal(Number(e.target.value))} style={{ width: 90 }} />
      </div>
      {enabled && currentLine(current, color)}
    </div>
  )

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Power Supply</span>
        </div>
        <div style={{ padding: 20, overflow: 'auto' }}>
          {channel('V+  Positive (0 to +5 V)', VPLUS_COLOR, psu.plus, psu.plusEnabled, 0, 5, setPlus,
            (b) => onChange({ ...psu, plusEnabled: b }), iPlus)}
          {channel('V−  Negative (−5 to 0 V)', VMINUS_COLOR, psu.minus, psu.minusEnabled, -5, 0, setMinus,
            (b) => onChange({ ...psu, minusEnabled: b }), iMinus, tracking)}
        </div>
      </div>

      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Mode</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, marginBottom: 8 }}>
          <input type="checkbox" checked={tracking} onChange={(e) => {
            const t = e.target.checked
            setTracking(t)
            if (t) onChange({ ...psu, minus: -psu.plus })
          }} />
          <span>Tracking (V− = −V+)</span>
        </label>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          In <b>independent</b> mode each rail is set separately; in <b>tracking</b> mode V− follows
          −V+. Wire the <b style={{ color: VPLUS_COLOR }}>V+</b> /
          <b style={{ color: VMINUS_COLOR }}> V−</b> / GND pins in the Circuit tab; the rail current
          appears above and the Voltmeter reads the nodes.
        </div>

        <div className="section-title">Power budget</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          The M2K supplies deliver ±5 V at about <b>50 mA per rail</b> — this is the circuit's power
          source. <b>W1/W2 are signal outputs, not a power source</b>; do not power a circuit from them.
        </div>
      </div>
    </div>
  )
}
