import { describe, it, expect } from 'vitest'
import { findEdgeTrigger, nextTriggerState } from './trigger'
import { generateSignal } from './signal'

describe('findEdgeTrigger (OSC-3)', () => {
  it('rising edge: interpolated index', () => {
    expect(findEdgeTrigger([-2, -1, 0, 1, 2], 0.5, 'rising')).toBeCloseTo(2.5, 6)
  })
  it('falling edge: interpolated index', () => {
    expect(findEdgeTrigger([2, 1, 0, -1, -2], 0.5, 'falling')).toBeCloseTo(1.5, 6)
  })
  it('level beyond the signal range → null', () => {
    expect(findEdgeTrigger([-1, 0, 1], 5, 'rising')).toBeNull()
  })
  it('honours startIndex (skips earlier crossings)', () => {
    const v = [-1, 1, -1, 1] // rising zero-crossings at ~0.5 and ~2.5
    expect(findEdgeTrigger(v, 0, 'rising', 0)).toBeCloseTo(0.5, 6)
    expect(findEdgeTrigger(v, 0, 'rising', 2)).toBeCloseTo(2.5, 6)
  })

  it('phase invariance: the aligned window starts at the same phase regardless of capture offset', () => {
    const sig = generateSignal({ waveType: 'sine', frequency: 1000, amplitude: 1, offset: 0,
      dutyCycle: 50, samplingRate: 100000, duration: 0.016 })
    const period = 100 // Fs / freq
    const level = 0.5
    const phases = [0, 7, 13, 23, 41].map((off) => {
      const t = findEdgeTrigger(sig.x, level, 'rising', off)
      expect(t).not.toBeNull()
      const i = Math.floor(t!)
      const interp = sig.x[i] + (t! - i) * (sig.x[i + 1] - sig.x[i])
      expect(interp).toBeCloseTo(level, 5)          // crossing lands on the level
      expect(sig.x[i + 1]).toBeGreaterThan(sig.x[i]) // and it is rising
      return ((t! % period) + period) % period
    })
    for (const p of phases) expect(p).toBeCloseTo(phases[0], 2) // same phase every time
  })
})

describe('nextTriggerState (OSC-3)', () => {
  it('auto free-runs without a trigger, locks with one', () => {
    expect(nextTriggerState({ armed: true }, false, 'auto').show).toBe('free')
    expect(nextTriggerState({ armed: true }, true, 'auto').show).toBe('triggered')
  })
  it('normal holds without a trigger, draws with one', () => {
    expect(nextTriggerState({ armed: true }, false, 'normal').show).toBe('hold')
    expect(nextTriggerState({ armed: true }, true, 'normal').show).toBe('triggered')
  })
  it('single captures once then holds until re-armed', () => {
    const d1 = nextTriggerState({ armed: true }, true, 'single')
    expect(d1.show).toBe('triggered')
    expect(d1.state.armed).toBe(false)
    expect(nextTriggerState(d1.state, true, 'single').show).toBe('hold')
  })
})
