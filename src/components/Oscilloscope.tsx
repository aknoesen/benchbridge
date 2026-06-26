import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { SignalParams } from '../core/signal'
import { captureWindow, voltsAxisRange, SCOPE_H_DIVS } from '../core/scope'
import './Instrument.css'

interface Props {
  params: SignalParams
  signal: { t: Float64Array; x: Float64Array } | null
  running: boolean
  compact?: boolean
  onRunToggle: () => void
}

// 1-2-5 steps. time/div capped so the 10-div window fits the generator capture (16 ms at
// default params) — OSC-1 reads the existing CH1 capture; wider time/div that needs a
// longer capture is a later enhancement (see PROGRESS).
const TIME_PER_DIV: { label: string; value: number }[] = [
  { label: '100 µs', value: 0.0001 },
  { label: '200 µs', value: 0.0002 },
  { label: '500 µs', value: 0.0005 },
  { label: '1 ms', value: 0.001 },
]
const VOLTS_PER_DIV: { label: string; value: number }[] = [
  { label: '50 mV', value: 0.05 },
  { label: '100 mV', value: 0.1 },
  { label: '200 mV', value: 0.2 },
  { label: '500 mV', value: 0.5 },
  { label: '1 V', value: 1 },
]

const CH1_COLOR = '#f0a030'

export default function Oscilloscope({ params, signal, running, compact, onRunToggle }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)

  const [timePerDiv, setTimePerDiv] = useState(0.001) // 1 ms/div → period of 1 kHz spans 1 div
  const [voltsPerDiv, setVoltsPerDiv] = useState(0.5)
  const [vOffset, setVOffset] = useState(0)

  useEffect(() => {
    if (!plotRef.current) return
    const el = plotRef.current

    if (!signal) {
      if (initialised.current) Plotly.purge(el)
      initialised.current = false
      return
    }

    const Fs = params.samplingRate
    const trace = captureWindow({ t: signal.t, x: signal.x }, Fs, timePerDiv)
    const windowMs = SCOPE_H_DIVS * timePerDiv * 1000
    const tMs = trace.t.map((s) => s * 1000)
    const vPlot = trace.v.map((y) => y + vOffset)
    const [yMin, yMax] = voltsAxisRange(voltsPerDiv)

    const data: Plotly.Data[] = [
      {
        x: tMs,
        y: vPlot,
        type: 'scatter',
        mode: 'lines',
        line: { color: CH1_COLOR, width: 1.5 },
        name: 'CH1',
        hoverinfo: 'none' as const,
      },
    ]

    const layout: Partial<Plotly.Layout> = {
      paper_bgcolor: 'var(--bg-display)',
      plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 },
      margin: { l: 56, r: 16, t: 24, b: 44 },
      showlegend: false,
      xaxis: {
        title: { text: 'Time (ms)', font: { size: 11 } },
        range: [0, windowMs],
        dtick: timePerDiv * 1000, // one gridline per horizontal division
        gridcolor: '#2a2a2a',
        zerolinecolor: '#444',
        tickfont: { size: 10 },
        color: 'var(--text-secondary)',
      },
      yaxis: {
        title: { text: 'Voltage (V)', font: { size: 11 } },
        range: [yMin, yMax],
        dtick: voltsPerDiv, // one gridline per vertical division
        gridcolor: '#2a2a2a',
        zerolinecolor: '#666',
        tickfont: { size: 10 },
        color: 'var(--text-secondary)',
      },
    }

    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true }

    if (!initialised.current) {
      Plotly.newPlot(el, data, layout, config)
      initialised.current = true
    } else {
      Plotly.react(el, data, layout, config)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, timePerDiv, voltsPerDiv, vOffset, params.samplingRate])

  return (
    <div className="instrument-panel">
      {/* ── Display ── */}
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Oscilloscope — CH1</span>
          <div className="display-controls">
            <button className={`run-btn ${running ? 'active' : ''}`} onClick={onRunToggle}>
              {running ? '⏹ Stop' : '▶ Run'}
            </button>
          </div>
        </div>
        <div ref={plotRef} className="plotly-display" />
        {!running && <div className="display-overlay">Stopped — press Run to acquire</div>}
      </div>

      {/* ── Settings ── */}
      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Horizontal</div>
        <div className="control-row-inline">
          <label>Time/div</label>
          <select
            value={timePerDiv}
            onChange={(e) => setTimePerDiv(Number(e.target.value))}
            style={{ width: 90 }}
          >
            {TIME_PER_DIV.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="section-title">CH1 vertical</div>
        <div className="control-row-inline">
          <label>Volts/div</label>
          <select
            value={voltsPerDiv}
            onChange={(e) => setVoltsPerDiv(Number(e.target.value))}
            style={{ width: 90 }}
          >
            {VOLTS_PER_DIV.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="control-row-inline">
          <label>Offset (V)</label>
          <input
            type="number"
            step={0.1}
            value={vOffset}
            onChange={(e) => setVOffset(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </div>

        <div className="section-title">Readout</div>
        <div style={{ fontSize: 11, lineHeight: 1.8, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
          <div>Time/div: <span style={{ color: 'var(--ch1-color)' }}>{(timePerDiv * 1000).toString()} ms</span></div>
          <div>V/div: <span style={{ color: 'var(--ch1-color)' }}>{voltsPerDiv} V</span></div>
          <div>Window: <span style={{ color: 'var(--ch1-color)' }}>{(SCOPE_H_DIVS * timePerDiv * 1000).toFixed(1)} ms</span></div>
        </div>
      </div>
    </div>
  )
}
