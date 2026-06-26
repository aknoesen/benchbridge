import { useState, useMemo, useEffect, useRef } from 'react'
import { generateSignal, SignalParams, WaveType } from './core/signal'
import SignalGenerator from './components/SignalGenerator'
import SpectrumAnalyzer from './components/SpectrumAnalyzer'
import './App.css'

type ActiveInstrument = 'siggen' | 'spectrum'
type LayoutMode = 'single' | 'split'

const DEFAULT_PARAMS: SignalParams = {
  waveType: 'square',
  frequency: 1000,
  amplitude: 1,
  offset: 0,
  dutyCycle: 50,
  samplingRate: 100000,
  duration: 0.016,    // 16 ms — 16 periods at 1 kHz → Bluestein 1600-pt FFT, 62.5 Hz bins, zero leakage
}

export default function App() {
  const [active, setActive] = useState<ActiveInstrument>('siggen')
  const [layout, setLayout] = useState<LayoutMode>('single')
  const [params, setParams] = useState<SignalParams>(DEFAULT_PARAMS)
  const [running, setRunning] = useState(true)
  // Tick counter forces signal recompute each frame so noise shimmers like a real SA
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!running) return
    let frameCount = 0
    const loop = () => {
      frameCount++
      // Recompute ~10 times/s (every 6 animation frames at 60 fps) to shimmer noise
      if (frameCount % 6 === 0) setTick(t => t + 1)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [running])

  // Recompute signal on param change or each tick (tick drives noise shimmer)
  const signal = useMemo(() => {
    if (!running) return null
    void tick   // depend on tick so noise re-randomises each frame
    return generateSignal(params)
  }, [params, running, tick])

  function updateParam<K extends keyof SignalParams>(key: K, value: SignalParams[K]) {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="app-shell">
      {/* ── Left navigation panel (Scopy-style) ── */}
      <nav className="nav-panel">
        <div className="nav-logo">M2K</div>

        <button
          className={`nav-btn ${active === 'siggen' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('siggen'); setLayout('single') }}
          title="Signal Generator"
        >
          <span className="nav-icon">⌇</span>
          <span className="nav-label">Signal<br/>Gen</span>
        </button>

        <button
          className={`nav-btn ${active === 'spectrum' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('spectrum'); setLayout('single') }}
          title="Spectrum Analyzer"
        >
          <span className="nav-icon">▲</span>
          <span className="nav-label">Spectrum</span>
        </button>

        <button
          className={`nav-btn ${layout === 'split' ? 'nav-active' : ''}`}
          onClick={() => setLayout(l => l === 'split' ? 'single' : 'split')}
          title="Split view: Signal Gen + Spectrum"
        >
          <span className="nav-icon">⊟</span>
          <span className="nav-label">Split<br/>View</span>
        </button>
      </nav>

      {/* ── Main instrument area ── */}
      <main className={`instrument-area ${layout === 'split' ? 'split' : ''}`}>
        {(layout === 'split' || active === 'siggen') && (
          <SignalGenerator
            params={params}
            signal={signal}
            running={running}
            compact={layout === 'split'}
            onParamChange={updateParam}
            onWaveTypeChange={(w: WaveType) => updateParam('waveType', w)}
            onRunToggle={() => setRunning(r => !r)}
          />
        )}
        {(layout === 'split' || active === 'spectrum') && (
          <SpectrumAnalyzer
            params={params}
            signal={signal}
            running={running}
            compact={layout === 'split'}
            onParamChange={updateParam}
            onRunToggle={() => setRunning(r => !r)}
          />
        )}
      </main>
    </div>
  )
}
