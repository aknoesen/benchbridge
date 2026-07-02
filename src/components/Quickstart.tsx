// Quickstart panel (Track H / QS-4) — paginated, orientation-first onboarding. A chapter menu
// drives a one-page-at-a-time view (no long scroll): an orientation screen first, then the bench
// map, a 2-minute quick win, a modular instrument tour (submenu), the build-it capstone, and a
// where-next page. Next/Back walk the spine; the menu doubles as the progress indicator. All step
// content and SVG diagrams are reused from QS-1/QS-2 — re-sequenced, not rewritten. The step
// buttons drive the app (load example + jump to instrument) exactly as before. Static content
// only; touches no core/ signal math. See docs/specs/quickstart-redesign.md.
import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import './Instrument.css'

interface Props {
  // Switch the visible instrument panel (id is an App ActiveInstrument).
  onGoTo: (id: string) => void
  // Load a built-in example by id (sets the schematic + generator + scope presets).
  onLoadExample: (id: string) => void
}

type PageId =
  | 'orientation' | 'bench' | 'first'
  | 'tour-scope' | 'tour-spectrum' | 'tour-network' | 'tour-tracer'
  | 'build' | 'next'

// The guided-tour spine: Next/Back walk this order; the menu can jump anywhere.
const SPINE: PageId[] = ['orientation', 'bench', 'first', 'tour-scope', 'tour-spectrum', 'tour-network', 'tour-tracer', 'build', 'next']

// `sub: true` marks the four Tour pages — they render indented under the "Tour the bench" group
// label in the menu, and sit inside the spine between 'first' and 'build'.
const CHAPTERS: { id: PageId; title: string; time?: string; sub?: boolean }[] = [
  { id: 'orientation', title: 'Start here', time: '~1 min' },
  { id: 'bench', title: 'The bench at a glance', time: '~1 min' },
  { id: 'first', title: 'Your first measurement', time: '~2 min' },
  { id: 'tour-scope', title: 'Signal Gen + Scope', time: '~2 min', sub: true },
  { id: 'tour-spectrum', title: 'Spectrum + digitization', time: '~2 min', sub: true },
  { id: 'tour-network', title: 'Network Analyzer', time: '~1 min', sub: true },
  { id: 'tour-tracer', title: 'Curve Tracer', time: '~2 min', sub: true },
  { id: 'build', title: 'Build it for real', time: '~5 min' },
  { id: 'next', title: 'Where next' },
]

// Remembered page + visited set. Module-level so they survive the panel unmounting when the user
// clicks a step to visit an instrument — on return they resume exactly where they left off.
let lastPage: PageId = 'orientation'
const visitedStore = new Set<PageId>(['orientation'])

const GOLD = '#FFBF00'
const link: CSSProperties = { color: 'var(--accent-blue)' }
const h2: CSSProperties = { color: GOLD, margin: '0 0 4px', fontSize: 'clamp(18px, 2.4vw, 24px)' }
const card: CSSProperties = { background: 'var(--bg-display)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 16px', marginTop: 12 }
const stepNum: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: GOLD, color: '#022851', fontWeight: 700, fontSize: 13, marginRight: 8, flex: '0 0 auto' }
const goBtn: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#022851', background: GOLD, border: 'none', borderRadius: 6, cursor: 'pointer' }
const openBtn: CSSProperties = { padding: '3px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }
const secondaryBtn: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }
const note: CSSProperties = { fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 10 }

// A numbered step card: the proven "load X → open Y → read Z" unit, unchanged from QS-1/QS-2.
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <span style={stepNum}>{n}</span>
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </div>
  )
}

// real M2K signal/instrument  ↔  this app's panel
const BRIDGE: { real: string; panel: string; id: string }[] = [
  { real: 'Power supply — V+ / V− rails, 0..±5 V (DAC-driven)', panel: 'Supply', id: 'psu' },
  { real: 'Voltmeter — two 12-bit ADC channels (1±, 2±)', panel: 'Voltmeter', id: 'voltmeter' },
  { real: 'Function generator — W1 / W2 outputs (DAC)', panel: 'Signal Gen', id: 'siggen' },
  { real: 'Oscilloscope — voltage vs time', panel: 'Scope', id: 'scope' },
  { real: 'Spectrum analyzer — frequency content', panel: 'Spectrum', id: 'spectrum' },
  { real: 'Network analyzer — gain/phase vs frequency (Bode)', panel: 'Network', id: 'network' },
  { real: 'Solderless breadboard + circuit', panel: 'Circuit / Board', id: 'schematic' },
]

