import { describe, it, expect } from 'vitest'
import { captureWindow, voltsAxisRange, SCOPE_H_DIVS } from './scope'

const Fs = 100000

function samples(n: number) {
  const t = new Float64Array(n)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) { t[i] = i / Fs; x[i] = Math.sin((2 * Math.PI * 1000 * i) / Fs) }
  return { t, x }
}

describe('captureWindow', () => {
  it('captures a 10-div window at 1 ms/div (period of 1 kHz spans exactly one division)', () => {
    const s = samples(1600) // 16 ms capture
    const tr = captureWindow(s, Fs, 0.001) // 10 ms window
    expect(tr.t.length).toBe(1000)          // 10 ms * 100 kSa/s
    expect(tr.t[0]).toBe(0)
    expect(tr.t[tr.t.length - 1]).toBeCloseTo(0.00999, 6)
    // 1 kHz period = 1 ms = one division; window holds SCOPE_H_DIVS periods
    const windowSec = SCOPE_H_DIVS * 0.001
    expect(windowSec).toBeCloseTo(0.01, 9)
  })

  it('downsamples to <= maxPoints', () => {
    const s = samples(5000)
    const tr = captureWindow(s, Fs, 0.003) // 30 ms → 3000 samples, stride 2 → 1500 pts
    expect(tr.v.length).toBeLessThanOrEqual(2000)
    expect(tr.v.length).toBe(1500)
  })

  it('voltsAxisRange is symmetric ±(V_DIVS/2)*vpd', () => {
    expect(voltsAxisRange(0.5)).toEqual([-2, 2])
    expect(voltsAxisRange(1)).toEqual([-4, 4])
  })
})
