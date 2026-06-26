import { useState, useMemo, useEffect, useRef } from 'react'
import { SignalParams, WaveType } from './core/signal'
import { DEFAULT_CHANNELS, resolveChannelSamples, ChannelInputs } from './core/scope'
import { toCircuit, type Schematic } from './core/schematic'
import { type SupplySettings } from './core/netlist'
import SignalGenerator from './components/SignalGenerator'
import SpectrumAnalyzer from './components/SpectrumAnalyzer'
import Oscilloscope from './components/Oscilloscope'
import NetworkAnalyzer from './components/NetworkAnalyzer'
import SchematicEditor from './components/SchematicEditor'
import Voltmeter from './components/Voltmeter'
import PowerSupply from './components/PowerSupply'
import SpiceDevPanel from './components/SpiceDevPanel'
import './App.css'

// SPICE-1 throwaway dev affordance. Set false once LOOP-1 builds the real circuit UI.
const SHOW_SPICE_DEV = true

type ActiveInstrument = 'siggen' | 'spectrum' | 'scope' | 'network' | 'schematic' | 'voltmeter' | 'psu' | 'spice'
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

const DEFAULT_PARAMS2: SignalParams = {
  waveType: 'sine',
  frequency: 2000,
  amplitude: 0.5,
  offset: 0,
  dutyCycle: 50,
  samplingRate: 100000,
  duration: 0.016,
}

const DEFAULT_PSU: SupplySettings = { plus: 5, minus: -5, plusEnabled: true, minusEnabled: true }

const CIRCUIT_KEY = 'm2k-circuit-v1'

function loadStoredSchematic(): Schematic {
  try {
    const raw = localStorage.getItem(CIRCUIT_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (Array.isArray(d.components) && Array.isArray(d.wires)) return { components: d.components, wires: d.wires }
    }
  } catch { /* ignore corrupt storage */ }
  return { components: [], wires: [] }
}

export default function App() {
  const [active, setActive] = useState<ActiveInstrument>('siggen')
  const [layout, setLayout] = useState<LayoutMode>('single')
  const [params, setParams] = useState<SignalParams>(DEFAULT_PARAMS)
  const [params2, setParams2] = useState<SignalParams>(DEFAULT_PARAMS2)
  const [psu, setPsu] = useState<SupplySettings>(DEFAULT_PSU)
  const [channels] = useState(DEFAULT_CHANNELS)
  const [running, setRunning] = useState(true)
  const [schematic, setSchematic] = useState<Schematic>(loadStoredSchematic)
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!running) return
    let frameCount = 0
    const loop = () => {
      frameCount++
      if (frameCount % 6 === 0) setTick(t => t + 1)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [running])

  useEffect(() => {
    try { localStorage.setItem(CIRCUIT_KEY, JSON.stringify(schematic)) } catch { /* quota */ }
  }, [schematic])

  const channelInputs = useMemo<ChannelInputs>(() => ({
    generatorParams: params,
    generator2Params: params2,
    circuitOut: null,
  }), [params, params2])

  const channelSignals = useMemo(() => {
    if (!running) return { CH1: null, CH2: null }
    void tick
    return {
      CH1: resolveChannelSamples(channels.CH1, channelInputs),
      CH2: resolveChannelSamples(channels.CH2, channelInputs),
    }
  }, [channels, channelInputs, running, tick])

  const signal = channelSignals.CH1
  const signal2 = useMemo(() => {
    if (!running) return null
    void tick
    return resolveChannelSamples({ id: 'CH2', enabled: true, source: { kind: 'generator2' } }, channelInputs)
  }, [running, channelInputs, tick])

  const drawn = useMemo(() => toCircuit(schematic, 'Drawn circuit'), [schematic])
  const drawnValid = drawn.warnings.length === 0

  function updateParam<K extends keyof SignalParams>(key: K, value: SignalParams[K]) {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const navBtn = (id: ActiveInstrument, icon: string, label: React.ReactNode, title: string) => (
    <button className={`nav-btn ${active === id && layout === 'single' ? 'nav-active' : ''}`}
      onClick={() => { setActive(id); setLayout('single') }} title={title}>
      <span className="nav-icon">{icon}</span><span className="nav-label">{label}</span>
    </button>
  )

  return (
    <div className="app-shell">
      <nav className="nav-panel">
        <div className="nav-logo">M2K</div>
        {navBtn('siggen', '⌇', <>Signal<br/>Gen</>, 'Signal Generator')}
        {navBtn('scope', '∿', 'Scope', 'Oscilloscope')}
        {navBtn('spectrum', '▲', 'Spectrum', 'Spectrum Analyzer')}
        {navBtn('network', '◎', 'Network', 'Network Analyzer (Bode)')}
        {navBtn('voltmeter', 'Ω', 'Voltmeter', 'Voltmeter (DC)')}
        {navBtn('psu', '∓', 'Supply', 'Power Supply')}
        {navBtn('schematic', '▤', 'Circuit', 'Schematic Editor')}

        <button className={`nav-btn ${layout === 'split' ? 'nav-active' : ''}`}
          onClick={() => setLayout(l => l === 'split' ? 'single' : 'split')} title="Split view: Signal Gen + Spectrum">
          <span className="nav-icon">&#8863;</span><span className="nav-label">Split<br/>View</span>
        </button>

        {SHOW_SPICE_DEV && navBtn('spice', '○', <>SPICE<br/>dev</>, 'SPICE engine check (dev)')}
      </nav>

      <main className={`instrument-area ${layout === 'split' ? 'split' : ''}`}>
        {layout === 'single' && active === 'scope' ? (
          <Oscilloscope
            params={params}
            signal={signal}
            signal2={signal2}
            params2={params2}
            running={running}
            onRunToggle={() => setRunning(r => !r)}
            onParams2Change={(k, v) => setParams2(prev => ({ ...prev, [k]: v }))}
          />
        ) : layout === 'single' && active === 'schematic' ? (
          <SchematicEditor schematic={schematic} setSchematic={setSchematic} />
        ) : layout === 'single' && active === 'network' ? (
          <NetworkAnalyzer
            circuit={drawnValid ? drawn.circuit : undefined}
            dutName={drawnValid ? 'your drawn circuit' : undefined}
          />
        ) : layout === 'single' && active === 'voltmeter' ? (
          <Voltmeter circuit={drawn.circuit} w1={params} w2={params2} psu={psu} />
        ) : layout === 'single' && active === 'psu' ? (
          <PowerSupply psu={psu} onChange={setPsu} />
        ) : layout === 'single' && active === 'spice' && SHOW_SPICE_DEV ? (
          <SpiceDevPanel />
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  )
}
