import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { SignalParams, computeSpectrum, theoreticalHarmonics, WindowType } from '../core/signal'
import './Instrument.css'

interface Props {
  params: SignalParams
  signal: { t: Float64Array; x: Float64Array } | null
  running: boolean
  compact?: boolean
  onParamChange: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
  onRunToggle: () => void
}

const WINDOWS: { label: string; value: WindowType }[] = [
  { label: 'Hanning',   value: 'hanning'   },
  { label: 'Hamming',   value: 'hamming'   },
  { label: 'Blackman',  value: 'blackman'  },
  { label: 'Flat Top',  value: 'flat-top'  },
  { label: 'Rectangle', value: 'rectangle' },
]
const BIT_DEPTHS = [4, 8, 12]
const PERSIST_DEPTH = 20   // frames kept for fade persistence

export default function SpectrumAnalyzer({ params, signal, running, compact, onParamChange, onRunToggle }: Props) {
  const plotRef    = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)

  // Persistence buffers — cleared whenever the display geometry changes
  const fadeBufferRef = useRef<number[][]>([])   // last N amplitude arrays
  const avgBufferRef  = useRef<number[] | null>(null)
  const avgCountRef   = useRef(0)
  const prevBinCountRef = useRef(0)

  const [bits, setBits]           = useState(12)
  const [showTheory, setShowTheory] = useState(false)
  const [freqMax, setFreqMax]     = useState(10000)
  const [windowType, setWindowType] = useState<WindowType>('hanning')
  const [persistence, setPersistence] = useState(false)
  const [showAvg, setShowAvg]     = useState(true)
  const [markerFreq, setMarkerFreq] = useState<number | null>(null)
  const [markerAmp, setMarkerAmp]   = useState<number | null>(null)

  // Reset persistence buffers when display settings change
  useEffect(() => {
    fadeBufferRef.current = []
    avgBufferRef.current  = null
    avgCountRef.current   = 0
    prevBinCountRef.current = 0
  }, [bits, freqMax, windowType, params.frequency, params.waveType, params.dutyCycle, params.samplingRate])

  useEffect(() => {
    if (!plotRef.current) return
    const el = plotRef.current

    if (!signal) {
      if (initialised.current) Plotly.purge(el)
      initialised.current = false
      setMarkerFreq(null)
      setMarkerAmp(null)
      return
    }

    const { freqAxis, magnitudeDbfs, noiseFloorDbfs, binWidthHz } = computeSpectrum(
      signal.x, params.samplingRate, bits, 5, windowType
    )

    // Limit to display range
    const maxIdx = freqAxis.findIndex(f => f > freqMax) || freqAxis.length
    const freqDisp = Array.from(freqAxis.slice(1, maxIdx))
    const ampDisp  = Array.from(magnitudeDbfs.slice(1, maxIdx))

    // If bin count changed (edge case), clear buffers
    if (ampDisp.length !== prevBinCountRef.current) {
      fadeBufferRef.current = []
      avgBufferRef.current  = null
      avgCountRef.current   = 0
      prevBinCountRef.current = ampDisp.length
    }

    // ── Persistence buffers ──────────────────────────────────────────────────

    // Fade buffer: rolling window of last PERSIST_DEPTH frames
    if (persistence) {
      fadeBufferRef.current = [ampDisp, ...fadeBufferRef.current].slice(0, PERSIST_DEPTH)
    } else {
      fadeBufferRef.current = []
    }

    // Running average (exponential moving average)
    if (showAvg) {
      if (!avgBufferRef.current) {
        avgBufferRef.current = [...ampDisp]
        avgCountRef.current  = 1
      } else {
        avgCountRef.current = Math.min(avgCountRef.current + 1, 60)
        const alpha = 1 / avgCountRef.current
        for (let i = 0; i < ampDisp.length; i++) {
          avgBufferRef.current[i] = (1 - alpha) * avgBufferRef.current[i] + alpha * ampDisp[i]
        }
      }
    } else {
      avgBufferRef.current = null
      avgCountRef.current  = 0
    }

    // ── Peak marker ──────────────────────────────────────────────────────────
    let peakIdx = 0, localPeakAmp = -200
    for (let i = 0; i < ampDisp.length; i++) {
      if (ampDisp[i] > localPeakAmp) { localPeakAmp = ampDisp[i]; peakIdx = i }
    }
    let localPeakFreq = freqDisp[peakIdx]
    if (peakIdx > 0 && peakIdx < ampDisp.length - 1) {
      const left = ampDisp[peakIdx - 1], mid = ampDisp[peakIdx], right = ampDisp[peakIdx + 1]
      const delta = 0.5 * (right - left) / (2 * mid - left - right)
      localPeakFreq = freqDisp[peakIdx] + delta * binWidthHz
    }
    setMarkerFreq(localPeakFreq)
    setMarkerAmp(localPeakAmp)

    // ── Build traces ─────────────────────────────────────────────────────────
    const traces: Plotly.Data[] = []

    // Fade persistence: oldest frames first (drawn behind), most transparent
    if (persistence && fadeBufferRef.current.length > 1) {
      for (let i = fadeBufferRef.current.length - 1; i >= 1; i--) {
        const age = i  // 1 = most recent old frame, PERSIST_DEPTH-1 = oldest
        const opacity = Math.pow(0.78, age) * 0.7
        traces.push({
          x: freqDisp,
          y: fadeBufferRef.current[i],
          type: 'scatter',
          mode: 'lines',
          line: { color: `rgba(240,160,48,${opacity.toFixed(3)})`, width: 1 },
          showlegend: false,
          hoverinfo: 'none' as const,
        })
      }
    }

    // Current frame — dimmed when average is active (average becomes the primary display)
    traces.push({
      x: freqDisp,
      y: ampDisp,
      type: 'scatter',
      mode: 'lines',
      line: { color: showAvg ? 'rgba(240,160,48,0.25)' : '#f0a030', width: 1 },
      name: 'CH1 (live)',
    })

    // Running average
    if (showAvg && avgBufferRef.current) {
      traces.push({
        x: freqDisp,
        y: avgBufferRef.current,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#44aaff', width: 2 },
        name: `Avg (n=${avgCountRef.current})`,
      })
    }

    // Noise floor reference line
    traces.push({
      x: [freqDisp[0], freqDisp[freqDisp.length - 1]],
      y: [noiseFloorDbfs, noiseFloorDbfs],
      type: 'scatter',
      mode: 'lines',
      line: { color: '#ff4444', width: 1, dash: 'dot' },
      name: `Floor (${bits}-bit)`,
    })

    // Theoretical overlay
    if (showTheory) {
      const theory = theoreticalHarmonics(
        params.waveType, params.amplitude, params.frequency, params.dutyCycle, 15
      )
      const theoryFreqs: number[] = [], theoryDbfs: number[] = []
      theory.frequencies.forEach((f, i) => {
        if (f <= freqMax) {
          theoryFreqs.push(f)
          theoryDbfs.push(20 * Math.log10((theory.amplitudesV[i] + 1e-12) / 2.5))
        }
      })
      traces.push({
        x: theoryFreqs, y: theoryDbfs,
        type: 'scatter', mode: 'markers',
        marker: { color: '#44dd88', size: 8, symbol: 'diamond' },
        name: 'Theory',
      })
    }

    // ── Layout ───────────────────────────────────────────────────────────────
    const layout: Partial<Plotly.Layout> = {
      paper_bgcolor: 'var(--bg-display)',
      plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 },
      margin: { l: 56, r: 16, t: 24, b: 44 },
      xaxis: {
        title: { text: 'Frequency (Hz)', font: { size: 11 } },
        range: [0, freqMax],
        gridcolor: '#2a2a2a', zerolinecolor: '#444',
        tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
      yaxis: {
        title: { text: 'Amplitude (dBFS)', font: { size: 11 } },
        range: [-120, 5],
        gridcolor: '#2a2a2a', zerolinecolor: '#444',
        tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
      legend: {
        font: { size: 10 }, bgcolor: 'rgba(30,30,30,0.8)',
        bordercolor: 'var(--border)', borderwidth: 1,
      },
      annotations: [{
        x: localPeakFreq, y: localPeakAmp,
        text: `M1: ${(localPeakFreq / 1000).toFixed(2)} kHz<br>${localPeakAmp.toFixed(1)} dBFS`,
        showarrow: true, arrowhead: 2, arrowcolor: '#ffffff88',
        font: { size: 10, color: '#ffffff' },
        bgcolor: 'rgba(40,40,40,0.9)', bordercolor: '#666', borderwidth: 1,
      }],
    }

    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true, scrollZoom: true }

    if (!initialised.current) {
      Plotly.newPlot(el, traces, layout, config)
      initialised.current = true
    } else {
      Plotly.react(el, traces, layout, config)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, bits, showTheory, freqMax, params, windowType, persistence, showAvg])

  const snrDb = (6.02 * bits + 1.76).toFixed(0)

  return (
    <div className="instrument-panel">
      {/* ── Display ── */}
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Spectrum Analyzer — CH1</span>
          <div className="display-controls">
            <button className={`run-btn ${running ? 'active' : ''}`} onClick={onRunToggle}>
              {running ? '⏹ Stop' : '▶ Run'}
            </button>
          </div>
        </div>
        <div ref={plotRef} className="plotly-display" />
        {!running && <div className="display-overlay">Stopped — press Run to acquire</div>}
        {markerFreq !== null && markerAmp !== null && running && (
          <div className="marker-table">
            <div className="marker-row">
              <span className="marker-id">M1</span>
              <span className="marker-freq">{(markerFreq / 1000).toFixed(3)} kHz</span>
              <span className="marker-amp">{markerAmp.toFixed(2)} dBFS</span>
              <span className="marker-type">Peak</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Settings ── */}
      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Sweep</div>

        <div className="control-row-inline">
          <label>Stop freq</label>
          <select value={freqMax} onChange={e => setFreqMax(Number(e.target.value))} style={{ width: 90 }}>
            <option value={5000}>5 kHz</option>
            <option value={10000}>10 kHz</option>
            <option value={20000}>20 kHz</option>
            <option value={50000}>50 kHz</option>
          </select>
        </div>

        <div className="control-row-inline">
          <label>Window</label>
          <select value={windowType} onChange={e => setWindowType(e.target.value as WindowType)} style={{ width: 90 }}>
            {WINDOWS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </div>

        <div className="section-title">Signal</div>

        <div className="control-row-inline">
          <label>Frequency</label>
          <input type="number" min={10} max={20000} step={10}
            value={params.frequency}
            onChange={e => onParamChange('frequency', Number(e.target.value))}
            style={{ width: 80 }} />
        </div>
        <div className="control-row-inline">
          <label>Amplitude</label>
          <input type="number" min={0.1} max={2.5} step={0.1}
            value={params.amplitude}
            onChange={e => onParamChange('amplitude', Number(e.target.value))}
            style={{ width: 80 }} />
        </div>
        {params.waveType === 'square' && (
          <div className="control-row">
            <div className="control-row-inline" style={{ marginBottom: 2 }}>
              <label>Duty Cycle</label>
              <span className="value-badge">{params.dutyCycle}%</span>
            </div>
            <input type="range" min={1} max={99}
              value={params.dutyCycle}
              onChange={e => onParamChange('dutyCycle', Number(e.target.value))} />
          </div>
        )}

        {/* ── Learning Mode ── */}
        <div className="section-title learning-title">⚗ Learning Mode</div>

        <div className="control-row">
          <div className="control-row-inline" style={{ marginBottom: 2 }}>
            <label>ADC Bit Depth</label>
            <span className="value-badge" style={{ color: '#ff8844' }}>{bits}-bit</span>
          </div>
          <div className="bit-depth-selector">
            {BIT_DEPTHS.map(b => (
              <button key={b} className={bits === b ? 'active' : ''} onClick={() => setBits(b)}>
                {b}-bit
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3 }}>
            SNR ≈ {snrDb} dB
          </div>
        </div>

        {/* Persistence */}
        <div className="control-row" style={{ borderTop: '1px solid #333', paddingTop: 8, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={persistence} onChange={e => setPersistence(e.target.checked)} />
            <span style={{ color: persistence ? '#f0a030' : 'var(--text-label)' }}>
              Persistence ({PERSIST_DEPTH} frames)
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAvg} onChange={e => setShowAvg(e.target.checked)} />
            <span style={{ color: showAvg ? '#44aaff' : 'var(--text-label)' }}>
              Running average
            </span>
          </label>
          {showAvg && avgCountRef.current > 1 && (
            <div style={{ fontSize: 10, color: '#44aaff', marginTop: 3 }}>
              n = {avgCountRef.current} frames
            </div>
          )}
        </div>

        <div className="control-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showTheory} onChange={e => setShowTheory(e.target.checked)} />
            Show theoretical spectrum ◆
          </label>
        </div>

        <div className="section-title">Marker</div>
        {markerFreq !== null && markerAmp !== null ? (
          <div style={{ fontSize: 11, lineHeight: 1.8, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
            <div>M1 freq: <span style={{ color: 'var(--ch1-color)' }}>{(markerFreq / 1000).toFixed(3)} kHz</span></div>
            <div>M1 amp:  <span style={{ color: 'var(--ch1-color)' }}>{markerAmp.toFixed(2)} dBFS</span></div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>No signal</div>
        )}
      </div>
    </div>
  )
}