// The one signal-flow picture: sources (DAC out) → your circuit → readers (ADC in).
function SignalFlow() {
  const box: CSSProperties = {}
  void box
  return (
    <svg viewBox="0 0 760 150" style={{ width: '100%', height: 'auto' }} role="img"
      aria-label="Signal flow: the supplies and W1/W2 generators drive your circuit; the scope, voltmeter, spectrum and network analyzers read it back.">
      {/* sources */}
      <rect x="10" y="24" width="180" height="46" rx="6" fill="var(--bg-panel)" stroke="#e04040" />
      <text x="100" y="43" fill="var(--text-primary)" fontSize="12.5" fontWeight="700" textAnchor="middle">Supply V+ / V−</text>
      <text x="100" y="60" fill="var(--text-secondary)" fontSize="11" textAnchor="middle">powers the circuit</text>
      <rect x="10" y="82" width="180" height="46" rx="6" fill="var(--bg-panel)" stroke="var(--accent-blue)" />
      <text x="100" y="101" fill="var(--text-primary)" fontSize="12.5" fontWeight="700" textAnchor="middle">Signal Gen W1 / W2</text>
      <text x="100" y="118" fill="var(--text-secondary)" fontSize="11" textAnchor="middle">injects the signal</text>
      <text x="100" y="16" fill="var(--text-secondary)" fontSize="11" textAnchor="middle">DAC out — numbers → volts</text>
      {/* arrows in */}
      <line x1="190" y1="47" x2="280" y2="66" stroke="var(--text-secondary)" strokeWidth="2" />
      <line x1="190" y1="105" x2="280" y2="86" stroke="var(--text-secondary)" strokeWidth="2" />
      <polygon points="284,76 272,70 272,82" fill="var(--text-secondary)" />
      {/* the circuit */}
      <rect x="290" y="46" width="180" height="60" rx="8" fill="var(--bg-panel)" stroke="var(--theory-color)" strokeWidth="1.6" />
      <text x="380" y="72" fill="var(--theory-color)" fontSize="14" fontWeight="700" textAnchor="middle">your circuit</text>
      <text x="380" y="92" fill="var(--text-secondary)" fontSize="11" textAnchor="middle">drawn + simulated (real SPICE)</text>
      {/* arrows out */}
      <line x1="470" y1="66" x2="560" y2="47" stroke="var(--text-secondary)" strokeWidth="2" />
      <line x1="470" y1="86" x2="560" y2="105" stroke="var(--text-secondary)" strokeWidth="2" />
      <polygon points="564,45 552,42 555,54" fill="var(--text-secondary)" />
      <polygon points="564,107 555,98 552,110" fill="var(--text-secondary)" />
      {/* readers */}
      <rect x="570" y="24" width="180" height="46" rx="6" fill="var(--bg-panel)" stroke="var(--ch1-color)" />
      <text x="660" y="43" fill="var(--text-primary)" fontSize="12.5" fontWeight="700" textAnchor="middle">Scope · Voltmeter</text>
      <text x="660" y="60" fill="var(--text-secondary)" fontSize="11" textAnchor="middle">see it in time / as a number</text>
      <rect x="570" y="82" width="180" height="46" rx="6" fill="var(--bg-panel)" stroke="var(--ch1-color)" />
      <text x="660" y="101" fill="var(--text-primary)" fontSize="12.5" fontWeight="700" textAnchor="middle">Spectrum · Network</text>
      <text x="660" y="118" fill="var(--text-secondary)" fontSize="11" textAnchor="middle">see it in frequency</text>
      <text x="660" y="16" fill="var(--text-secondary)" fontSize="11" textAnchor="middle">ADC in — volts → numbers (12-bit)</text>
    </svg>
  )
}

