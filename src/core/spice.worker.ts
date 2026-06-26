// Web Worker — hosts eecircuit-engine (ngspice-WASM). Keeps the ~20 MB engine and all
// simulation work off the main thread. See docs/specs/schematic-ngspice.md (SPICE-1).

import { Simulation } from 'eecircuit-engine'
import { normalizeResult } from './spice'

// Typed as Worker (not Window) so postMessage(message) has the correct 1-arg signature.
const ctx: Worker = self as unknown as Worker

let sim: Simulation | null = null
let starting: Promise<void> | null = null

// Lazily construct + start the engine once; subsequent calls await the same promise.
async function ensureStarted(): Promise<Simulation> {
  if (!starting) {
    const s = new Simulation()
    starting = s.start().then(() => {
      sim = s
    })
  }
  await starting
  if (!sim) throw new Error('SPICE engine failed to initialise')
  return sim
}

interface RunRequest {
  id: number
  netlist: string
}

ctx.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { id, netlist } = e.data
  try {
    const s = await ensureStarted()
    s.setNetList(netlist)
    const raw = await s.runSim()
    ctx.postMessage({ id, ok: true, result: normalizeResult(raw) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.postMessage({ id, ok: false, error: message })
  }
}
