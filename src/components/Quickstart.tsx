// Quickstart panel (Track H / QS-4) — paginated, orientation-first onboarding, carrying the
// FINISHED andre-approved copy (docs/specs/quickstart-copy.md): 11 course-neutral pages, one action
// per page, every instrument step a do-this/watch-that loop. A chapter menu drives a
// one-page-at-a-time view (no long scroll); Next/Back walk the spine; the menu doubles as the
// progress indicator. The two teaching SVGs (single-ended/differential, dBFS) are reused from
// QS-1/QS-2 per spec. Step buttons drive the app (load example + jump to instrument). FROZEN for
// the beta — copy/structure changes go through the handoff log. Static content only; touches no
// core/ signal math. See docs/specs/quickstart-redesign.md.
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
  | 'orientation' | 'bench' | 'flashlight' | 'divider' | 'signal'
  | 'rc-time' | 'rc-freq' | 'opamps' | 'iv' | 'build' | 'next'

// The guided-tour spine: Next/Back walk this order; the menu can jump anywhere.
const SPINE: PageId[] = ['orientation', 'bench', 'flashlight', 'divider', 'signal', 'rc-time', 'rc-freq', 'opamps', 'iv', 'build', 'next']

const CHAPTERS: { id: PageId; title: string; time?: string }[] = [
  { id: 'orientation', title: 'Welcome', time: '~1 min' },
  { id: 'bench', title: 'The bench at a glance', time: '~1 min' },
  { id: 'flashlight', title: 'Build a flashlight', time: '~2 min' },
  { id: 'divider', title: 'The voltage divider', time: '~2 min' },
  { id: 'signal', title: 'Make a signal', time: '~2 min' },
  { id: 'rc-time', title: 'An RC, in time', time: '~2 min' },
  { id: 'rc-freq', title: 'The same RC, in frequency', time: '~2 min' },
  { id: 'opamps', title: 'An op-amp', time: '~2 min' },
  { id: 'iv', title: 'I-V curves', time: '~2 min' },
  { id: 'build', title: 'Build it for real', time: '~3 min' },
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
const goBtn: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#022851', background: GOLD, border: 'none', borderRadius: 6, cursor: 'pointer' }
const openBtn: CSSProperties = { padding: '3px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }
const secondaryBtn: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }
const note: CSSProperties = { fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 10 }
const btnRow: CSSProperties = { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }

// A do-this / watch-that beat: bold action, consequence, then the action button(s).
function Beat({ children }: { children: ReactNode }) {
  return <div style={card}>{children}</div>
}

// real M2K signal/instrument  ↔  this app's panel
const BRIDGE: { real: string; panel: string; id: string }[] = [
  { real: 'Signal generator — W1 / W2 outputs (DAC)', panel: 'Signal Gen', id: 'siggen' },
  { real: 'Oscilloscope — voltage vs time', panel: 'Scope', id: 'scope' },
  { real: 'Spectrum analyzer — frequency content', panel: 'Spectrum', id: 'spectrum' },
  { real: 'Network analyzer — gain/phase vs frequency (Bode)', panel: 'Network', id: 'network' },
  { real: 'Voltmeter — two 12-bit ADC channels (1±, 2±)', panel: 'Voltmeter', id: 'voltmeter' },
  { real: 'Power supply — V+ / V− rails, 0..±5 V (DAC-driven)', panel: 'Supply', id: 'psu' },
  { real: 'Solderless breadboard + circuit', panel: 'Circuit / Board', id: 'schematic' },
]

// The one signal-flow picture: sources (DAC out) → your circuit → readers (ADC in).
function SignalFlow() {
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

  // ── the chapter pages — the finished copy from docs/specs/quickstart-copy.md ──────────────────

  function pageOrientation() {
    return (
      <>
        <h2 style={h2}>BenchBridge is a real electronics bench — simulated.</h2>
        <p style={{ marginTop: 6 }}>
          Design a circuit, measure it on a full set of instruments, build it on a breadboard, and
          check your wiring, all in your browser, nothing to install. It runs a fast, faithful
          simulation (real SPICE under the hood), so what you learn here transfers straight to the
          hardware. A place to design, learn, and prepare — not a replacement for the bench.
        </p>
        <div style={card}><SignalFlow /></div>
        <p style={note}>
          Signal flow — the sources (W1/W2, supply) drive your circuit; the scope and meter read it back.
        </p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => setPage('flashlight')}>Take the 5-minute tour →</button>
          <button style={secondaryBtn} onClick={() => setPage('bench')}>Jump to an instrument →</button>
        </div>
      </>
    )
  }

  function pageBench() {
    return (
      <>
        <h2 style={h2}>The bench at a glance</h2>
        <p style={{ marginTop: 6 }}>Every panel here mirrors a real instrument:</p>
        <div style={card}>
          {BRIDGE.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontSize: 13 }}>{b.real}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>→ {b.panel}</span>
              <button style={openBtn} onClick={() => onGoTo(b.id)}>Open</button>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 12 }}>
          Signals flow one way: the <b>sources</b> drive your circuit, the <b>scope and meter</b>{' '}
          read it back. You wire your circuit in between. Ready?
        </p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => setPage('flashlight')}>Start the tour →</button>
        </div>
      </>
    )
  }

  function pageFlashlight() {
    return (
      <>
        <h2 style={h2}>Build a flashlight</h2>
        <p style={{ marginTop: 6 }}>
          The simplest useful circuit: the <b>power supply</b>, a resistor, an LED — steady DC.
        </p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => { onLoadExample('flashlight'); onGoTo('breadboard') }}>Load the flashlight →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>→ opens the <b>Breadboard</b>, already built, with the <b>LED lit</b> on the real board.</span>
        </div>
        <p style={{ marginTop: 12 }}>
          <b>Now make it a measurement, not just a light.</b> How bright <i>is</i> really how much{' '}
          <b>current</b> — but the bench never hands you current directly. <b>Hover any point on the
          board</b> and it shows that node's <b>voltage</b> (like touching a DMM probe there); to
          find the current you measure a voltage and compute it.
        </p>
        <Beat>
          <b>Read the resistor's voltage on the Voltmeter.</b> <b>CH1 is already wired across the
          resistor</b> and reads the drop, about <b>3 V</b>. (Both of CH1's leads sit on live nodes,
          neither at ground — that's a <i>differential</i> measurement, and the Voltmeter does it
          for you. Single- vs differential is the next page.)
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open the Voltmeter →</button></div>
        </Beat>
        <Beat>
          <b>Calculate the current.</b> Ohm's law: <b>I = V / R = 3 V / 470 Ω ≈ 6 mA</b> — the same
          current the LED was showing. <b>That current is what lights it.</b> You've tied a glowing
          LED to a number you measured.
        </Beat>
        <p style={note}>
          It's steady DC — no signal generator, and the scope would just show a flat line, so we use
          the Voltmeter.
        </p>
      </>
    )
  }

  function pageDivider() {
    return (
      <>
        <h2 style={h2}>The voltage divider</h2>
        <p style={{ marginTop: 6 }}>
          Two resistors in series split the supply — the bigger one drops more.
        </p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => { onLoadExample('divider'); onGoTo('schematic') }}>Load the divider →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>→ here the <b>bottom</b> resistor is <b>twice</b> the top one (20 kΩ over 10 kΩ).</span>
        </div>
        <div style={{ ...btnRow, marginTop: 10 }}>
          <button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open the Voltmeter →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>and read the two channels — they're already wired:</span>
        </div>
        <Beat>
          <b>CH2 — single-ended</b> (the midpoint, referenced to GND): about <b>3.3 V</b>. That's
          the divider's output — the bottom resistor is 2/3 of the total resistance, so it drops
          2/3 of the 5 V. One lead sits at ground.
        </Beat>
        <Beat>
          <b>CH1 — differential</b> (across the <i>top</i> resistor: V+ minus the midpoint): about{' '}
          <b>1.7 V</b> — the drop across the top resistor. Both leads sit on live nodes, neither at
          ground.
        </Beat>
        <p style={{ marginTop: 12 }}>
          <b>Two different numbers, because they're two different kinds of measurement:</b>{' '}
          single-ended reads a node <i>against ground</i>; differential reads the <i>difference
          between two live nodes</i>. (We used <b>unequal</b> resistors on purpose — equal ones make
          both channels read the same and hide the whole point.)
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
      </>
    )
  }

  function pageSignal() {
    return (
      <>
        <h2 style={h2}>Make a signal, see it in frequency</h2>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => { onLoadExample('signal-sine'); onGoTo('scope') }}>Load a signal →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>→ a clean sine on the scope, one trace.</span>
        </div>
        <p style={note}>
          (The signal is already live — the Signal Generator's button just toggles Stop/Run. <b>W1</b>{' '}
          is your signal; <b>W2</b> is the second source, idle here.)
        </p>
        <Beat>
          <b>Change it and watch.</b> Drag the frequency up — the wave's period shrinks. Switch to a
          square wave.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('siggen')}>Open the Signal Generator →</button></div>
        </Beat>
        <Beat>
          <b>See it in frequency.</b> A sine is a single peak; a square wave sprouts a comb of
          harmonics.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('spectrum')}>Open the Spectrum →</button></div>
        </Beat>
        <Beat>
          <b>How the bench digitizes.</b> The instrument samples with a 12-bit ADC; those finite
          steps set a <b>noise floor</b> — the flat "grass" near the bottom of the plot. Drop the bit
          depth and watch the floor rise. (dBFS = decibels below full-scale.)
        </Beat>
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
            <text x="410" y={34 + 104 * 1.55 - 5} fill="var(--theory-color)" fontSize="12" fontWeight="700">12-bit floor (this bench) ≈ −104 dBFS</text>
          </svg>
        </div>
      </>
    )
  }

  function pageRcTime() {
    return (
      <>
        <h2 style={h2}>An RC, in time</h2>
        <p style={{ marginTop: 6 }}>
          Now a part whose behaviour depends on <i>how fast</i> the signal changes.
        </p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => { onLoadExample('rc-lp'); onGoTo('scope') }}>Load the RC →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>→ a square wave in, a <b>rounded</b> output (two traces: the drive and the output).</span>
        </div>
        <Beat>
          <b>Watch the lag.</b> The output can't jump — it charges and discharges. Slow the frequency
          and the curve fills out; speed it up and the output barely moves.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('scope')}>Open the Oscilloscope →</button></div>
        </Beat>
        <p style={{ marginTop: 12 }}>
          The time it takes is the <b>time constant, τ = R·C</b> — the circuit's memory, seen in time.
        </p>
      </>
    )
  }

  function pageRcFreq() {
    return (
      <>
        <h2 style={h2}>The same RC, in frequency</h2>
        <p style={{ marginTop: 6 }}>The exact same circuit, now swept across frequency.</p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => { onLoadExample('rc-lp'); onGoTo('network') }}>Load the RC sweep →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>→ a Bode plot: flat, then rolling off.</span>
        </div>
        <Beat>
          <b>Find the corner.</b> Low frequencies pass, high ones are cut. The knee — the{' '}
          <b>−3 dB cutoff</b> — is where τ shows up as a frequency: <b>f<sub>c</sub> = 1 / (2πRC)</b>.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('network')}>Open the Network analyzer →</button></div>
        </Beat>
        <p style={{ marginTop: 12 }}>
          Same circuit, two views: <b>τ in time, f<sub>c</sub> in frequency — the same fact.</b>
        </p>
      </>
    )
  }

  function pageOpamps() {
    return (
      <>
        <h2 style={h2}>An op-amp</h2>
        <p style={{ marginTop: 6 }}>An op-amp trades a resistor ratio for gain.</p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => { onLoadExample('inv-amp'); onGoTo('scope') }}>Load the inverting amp →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>→ a small input, a bigger, flipped output (two traces).</span>
        </div>
        <Beat>
          <b>Read the gain.</b> It's set by two resistors: <b>−R<sub>f</sub>/R<sub>in</sub></b>.
          Change R<sub>in</sub> and watch the output grow or shrink. Push the input too far and the
          output flattens — it's hit the supply rails.
          <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('scope')}>Open the Oscilloscope →</button></div>
        </Beat>
      </>
    )
  }

  function pageIv() {
    return (
      <>
        <h2 style={h2}>I-V curves</h2>
        <p style={{ marginTop: 6 }}>
          Not every part obeys Ohm's law. See a device's character directly.
        </p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => { onLoadExample('diode-iv'); onGoTo('scope') }}>Load the diode I-V →</button>
          <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>→ in <b>XY mode</b> the scope plots current vs voltage: a diode's forward knee, a Zener's reverse breakdown.</span>
        </div>
        <Beat>
          A resistor's I-V is a straight line; a diode's bends. <b>That shape <i>is</i> the device.</b>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={goBtn} onClick={() => { onLoadExample('zener-iv'); onGoTo('scope') }}>Open the Oscilloscope (XY) →</button>
            <button style={goBtn} onClick={() => { onLoadExample('nmos-curve-family'); onGoTo('curvetracer') }}>Open the Curve Tracer →</button>
          </div>
        </Beat>
      </>
    )
  }

  function pageBuild() {
    return (
      <>
        <h2 style={h2}>Build it for real</h2>
        <p style={{ marginTop: 6 }}>Everything so far was a schematic. Now bridge to hardware.</p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => onGoTo('breadboard')}>Open the Breadboard →</button>
        </div>
        <p style={{ marginTop: 12 }}>
          Place the same parts, wire them, and press <b>Check</b> — the board tells you whether your
          wiring is electrically the schematic. <i>Practice</i> mode colours the nodes as you go;{' '}
          <i>Bench</i> mode hides them so you build from your own understanding, then verify.
        </p>
        <p style={{ marginTop: 8 }}>
          <b>This is the part no simulator does: design it, then build it and prove your board matches.</b>
        </p>
      </>
    )
  }

  function pageNext() {
    return (
      <>
        <h2 style={h2}>Where next</h2>
        <p style={{ marginTop: 6 }}>You've seen the whole bench. Now make something yours.</p>
        <div style={btnRow}>
          <button style={goBtn} onClick={() => onGoTo('schematic')}>Open the Circuit editor →</button>
          <button style={secondaryBtn} onClick={() => onGoTo('about')}>About / credits</button>
        </div>
        <p style={{ marginTop: 12 }}>Draw your own, or load any example to explore:</p>
        <div style={card}>
          {/* the four strongest, spanning the range (andre: trim to four): a passive filter, an
              op-amp, an I-V/XY curve, and the curve-family showpiece */}
          {[
            { id: 'rc-lp', label: 'RC low-pass (~1 kHz)', go: 'network', desc: 'Bode plot + −3 dB corner' },
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
          More on the modelled instrument: the{' '}
          <a href="https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm2000.html" target="_blank" rel="noopener noreferrer" style={link}>ADALM2000 product page</a>.
        </p>
      </>
    )
  }

  const PAGE_RENDER: Record<PageId, () => ReactNode> = {
    orientation: pageOrientation, bench: pageBench, flashlight: pageFlashlight,
    divider: pageDivider, signal: pageSignal,
    'rc-time': pageRcTime, 'rc-freq': pageRcFreq,
    opamps: pageOpamps, iv: pageIv, build: pageBuild, next: pageNext,
  }

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header"><span className="display-title">Quickstart</span></div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* chapter menu rail — doubles as the progress indicator */}
          <nav style={{ width: 200, flex: '0 0 auto', overflowY: 'auto', padding: '14px 6px', borderRight: '1px solid var(--border)' }}>
            {CHAPTERS.map((c) => {
              const current = page === c.id
              const seen = visitedStore.has(c.id)
              return (
                <button key={c.id} onClick={() => setPage(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                    padding: '6px 8px', fontSize: 12.5,
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
            })}
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
