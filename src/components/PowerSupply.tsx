// Power Supply (PSU-1) — M2K two programmable DC rails: V+ (0..+5 V) and V- (-5..0 V), each
// with an enable, plus a tracking mode (V- mirrors -V+). The rail voltages flow into every
// circuit via applySupplyRails(); the V+/V- pins drawn on the breadboard take these values.
import { useState } from 'react'
import { SupplySettings } from '../core/netlist'
import './Instrument.css'

interface Props {
  psu: SupplySettings
  onChange: (s: SupplySettings) => void
  compact?: boolean
}

const VPLUS_COLOR = '#e04040' // red
const VMINUS_COLOR = '#4a9eff' // blue
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export default function PowerSupply({ psu, onChange, compact }: Props) {
  const [tracking, setTracking] = useState(false)

  function setPlus(raw: number) {
    const plus = clamp(raw, 0, 5)
    onChange(tracking ? { ...psu, plus, minus: -plus } : { ...psu, plus })
  }
  function setMinus(raw: number) {
    onChange({ ...psu, minus: clamp(raw, -5, 0) })
  }

  const channel = (
    label: string, color: string, value: number, enabled: boolean,
    min: number, max: number, onVal: (v: number) => void, onEnable: (b: boolean) => void,
    disabled = false,
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
            (b) => onChange({ ...psu, plusEnabled: b }))}
          {channel('V−  Negative (−5 to 0 V)', VMINUS_COLOR, psu.minus, psu.minusEnabled, -5, 0, setMinus,
            (b) => onChange({ ...psu, minusEnabled: b }), tracking)}
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
          <b style={{ color: VMINUS_COLOR }}> V−</b> / GND pins in the Circuit tab; the Voltmeter
          then reads them.
        </div>
      </div>
    </div>
  )
}
