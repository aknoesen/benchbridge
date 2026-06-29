import { describe, it, expect } from 'vitest'
import {
  generateSignal, computeSpectrum, snapDuration, safeFrequency, MIN_FREQUENCY,
  type SignalParams, type SpectrumResult,
} from './signal'

// SIG-1: the acquisition sample-rate presets surfaced in the Spectrum Analyzer. Each keeps Fs/f an
// integer for the 1 kHz demo signal, so every component lands on an exact bin (zero leakage).
const FS_PRESETS = [5000, 10000, 20000, 50000, 100000, 200000]

const base = (over: Partial<SignalParams>): SignalParams => ({
  waveType: 'sine', frequency: 1000, amplitude: 1, offset: 0,
  dutyCycle: 50, samplingRate: 100000, duration: 0.016, ...over,
})

const spectrumOf = (p: SignalParams, bits = 12): SpectrumResult =>
  computeSpectrum(generateSignal(p).x, p.samplingRate, bits, 5, 'hanning')

function argmax(a: Float64Array, from = 0): number {
  let mi = from, mv = -Infinity
  for (let i = from; i < a.length; i++) if (a[i] > mv) { mv = a[i]; mi = i }
  return mi
}

// Largest amplitude (dBFS) in any bin that is NOT within `guardBins` of a real/aliased component
// and not DC. With exact bin-landing + the periodic Hanning kernel, those bins carry only the
// synthetic noise floor; spectral leakage (a non-integer landing) would push them to −20…−50 dBFS.
function maxLeakageDbfs(res: SpectrumResult, peaksHz: number[], guardBins = 2): number {
  const bw = res.binWidthHz
  let mx = -Infinity
  for (let i = 1; i < res.freqAxis.length; i++) {
    const f = res.freqAxis[i]
    if (peaksHz.some((p) => Math.abs(f - p) <= (guardBins + 0.5) * bw)) continue
    if (res.magnitudeDbfs[i] > mx) mx = res.magnitudeDbfs[i]
  }
  return mx
}

describe('SIG-1 — 12-bit canary at the default 100 kSa/s', () => {
  it('square 1 kHz / 16 ms / 100 kSa/s / Hanning → N=1600, floor ≈ −104 dBFS, no inter-harmonic leakage', () => {
    const p = base({ waveType: 'square', frequency: 1000, samplingRate: 100000 })
    expect(snapDuration(p.duration, p.frequency, p.samplingRate)).toBe(1600)

    const res = spectrumOf(p, 12)
    // The canonical canary value (see CLAUDE.md): −10·log10(1600) − 12·6.021 + 0 ≈ −104.29 dBFS.
    expect(res.noiseFloorDbfs).toBeGreaterThan(-104.5)
    expect(res.noiseFloorDbfs).toBeLessThan(-104.0)

    // Odd harmonics only for a 50% square; every harmonic lands on an exact bin, so the even-harmonic
    // and other inter-harmonic bins are noise only — far below any leakage level.
    const harmonics: number[] = []
    for (let n = 1; n * 1000 < p.samplingRate / 2; n += 2) harmonics.push(n * 1000)
    expect(maxLeakageDbfs(res, harmonics, 2)).toBeLessThan(-60)
  })
})

describe('SIG-1 — zero inter-harmonic leakage at every Fs preset', () => {
  it('a 1 kHz sine lands on an exact bin (freq = 1000 Hz) with noise-only neighbours at each preset', () => {
    for (const fs of FS_PRESETS) {
      const p = base({ waveType: 'sine', frequency: 1000, samplingRate: fs })
      const res = spectrumOf(p, 12)

      const peakIdx = argmax(res.magnitudeDbfs, 1)
      expect(res.freqAxis[peakIdx]).toBeCloseTo(1000, 3) // exact integer bin → exactly 1 kHz

      // single tone → everything except the fundamental is the synthetic floor, never leakage
      expect(maxLeakageDbfs(res, [1000], 2)).toBeLessThan(-60)
    }
  })
})

