// Oscilloscope trigger engine (OSC-3). Pure logic, no React. See docs/specs/oscilloscope.md.
//
// A trigger stabilises the display: the trace is aligned so the chosen edge crosses the
// trigger level at a fixed horizontal position. Modes: Auto (free-run if no trigger), Normal
// (only redraw on a valid trigger), Single (capture one frame, then hold until re-armed).

export type Slope = 'rising' | 'falling'
export type TriggerMode = 'auto' | 'normal' | 'single'

// First sample index (sub-sample, linear-interpolated) at/after `startIndex` where `v` crosses
// `level` with the given slope. Returns null if there is no such crossing.
export function findEdgeTrigger(
  v: ArrayLike<number>, level: number, slope: Slope, startIndex = 0,
): number | null {
  const start = Math.max(1, Math.floor(startIndex))
  for (let i = start; i < v.length; i++) {
    const a = v[i - 1], b = v[i]
    const cross = slope === 'rising' ? (a < level && b >= level) : (a > level && b <= level)
    if (cross) {
      const frac = b !== a ? (level - a) / (b - a) : 0
      return (i - 1) + frac
    }
  }
  return null
}

// Mode state machine. `armed` matters only for single-shot (waiting to capture one frame).
export interface TriggerState { armed: boolean }
export type TriggerShow = 'triggered' | 'free' | 'hold'
export interface TriggerDecision { show: TriggerShow; state: TriggerState; status: string }

// Decide what to display this frame given whether a trigger was found, the mode, and the prior
// state. 'triggered' = align to the edge; 'free' = free-running (scrolling) frame; 'hold' = keep
// the previous frame.
export function nextTriggerState(prev: TriggerState, found: boolean, mode: TriggerMode): TriggerDecision {
  if (mode === 'auto') {
    return found
      ? { show: 'triggered', state: prev, status: "Trig'd" }
      : { show: 'free', state: prev, status: 'Auto' }
  }
  if (mode === 'normal') {
    return found
      ? { show: 'triggered', state: prev, status: "Trig'd" }
      : { show: 'hold', state: prev, status: 'Ready' }
  }
  // single
  if (!prev.armed) return { show: 'hold', state: prev, status: 'Stop' }
  return found
    ? { show: 'triggered', state: { armed: false }, status: 'Single' }
    : { show: 'hold', state: prev, status: 'Ready' }
}
