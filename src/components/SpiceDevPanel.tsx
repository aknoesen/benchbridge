// SPICE-1 dev affordance — throwaway proof that ngspice-WASM loads in a Worker and
// simulates. Gated behind SHOW_SPICE_DEV in App.tsx; remove/replace when LOOP-1 builds
// the real circuit UI. See docs/specs/schematic-ngspice.md.
import { useEffect, useRef, useState } from 'react'
import { createSpiceEngine, SpiceEngine, SimResult, SimColumn } from '../core/spice'
import './Instrument.css'

// RC low-pass, fc = 1/(2*pi*R*C) = 1/(2*pi*1k*159.155n) ≈ 1000 Hz.
const RC_NETLIST = `RC low-pass (SPICE-1 dev check)
V1 in 0 AC 1
R1 in out 1k
C1 out 0 159.155n
.ac dec 20 10 1meg
.end`

function col(r: SimResult, pred: (name: string) => boolean): SimColumn | null {
  const i = r.variables.findIndex((v) => pred(v.name.toLowerCase()))
  return i >= 0 ? r.columns[i] : null
}

function describe(r: SimResult): string {
  const lines: string[] = []
  lines.push(`analysis=${r.analysis}  points=${r.numPoints}`)
  lines.push(`vars: ${r.variables.map((v) => v.name).join(', ')}`)
  const freq = col(r, (n) => n === 'frequency')
  const out = col(r, (n) => n.includes('out'))
  if (freq && out && freq.kind === 'complex' && out.kind === 'complex') {
    const f = freq.re
    const db = Array.from(out.mag, (m) => 20 * Math.log10(m))
    let cutoff: number | null = null
    for (let i = 1; i < db.length; i++) {
      if (db[i - 1] >= -3 && db[i] < -3) {
        cutoff = f[i]
        break
      }
    }
    lines.push(`DC gain: ${db[0].toFixed(2)} dB`)
    lines.push(`-3 dB cutoff: ${cutoff ? cutoff.toFixed(1) + ' Hz (expected ~1000)' : 'not found'}`)
  }
  return lines.join('\n')
}

export default function SpiceDevPanel() {
  const engineRef = useRef<SpiceEngine | null>(null)
  const [status, setStatus] = useState('idle')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    engineRef.current = createSpiceEngine()
    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  async function runRC() {
    setBusy(true)
    setStatus('running ngspice (WASM) in worker…')
    setSummary('')
    const t0 = performance.now()
    try {
      const r = await engineRef.current!.run(RC_NETLIST)
      const dt = (performance.now() - t0).toFixed(0)
      setSummary(describe(r))
      setStatus(`done in ${dt} ms`)
    } catch (e) {
      setSummary(e instanceof Error ? e.message : String(e))
      setStatus('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">SPICE engine check (SPICE-1 dev)</span>
        </div>
        <div style={{ padding: 16, color: 'var(--text-primary)', overflow: 'auto' }}>
          <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: 12 }}>
            Runs a hardcoded RC low-pass AC sweep through ngspice (WebAssembly) in a Web
            Worker, then reads the −3 dB cutoff from the result. Proves the engine pipeline.
          </p>
          <button className="run-btn" onClick={runRC} disabled={busy}>
            {busy ? 'Running…' : 'Run RC sweep'}
          </button>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--accent-blue)' }}>{status}</div>
          <pre
            style={{
              marginTop: 12,
              padding: 10,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              color: 'var(--text-primary)',
            }}
          >
            {summary || '(no result yet)'}
          </pre>
          <details style={{ marginTop: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
            <summary>netlist</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{RC_NETLIST}</pre>
          </details>
        </div>
      </div>
    </div>
  )
}