export default function Quickstart({ onGoTo, onLoadExample }: Props) {
  const [page, setPageRaw] = useState<PageId>(lastPage)
  const [, bump] = useState(0) // re-render after visitedStore mutates
  function setPage(p: PageId) {
    visitedStore.add(p)
    lastPage = p
    setPageRaw(p)
    bump((n) => n + 1)
  }
  const spineIdx = SPINE.indexOf(page)

  // ── the chapter pages (content reused from QS-1/QS-2, re-sequenced) ───────────────────────────

  function pageOrientation() {
    return (
      <>
        <h2 style={h2}>Welcome to BenchBridge</h2>
        <p style={{ marginTop: 4 }}>
          <b>A real electronics bench, simulated.</b> Power supplies, signal generators, an
          oscilloscope, meters and analyzers — the instruments you'd find at a lab bench, driving
          real circuit simulation (ngspice) in your browser.
        </p>
        <p style={{ marginTop: 8 }}>
          <b style={{ color: GOLD }}>The one big idea:</b> every panel here mirrors a real bench
          instrument, so everything you learn — wiring a probe, setting a trigger, reading a Bode
          plot — transfers directly to the hardware bench. It currently models the Analog Devices
          ADALM2000 (M2K) and its parts kit, the instrument used in EEC1.
        </p>
        <div style={card}><SignalFlow /></div>
        <p style={note}>
          That's the whole machine: <b>DAC out</b> (supplies + W1/W2) turns numbers into voltages,
          your circuit responds, and <b>ADC in</b> (scope, voltmeter, analyzers) turns voltages back
          into numbers. You'll be able to power and probe circuits, watch waveforms live, sweep
          filters, trace transistor curves — and then transfer a working design onto a breadboard
          and have the app <b>Check</b> your wiring.
        </p>
        <p style={{ ...note, marginTop: 8 }}>
          <b style={{ color: GOLD }}>To be clear:</b> this is a fast <b>simulation</b> — it is not
          connected to any physical M2K, and it's a place to learn and prepare, not a replacement
          for the bench or for Analog Devices' Scopy software.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button style={goBtn} onClick={() => setPage('first')}>Take the 5-minute tour →</button>
          <button style={secondaryBtn} onClick={() => setPage('bench')}>Jump to an instrument →</button>
        </div>
      </>
    )
  }

  function pageBench() {
    return (
      <>
        <h2 style={h2}>The bench at a glance</h2>
        <p style={{ marginTop: 4 }}>
          Each real instrument is a panel in the sidebar. Open any of them from here:
        </p>
        <div style={card}>
          {BRIDGE.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontSize: 13 }}>{b.real}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>→ {b.panel}</span>
              <button style={openBtn} onClick={() => onGoTo(b.id)}>Open</button>
            </div>
          ))}
        </div>
        <div style={card}><SignalFlow /></div>
        <p style={note}>
          <b style={{ color: GOLD }}>One thing the M2K trips people on:</b> W1 / W2 are <i>signal</i>{' '}
          outputs (≈ 50 Ω source resistance), not a power source — use the <b>V+ / V−</b> supply to
          power a circuit, and W1/W2 only to inject a signal. The twin models this 50 Ω, so a heavy
          load on W1/W2 sags here exactly as it would on the bench.
        </p>
      </>
    )
  }

  function pageFirst() {
    return (
      <>
        <h2 style={h2}>Your first measurement — a voltage divider</h2>
        <p style={{ marginTop: 4 }}>
          Pair the <b>Power Supply</b> with the <b>Voltmeter</b>: set a DC voltage, then read it. We
          will apply a voltage to two equal resistors and confirm the midpoint is exactly half.
        </p>
        <Step n={1}>
          <b>Load the voltage divider.</b> Two 10 kΩ resistors in series from V+ to ground, with
          the midpoint tapped. This drops it onto the canvas for you.
          <div style={{ marginTop: 8 }}>
            <button style={goBtn} onClick={() => { onLoadExample('divider'); onGoTo('schematic') }}>Load divider &amp; show circuit →</button>
          </div>
        </Step>
        <Step n={2}>
          <b>Set the supply.</b> Open the Power Supply — V+ is the applied voltage (it defaults to
          +5 V, the M2K's DAC-driven rail). On the real bench this is the red V+ wire.
          <div style={{ marginTop: 8 }}>
            <button style={goBtn} onClick={() => onGoTo('psu')}>Open Power Supply →</button>
          </div>
        </Step>
        <Step n={3}>
          <b>Read it.</b> Open the Voltmeter and press Measure. <b>Channel 2</b> reads the applied
          V+ (≈ 5 V); <b>Channel 1</b> reads the midpoint (≈ 2.5 V) — exactly half, because the two
          resistors are equal. Change V+ on the Power Supply and watch both readings track.
          <div style={{ marginTop: 8 }}>
            <button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open Voltmeter →</button>
          </div>
        </Step>

        <h3 style={{ color: '#2ee6ff', marginBottom: 6, marginTop: 24 }}>Why both channels read what they read</h3>
        <p style={{ marginTop: 0 }}>
          Every voltmeter and scope channel has <b>two</b> inputs, a{' '}
          <b style={{ color: 'var(--ch1-color)' }}>+</b> and a <b style={{ color: '#40c0e0' }}>−</b>,
          and both <b>float</b>: neither is ground until you wire it that way. Where you put the −
          lead decides which of two very different measurements you get.
        </p>
        <div style={card}>
          <svg viewBox="0 0 760 252" style={{ width: '100%', height: 'auto' }} role="img"
            aria-label="Left: single-ended measurement with the minus lead tied to ground reads one node relative to zero volts. Right: differential measurement with plus and minus across two live nodes reads their difference.">
            <line x1="380" y1="14" x2="380" y2="238" stroke="var(--border)" strokeWidth="1" />

            {/* ── Single-ended ── */}
            <text x="24" y="28" fill="var(--text-primary)" fontSize="15" fontWeight="700">Single-ended</text>
            <text x="24" y="46" fill="var(--text-secondary)" fontSize="12">− lead tied to GROUND</text>
            <circle cx="70" cy="150" r="4" fill="var(--text-primary)" />
            <text x="18" y="176" fill="var(--text-primary)" fontSize="12">node = −5 V</text>
            <line x1="70" y1="150" x2="225" y2="150" stroke="var(--ch1-color)" strokeWidth="2.5" />
            <text x="140" y="142" fill="var(--ch1-color)" fontSize="12" fontWeight="700">1+</text>
            <circle cx="255" cy="150" r="30" fill="var(--bg-panel)" stroke="var(--text-secondary)" strokeWidth="2" />
            <text x="255" y="157" fill="var(--text-primary)" fontSize="18" fontWeight="700" textAnchor="middle">V</text>
            <line x1="255" y1="180" x2="255" y2="204" stroke="#40c0e0" strokeWidth="2.5" />
            <text x="264" y="197" fill="#40c0e0" fontSize="12" fontWeight="700">1−</text>
            <line x1="243" y1="206" x2="267" y2="206" stroke="var(--text-secondary)" strokeWidth="2" />
            <line x1="247" y1="211" x2="263" y2="211" stroke="var(--text-secondary)" strokeWidth="2" />
            <line x1="251" y1="216" x2="259" y2="216" stroke="var(--text-secondary)" strokeWidth="2" />
            <text x="298" y="156" fill="var(--ch1-color)" fontSize="15" fontWeight="700">= −5 V</text>
            <text x="24" y="234" fill="var(--text-secondary)" fontSize="11.5">One node measured against 0 V.</text>

            {/* ── Differential ── */}
            <text x="404" y="28" fill="var(--text-primary)" fontSize="15" fontWeight="700">Differential</text>
            <text x="404" y="46" fill="var(--text-secondary)" fontSize="12">+ and − across two live nodes</text>
            <circle cx="470" cy="112" r="4" fill="var(--text-primary)" />
            <text x="414" y="116" fill="var(--text-primary)" fontSize="12">+5 V</text>
            <circle cx="470" cy="182" r="4" fill="var(--text-primary)" />
            <text x="414" y="186" fill="var(--text-primary)" fontSize="12">−5 V</text>
            <line x1="470" y1="112" x2="626" y2="136" stroke="var(--ch1-color)" strokeWidth="2.5" />
            <line x1="470" y1="182" x2="626" y2="164" stroke="#40c0e0" strokeWidth="2.5" />
            <text x="545" y="120" fill="var(--ch1-color)" fontSize="12" fontWeight="700">1+</text>
            <text x="545" y="182" fill="#40c0e0" fontSize="12" fontWeight="700">1−</text>
            <circle cx="656" cy="150" r="30" fill="var(--bg-panel)" stroke="var(--text-secondary)" strokeWidth="2" />
            <text x="656" y="157" fill="var(--text-primary)" fontSize="18" fontWeight="700" textAnchor="middle">V</text>
            <text x="656" y="212" fill="#40c0e0" fontSize="15" fontWeight="700" textAnchor="middle">= +10 V</text>
            <text x="404" y="234" fill="var(--text-secondary)" fontSize="11.5">The difference: 5 − (−5) = 10 V. No ground needed.</text>
          </svg>
        </div>
        <p style={note}>
          Both divider channels are <i>single-ended</i> — each reads one node relative to ground,
          because its <b>−</b> input is wired to ground. Move a <b>−</b> input onto another node
          instead and that channel becomes <i>differential</i>, reading the voltage between the two
          points. The diode I-V example uses a differential pair to read the voltage <i>across</i>{' '}
          the diode, which has neither end at ground.
        </p>
        <p style={{ fontSize: 12.5, color: '#ffbf00', marginTop: 8 }}>
          Always connect <b>both</b> inputs, on purpose. The − input is <b>not</b> internally grounded —
          leave it unconnected and the channel has no reference, so the reading is meaningless and just
          drifts on noise. Wire − explicitly every time: to <b>ground</b> for a single-ended reading, or
          to your <b>reference node</b> for a differential one.
        </p>
      </>
    )
  }

  function pageTourScope() {
    return (
      <>
        <h2 style={h2}>Tour: Signal Generator + Oscilloscope</h2>
        <p style={{ marginTop: 4 }}>
          The two <b>W</b> outputs are your signal sources; the Oscilloscope shows voltage <i>vs time</i>.
          Set a wave on W1, watch it on the scope — that is normal time-base (<b>YT</b>) mode, with
          Time/div setting the window and each channel its own Volts/div.
        </p>
        <Step n={1}>
          <b>Load a signal to work with.</b> The divider from the last step has no generator — this
          loads a W1-driven circuit (an RC filter) and opens the scope, so you have a live waveform.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('rc-lp'); onGoTo('scope') }}>Load a W1 signal → Oscilloscope →</button></div>
        </Step>
        <Step n={2}>
          <b>Set a signal.</b> Open the Signal Generator, pick a wave / frequency / amplitude on W1
          (W2 is the second source), and press Run.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('siggen')}>Open Signal Generator →</button></div>
        </Step>
        <Step n={3}>
          <b>See it in time.</b> Open the Oscilloscope — voltage vs time (YT). Time/div zooms the
          window; the trigger holds the wave steady.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('scope')}>Open Oscilloscope →</button></div>
        </Step>
        <Step n={4}>
          <b>Switch to XY — trace an I-V curve.</b> XY mode plots CH1 (X = voltage across the part)
          against CH2 (Y = its current), drawing the device's I-V curve directly. The <b>Zener</b> is
          the showcase: you see the forward turn-on (~0.7 V) <i>and</i> the reverse breakdown
          (~−3.3 V). This loads it straight into XY; use the scope's XY/YT toggle to switch back.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('zener-iv'); onGoTo('scope') }}>Load Zener I-V (XY) →</button></div>
        </Step>
      </>
    )
  }

  function pageTourSpectrum() {
    return (
      <>
        <h2 style={h2}>Tour: Spectrum — and how the M2K digitizes</h2>
        <p style={{ marginTop: 4 }}>
          Behind every reading is digitization: the M2K samples voltages with a <b>12-bit ADC</b>, and
          the Spectrum Analyzer shows levels in <b>dBFS</b> — decibels relative to <i>full scale</i>.
          <b> 0 dBFS</b> is the ADC's full-scale peak (here ±2.5 V). Rounding each sample to one of the
          ADC's steps adds a little noise, which sets a <i>floor</i> you cannot see below — and more bits
          push that floor down:
        </p>
        <div style={card}>
          <svg viewBox="0 0 760 244" style={{ width: '100%', height: 'auto' }} role="img"
            aria-label="dBFS scale: 0 dBFS is ADC full scale; the quantization noise floor sits near minus 104 dBFS at 12 bits, higher for fewer bits.">
            {/* axis + gridlines (0 to −120 dBFS) */}
            <text x="36" y="24" fill="var(--text-secondary)" fontSize="12">dBFS</text>
            {[0, -20, -40, -60, -80, -100, -120].map((db) => {
              const y = 34 + (-db) * 1.55
              return (
                <g key={db}>
                  <line x1="150" y1={y} x2="720" y2={y} stroke="var(--border)" strokeWidth="1" />
                  <text x="142" y={y + 4} fill="var(--text-secondary)" fontSize="11" textAnchor="end">{db}</text>
                </g>
              )
            })}
            {/* shaded unrecoverable region below the 12-bit floor */}
            <rect x="150" y={34 + 104 * 1.55} width="570" height={34 + 120 * 1.55 - (34 + 104 * 1.55)} fill="rgba(255,255,255,0.04)" />
            {/* 0 dBFS = full scale */}
            <line x1="150" y1="34" x2="720" y2="34" stroke="#ffbf00" strokeWidth="2.5" />
            <text x="156" y="28" fill="#ffbf00" fontSize="12" fontWeight="700">0 dBFS = ADC full scale (±2.5 V)</text>
            {/* a measured tone */}
            <line x1="300" y1={34 + 120 * 1.55} x2="300" y2={34 + 8 * 1.55} stroke="var(--ch1-color)" strokeWidth="3" />
            <circle cx="300" cy={34 + 8 * 1.55} r="4" fill="var(--ch1-color)" />
            <text x="310" y={34 + 8 * 1.55 + 4} fill="var(--ch1-color)" fontSize="12">a measured tone</text>
            {/* noise floors */}
            <line x1="150" y1={34 + 56 * 1.55} x2="720" y2={34 + 56 * 1.55} stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="6 4" />
            <text x="430" y={34 + 56 * 1.55 - 5} fill="var(--text-secondary)" fontSize="11.5">4-bit floor ≈ −56 dBFS</text>
            <line x1="150" y1={34 + 80 * 1.55} x2="720" y2={34 + 80 * 1.55} stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="6 4" />
            <text x="430" y={34 + 80 * 1.55 - 5} fill="var(--text-secondary)" fontSize="11.5">8-bit floor ≈ −80 dBFS</text>
            <line x1="150" y1={34 + 104 * 1.55} x2="720" y2={34 + 104 * 1.55} stroke="var(--theory-color)" strokeWidth="2.5" />
            <text x="410" y={34 + 104 * 1.55 - 5} fill="var(--theory-color)" fontSize="12" fontWeight="700">12-bit floor (this M2K) ≈ −104 dBFS</text>
          </svg>
        </div>
        <p style={note}>
          The gap between your tone and the floor is the dynamic range you actually have. The Spectrum
          Analyzer's <b>Learning Mode</b> lets you drop the bit depth to 8 or 4 and watch the floor rise —
          the clearest way to feel what "12-bit" buys you.
          <span style={{ display: 'block', marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('spectrum')}>Open Spectrum Analyzer →</button></span>
        </p>
      </>
    )
  }

  function pageTourNetwork() {
    return (
      <>
        <h2 style={h2}>Tour: Network Analyzer</h2>
        <p style={{ marginTop: 4 }}>
          The Network Analyzer sweeps frequency and plots gain (and phase) against it — a <b>Bode</b>{' '}
          plot. Load the RC low-pass and you will see it pass low frequencies and roll off above ~1 kHz
          (the −3 dB corner).
        </p>
        <Step n={1}>
          <b>Sweep a filter.</b> Load the RC low-pass and open the Network Analyzer to see its Bode curve.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('rc-lp'); onGoTo('network') }}>Load RC low-pass → Network Analyzer →</button></div>
        </Step>
      </>
    )
  }

  function pageTourTracer() {
    return (
      <>
        <h2 style={h2}>Tour: the Curve Tracer</h2>
        <p style={{ marginTop: 4 }}>
          A transistor isn't one number, it's a <i>family</i> of output curves. The Curve Tracer sweeps
          the drain/collector voltage and overlays one curve per gate/base step, so you read the device's
          character at a glance: a MOSFET's triode-to-saturation <b>I<sub>d</sub> vs V<sub>ds</sub></b> at
          each V<sub>gs</sub>, or a BJT's <b>I<sub>c</sub> vs V<sub>ce</sub></b> at each base step.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 8 }}>
          Under the hood it's the real bench trick: <b>W1</b> ramps the drain/collector voltage, <b>W2</b>{' '}
          sets a constant gate/base bias, and a <b>sense resistor</b> turns current into a voltage the ADC
          can read (I = V<sub>sense</sub> / R<sub>sense</sub>). The real M2K traces one curve at a time; the
          twin automates the stepped passes and draws the whole labelled family in one shot. Tune the
          <b> sweep max</b>, <b>ramp</b>, and <b>step list</b> to spread or add curves.
        </p>
        <Step n={1}>
          <b>Load the MOSFET family.</b> The <b>ZVN2110A</b> NMOS swept at five gate steps. This loads
          it and opens the Curve Tracer, where the family draws itself (auto-run).
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('nmos-curve-family'); onGoTo('curvetracer') }}>Load MOSFET curve family → Curve Tracer →</button></div>
        </Step>
        <Step n={2}>
          <b>Swap the device, retrace.</b> Load the <b>2N3904</b> NPN family and the same panel
          redraws as <b>I<sub>c</sub> vs V<sub>ce</sub></b>. That's the real payoff: change the
          transistor in any tracer circuit (W1 + W2 + sense resistor), retrace, and you immediately
          see how <i>that</i> part behaves.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('bjt-curve-family'); onGoTo('curvetracer') }}>Load BJT curve family → Curve Tracer →</button></div>
        </Step>
        <p style={{ fontSize: 12.5, color: '#ffbf00', marginTop: 10 }}>
          Mind the example names: <b>"MOSFET curve family"</b> and <b>"BJT curve family"</b> drive the
          Curve Tracer. The <b>"(XY)"</b> examples — "MOSFET output curve (XY)", "Diode I-V", "Zener I-V"
          — are Oscilloscope XY-mode demos that draw a <i>single</i> curve the live bench way, not the
          tracer. Same sense-resistor idea, different view.
        </p>
      </>
    )
  }

  function pageBuild() {
    return (
      <>
        <h2 style={h2}>Build it for real</h2>
        <p style={{ marginTop: 4 }}>
          So far you've loaded ready-made circuits. Now build one yourself: draw the M2K's two supply
          rails and measure them — single-ended first, then differential. The wiring you do here is
          the same wiring you'll repeat on the real bench, so this is the part worth practising:
          placing parts and connecting them, not just pressing a button.
        </p>
        <Step n={1}>
          <b>Open the Circuit editor.</b> You get an empty canvas. Along the top is a tool for
          each part you can place, plus <b>Select</b> (to pick up and move things) and <b>Wire</b>
          (to connect them).
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('schematic')}>Open Circuit editor →</button></div>
        </Step>
        <Step n={2}>
          <b>Place the supply ports.</b> Click the <b style={{ color: '#e04040' }}>V+</b> tool,
          then click the canvas to drop it. Do the same for <b style={{ color: '#4a9eff' }}>V−</b>
          and <b>GND</b>. These are the M2K's power-supply rails and its ground.
        </Step>
        <Step n={3}>
          <b>Place the four probe ports.</b> Drop <b style={{ color: 'var(--ch1-color)' }}>1+</b>,
          <b style={{ color: '#40c0e0' }}> 1−</b>, <b style={{ color: 'var(--ch1-color)' }}>2+</b>,
          <b style={{ color: '#40c0e0' }}> 2−</b> — each is one half of a voltmeter channel.
        </Step>
        <Step n={4}>
          <b>Wire it (single-ended).</b> Pick the <b>Wire</b> tool and connect{' '}
          <b style={{ color: 'var(--ch1-color)' }}>1+</b> → the <b style={{ color: '#e04040' }}>V+</b> node,
          <b style={{ color: '#40c0e0' }}> 1−</b> → <b>GND</b>,
          <b style={{ color: 'var(--ch1-color)' }}> 2+</b> → the <b style={{ color: '#4a9eff' }}>V−</b> node,
          and <b style={{ color: '#40c0e0' }}>2−</b> → <b>GND</b>. A <b>junction dot</b> appears at
          each connection — that's your confirmation the wire took.
        </Step>
        <Step n={5}>
          <b>Set the supply.</b> Open the Power Supply (independent mode) and set
          <b style={{ color: '#e04040' }}> V+</b> and <b style={{ color: '#4a9eff' }}>V−</b> to the
          values you want — say +5 V and −5 V.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('psu')}>Open Power Supply →</button></div>
        </Step>
        <Step n={6}>
          <b>Read it.</b> Open the Voltmeter and press Measure. <b>Channel 1</b> = V(1+) − V(1−) =
          V+; <b>Channel 2</b> = V−. Both are single-ended, because each <b>−</b> input sits on
          ground.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open Voltmeter →</button></div>
        </Step>
        <Step n={7}>
          <b>Make Channel 1 differential.</b> Move the <b style={{ color: '#40c0e0' }}>1−</b> input
          off ground and onto the <b style={{ color: '#4a9eff' }}>V−</b> node: with <b>Select</b>,
          click its wire to <b>GND</b> and delete it, then use <b>Wire</b> to connect
          <b style={{ color: '#40c0e0' }}> 1−</b> straight to <b style={{ color: '#4a9eff' }}>V−</b>.
          Measure again — Channel 1 now reads <b>V+ − V−</b> (the full ±span), while Channel 2 still
          reads V− alone. This is the identical lead move you'll make on the real M2K.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('schematic')}>Back to Circuit editor →</button></div>
        </Step>
        <Step n={8}>
          <b>Save it for your records.</b> In the Voltmeter, press <b>Export PNG</b> to save the
          readings (title and per-channel labels are included). Annotate your name on top, the same
          way you would a bench screenshot, and submit it.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open Voltmeter →</button></div>
        </Step>

        <h3 style={{ color: '#2ee6ff', marginBottom: 6, marginTop: 24 }}>Then: from simulation to the breadboard</h3>
        <p style={{ marginTop: 0 }}>
          Draw a circuit and the app simulates it (real ngspice), so every instrument measures{' '}
          <i>your</i> design. Once it works in simulation, move it to the Breadboard and press{' '}
          <b>Check</b> — the app verifies your physical layout is electrically the same as the
          schematic. Practice mode colours the nets live as you wire; Bench mode hides the hints,
          like the real bench.
        </p>
        <Step n={1}>
          <b>Draw &amp; simulate.</b> Open the Circuit editor, build (or load an example), and the
          instruments read it live. Parts connect where their pins meet a wire or another pin —
          a small <b>dot</b> marks every connected node, so you can see what's joined. Tip: when
          two pins should connect, run a <b>wire</b> between them (drag a part and its wires
          follow); just touching also connects, and dragging the part later keeps that link.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('schematic')}>Open Circuit editor →</button></div>
        </Step>
        <Step n={2}>
          <b>Transfer &amp; check.</b> Open the Breadboard, place the same parts, and press Check to
          confirm your layout matches the schematic before you build it for real.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('breadboard')}>Open Breadboard →</button></div>
        </Step>
        <p style={note}>
          That's the whole loop: place parts, wire them, power them, measure, then change the wiring
          to change the measurement — and finally prove the physical layout with Check.
        </p>
      </>
    )
  }

  function pageNext() {
    return (
      <>
        <h2 style={h2}>Where next</h2>
        <p style={{ marginTop: 4 }}>
          Everything on the bench loads from the <b>Examples</b> menu in the Circuit editor — filters,
          amplifiers, diode curves, transistor families. A few good jumping-off points:
        </p>
        <div style={card}>
          {[
            { id: 'divider', label: 'Voltage divider (÷2)', go: 'voltmeter', desc: 'the quick win, again' },
            { id: 'rc-lp', label: 'RC low-pass (~1 kHz)', go: 'network', desc: 'Bode plot + −3 dB corner' },
            { id: 'led-pwm', label: 'PWM-driven LED', go: 'breadboard', desc: 'board glow follows duty cycle' },
            { id: 'inv-amp', label: 'Inverting amp ×−2 (OP484)', go: 'scope', desc: 'first op-amp circuit' },
            { id: 'zener-iv', label: 'Zener I-V curve (XY)', go: 'scope', desc: 'forward turn-on + breakdown' },
            { id: 'nmos-curve-family', label: 'MOSFET curve family', go: 'curvetracer', desc: 'the whole device character' },
          ].map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontSize: 13 }}><b>{e.label}</b> — {e.desc}</span>
              <button style={openBtn} onClick={() => { onLoadExample(e.id); onGoTo(e.go) }}>Load</button>
            </div>
          ))}
        </div>
        <p style={note}>
          More on the real instrument: the{' '}
          <a href="https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm2000.html" target="_blank" rel="noopener noreferrer" style={link}>ADALM2000 product page</a>.
          Credits and licences are under <b>About</b> in the sidebar.
        </p>
      </>
    )
  }

  const PAGE_RENDER: Record<PageId, () => ReactNode> = {
    orientation: pageOrientation, bench: pageBench, first: pageFirst,
    'tour-scope': pageTourScope, 'tour-spectrum': pageTourSpectrum,
    'tour-network': pageTourNetwork, 'tour-tracer': pageTourTracer,
    build: pageBuild, next: pageNext,
  }

  // ── the chapter menu (doubles as the progress indicator) ──────────────────────────────────────
  function menuItem(c: (typeof CHAPTERS)[number]) {
    const current = page === c.id
    const seen = visitedStore.has(c.id)
    return (
      <button key={c.id} onClick={() => setPage(c.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
          padding: c.sub ? '5px 8px 5px 22px' : '6px 8px', fontSize: c.sub ? 12 : 12.5,
          background: current ? 'rgba(255,191,0,0.14)' : 'transparent',
          border: 'none', borderLeft: current ? `3px solid ${GOLD}` : '3px solid transparent',
          color: current ? GOLD : seen ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontWeight: current ? 700 : 500, cursor: 'pointer', borderRadius: 3,
        }}>
        <span style={{ flex: 1 }}>{c.title}</span>
        {seen && !current && <span style={{ color: 'var(--theory-color)', fontSize: 11 }}>✓</span>}
        {c.time && <span style={{ color: 'var(--text-secondary)', fontSize: 10.5 }}>{c.time}</span>}
      </button>
    )
  }

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header"><span className="display-title">Quickstart</span></div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* chapter menu rail */}
          <nav style={{ width: 200, flex: '0 0 auto', overflowY: 'auto', padding: '14px 6px', borderRight: '1px solid var(--border)' }}>
            {CHAPTERS.filter((c) => !c.sub).map((c) => (
              c.id === 'build'
                ? [
                    <div key="tour-head" style={{ padding: '8px 8px 2px', fontSize: 11, letterSpacing: 0.6, color: 'var(--text-secondary)', textTransform: 'uppercase' as const }}>
                      Tour the bench
                    </div>,
                    ...CHAPTERS.filter((s) => s.sub).map(menuItem),
                    menuItem(c),
                  ]
                : menuItem(c)
            ))}
          </nav>
          {/* one chapter at a time */}
          <div key={page} style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 'clamp(14px, 2.5vw, 24px)', lineHeight: 1.65, color: 'var(--text-primary)' }}>
            <div style={{ maxWidth: 860 }}>
              {PAGE_RENDER[page]()}
              {/* Next/Back — the guided-tour spine */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {spineIdx > 0
                  ? <button style={secondaryBtn} onClick={() => setPage(SPINE[spineIdx - 1])}>← {CHAPTERS.find((c) => c.id === SPINE[spineIdx - 1])!.title}</button>
                  : <span />}
                {spineIdx < SPINE.length - 1
                  ? <button style={goBtn} onClick={() => setPage(SPINE[spineIdx + 1])}>{CHAPTERS.find((c) => c.id === SPINE[spineIdx + 1])!.title} →</button>
                  : <span />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