describe('SIG-1 — aliasing folds onto an exact predicted bin', () => {
  it('6 kHz sine at Fs = 10 kSa/s folds to 4 kHz (bin 64), an exact integer bin, no leakage', () => {
    const p = base({ waveType: 'sine', frequency: 6000, samplingRate: 10000, duration: 0.016 })
    // Ratio Fs/f = 5/3; numPeriods = 96 (a multiple of 3) → N = 160, so the fold lands exactly.
    expect(snapDuration(p.duration, p.frequency, p.samplingRate)).toBe(160)

    // Predicted alias = |f − round(f/Fs)·Fs| = |6000 − 1·10000| = 4000 Hz.
    const aliasHz = Math.abs(6000 - Math.round(6000 / 10000) * 10000)
    expect(aliasHz).toBe(4000)

    const res = spectrumOf(p, 12)
    const peakIdx = argmax(res.magnitudeDbfs, 1)
    expect(peakIdx).toBe(64)                          // 4000 / (10000/160 = 62.5) = 64, exact
    expect(res.freqAxis[peakIdx]).toBeCloseTo(4000, 3)
    expect(maxLeakageDbfs(res, [aliasHz], 2)).toBeLessThan(-60)
  })
})

describe('degenerate frequency guard — blank-screen crash', () => {
  // Each of these was a reported scope/spectrum "blank screen": clearing the W1/W2 field (NaN),
  // typing 0 (→ N = round(Fs/0) = Infinity → new Float64Array(Infinity) throws), a sub-milli-Hz
  // value (N in the tens of millions → OOM / multi-million-point FFT freeze), or a leading "-"
  // (negative N → new Float64Array(-N) throws). The guard must clamp all of these to a bounded N.
  const degenerate = [0, NaN, -1, -1000, 0.0005, 0.9, Infinity, -Infinity]
  for (const f of degenerate) {
    it(`frequency=${f} → bounded, finite N and finite samples, no throw`, () => {
      const N = snapDuration(0.016, f, 200000) // 200 kSa/s = the largest preset → worst-case N
      expect(Number.isFinite(N)).toBe(true)
      expect(N).toBeGreaterThan(0)
      expect(N).toBeLessThanOrEqual(200000) // bounded: clamped to MIN_FREQUENCY, never runaway

      const p = base({ waveType: 'sine', frequency: f, samplingRate: 200000 })
      const { x } = generateSignal(p)
      expect(x.length).toBe(N)
      expect(x.every((v) => Number.isFinite(v))).toBe(true) // not a NaN-filled buffer
    })
  }

  it('valid frequencies pass through safeFrequency unchanged (canary frequency untouched)', () => {
    expect(safeFrequency(1000)).toBe(1000)
    expect(safeFrequency(MIN_FREQUENCY)).toBe(MIN_FREQUENCY)
    expect(safeFrequency(50000)).toBe(50000)
  })

  // A cleared Amplitude/Offset field (Number('') = NaN) or ±Infinity must not produce a NaN-filled
  // buffer — that poisons every downstream trace and pushes NaN into Plotly (NaN peak annotation /
  // axis range), the same blank-screen class as a bad frequency. generateSignal must stay finite.
  for (const bad of [NaN, Infinity, -Infinity]) {
    it(`amplitude=${bad} → finite buffer, no NaN`, () => {
      const { x } = generateSignal(base({ amplitude: bad }))
      expect(x.length).toBeGreaterThan(0)
      expect(x.every((v) => Number.isFinite(v))).toBe(true)
    })
    it(`offset=${bad} → finite buffer, no NaN`, () => {
      const { x } = generateSignal(base({ offset: bad }))
      expect(x.every((v) => Number.isFinite(v))).toBe(true)
    })
  }
})

describe('SIG-1 — bin-width readout', () => {
  it('binWidth = Fs / N and N matches the generated signal length at every preset', () => {
    for (const fs of FS_PRESETS) {
      const p = base({ frequency: 1000, samplingRate: fs })
      const N = snapDuration(p.duration, p.frequency, fs)
      expect(N).toBe(generateSignal(p).x.length)
      expect(spectrumOf(p, 12).binWidthHz).toBeCloseTo(fs / N, 9)
    }
  })
})
