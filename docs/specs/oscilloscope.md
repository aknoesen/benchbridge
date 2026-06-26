# SPEC — Oscilloscope panel (full Scopy parity, two channels)

Target: a time-domain oscilloscope instrument matching the real M2K Scopy Oscilloscope in
function — two channels, full trigger system, measurements, cursors — styled to the
existing dark theme. Built in phases; each phase below is one CC session.

Read `docs/CONVENTIONS.md` first. Math lives in `src/core/`, UI in
`src/components/Oscilloscope.tsx`, colors in `src/index.css`.

## Reference behavior (what we are emulating)

The Scopy Oscilloscope shows up to two analog channels over a time window. The user sets
**time/div** (horizontal scale) and per-channel **volts/div** and **vertical offset**. A
**trigger** stabilizes the display: the trace is aligned so the chosen edge crosses the
trigger level at a fixed horizontal position. Modes are **Auto** (free-run if no trigger),
**Normal** (only redraw on a valid trigger), and **Single** (capture one frame then stop).
Measurements (Vpp, mean, RMS, frequency, period, duty) and cursors are read off the trace.

The M2K ADC is ±2.5 V full scale (matches `adcRangeV` in `signal.ts`). Keep that.

---

## Phase ARCH-1 — Channel bus

**Goal:** generalize `App.tsx` from one signal to a named-channel model so the scope can
show two channels and later swap CH2 to a circuit output. No visible feature yet.

**Implement:**
- In `App.tsx`, add the `ChannelId`, `ScopeChannel`, `ChannelSource` types from
  `CONVENTIONS.md` section 4.
- App owns a `channels: Record<ChannelId, ScopeChannel>` plus per-channel sample data.
- CH1 source = `{ kind: 'generator' }`, fed by the existing `generateSignal(params)`.
- CH2 source = `{ kind: 'generator2' }`, fed by a **second independent** `SignalParams`
  (`params2`), defaulting to sine, 2 kHz, 0.5 V so the two traces are visibly different.
  CH2 starts `enabled: false`.
- Existing `signal` prop to SignalGenerator and SpectrumAnalyzer must keep working
  unchanged (CH1 == the current signal). This phase is a refactor that is invisible to the
  existing two instruments.

**Acceptance criteria:**
- App builds; SignalGenerator and SpectrumAnalyzer behave exactly as before.
- `channels.CH1` produces the same samples the old single `signal` did.
- 12-bit spectrum floor still −104 dBFS (regression canary).

**Files allowed:** `src/App.tsx`, `src/core/scope.ts` (new, may host channel types if you
prefer them in core), `docs/PROGRESS.md`, `docs/ROADMAP.md`.
**Files forbidden:** `src/core/signal.ts`, `SpectrumAnalyzer.tsx`, `SignalGenerator.tsx`
(beyond prop-type compatibility — do not change their behavior).

---

## Phase OSC-1 — Scope scaffold, timebase, CH1 trace

**Goal:** a working single-channel free-running oscilloscope in the nav and split view.

**Implement:**
- `src/components/Oscilloscope.tsx` following the `SpectrumAnalyzer` component shape:
  `display-area` (Plotly time plot) + `settings-panel` (controls).
- Nav button in `App.tsx` (`active: 'scope'`), and include it in split-view layout options.
- `src/core/scope.ts`:
  - `captureWindow(samples, Fs, timePerDiv, nDivs, offsetT)` → returns the `{t, v}` slice
    to display for a given horizontal scale. 10 horizontal divisions is the Scopy default.
  - Helper to map volts/div + vertical offset to plot y-range (8 vertical divisions).
- Controls (component-local state):
  - **Time/div** selector (e.g. 1 µs … 10 ms in 1-2-5 steps).
  - **CH1 volts/div** (e.g. 50 mV … 1 V, 1-2-5 steps) and **vertical offset**.
  - **Run/Stop** (reuse the `.run-btn` pattern).
- Plotly: a grid of 10×8 divisions feel — use fixed axis ranges derived from time/div and
  volts/div, gridlines on division boundaries, CH1 trace in `--ch1-color`.
- Downsample for display like `SignalGenerator` does (cap drawn points, e.g. ≤2000).

**Acceptance criteria:**
- Selecting the scope shows a live CH1 waveform that responds to time/div and volts/div.
- Default square wave at 1 kHz is visible and correctly scaled (period = 1 ms spans one
  division at 1 ms/div... verify the math in a PROGRESS note with numbers).
- Build clean; spectrum regression canary holds.

**Files allowed:** `Oscilloscope.tsx` (new), `core/scope.ts`, `App.tsx` (nav + layout),
`App.css`/`Instrument.css` (layout only), `index.css` (only if a new var is needed), docs.
**Files forbidden:** `core/signal.ts`, the other two instrument components.

---

## Phase OSC-2 — Second channel + vertical controls

**Goal:** true two-channel display.

**Implement:**
- Render CH2 when `channels.CH2.enabled`, sourced from `params2` (from ARCH-1), trace in
  `--ch2-color` (add the variable to `index.css`).
- Per-channel block in the settings panel: enable toggle, volts/div, vertical offset,
  and a small color swatch. CH1 and CH2 independent.
- A compact CH2 source/params control is acceptable here (a few inputs); a full second
  signal-generator UI is **not** in scope — that stays minimal until the circuit loop.
- Vertical offsets let the two traces be stacked (Scopy behavior).

**Acceptance criteria:**
- Two visibly distinct traces, independently scaled and positioned.
- Disabling CH2 cleanly removes its trace.
- Build clean; regression canary holds.

**Files allowed:** `Oscilloscope.tsx`, `core/scope.ts`, `App.tsx` (params2 wiring),
`index.css` (add `--ch2-color`), `Instrument.css`, docs.

---

## Phase OSC-3 — Edge trigger engine

**Goal:** a stable, triggered display. This is the milestone that makes the scope feel real.

**Implement:**
- `core/trigger.ts` (or a section of `scope.ts`):
  - `findEdgeTrigger(v, level, slope, startIndex)` → index of the first sample where the
    signal crosses `level` with the given slope (`'rising' | 'falling'`), using linear
    interpolation between samples for sub-sample accuracy. Returns `null` if none found.
  - The display is aligned so the trigger crossing sits at a fixed horizontal position
    (default: center, i.e. 50% pre-trigger). Support a **trigger position** control later;
    center is fine for this phase.
- Trigger controls in the settings panel:
  - **Source**: CH1 or CH2.
  - **Level**: volts (slider + numeric), drawn as a horizontal marker line in
    `--trigger-color` (add the variable).
  - **Slope**: rising / falling.
  - **Mode**: Auto / Normal / Single.
    - *Auto*: trigger if found, else free-run (so a flat/no-trigger signal still shows).
    - *Normal*: only update the displayed frame when a valid trigger is found.
    - *Single*: capture one triggered frame, then set Run→Stop automatically.
- A small trigger-state readout (e.g. "Trig'd" / "Auto" / "Ready").

**Acceptance criteria:**
- A sine/square on CH1 is rock-steady when triggered (no horizontal jitter frame to frame).
- Changing level/slope visibly changes the alignment; level marker tracks the value.
- Auto vs Normal vs Single behave per the definitions above (verify each in a PROGRESS note).
- Build clean; regression canary holds.

**Files allowed:** `Oscilloscope.tsx`, `core/trigger.ts` (new), `core/scope.ts`,
`index.css` (add `--trigger-color`), docs.

**Note — scope is shippable here.** After OSC-3, consider deploying the scope MVP (see
ROADMAP milestones) before continuing.

---

## Phase OSC-4 — Holdoff, pulse/width trigger, single-shot (full parity)

**Goal:** complete Scopy-parity trigger system.

**Implement:**
- **Holdoff**: after a trigger, ignore further triggers for a user-set time. Prevents
  re-triggering on complex/multi-edge waveforms.
- **Pulse/width trigger**: trigger on a pulse whose width is `<`, `>`, or within a range,
  relative to a set threshold. Add a trigger **type** selector (Edge / Pulse).
- **Single-shot** capture polish: a clear armed→captured→stopped state machine with a
  re-arm button.
- Optional **trigger position** control (move the trigger point off center).

**Acceptance criteria:**
- Holdoff demonstrably suppresses extra triggers (test on a burst-like or narrow-duty wave).
- Pulse trigger fires only on pulses meeting the width condition.
- Build clean; regression canary holds.

**Files allowed:** `Oscilloscope.tsx`, `core/trigger.ts`, `core/scope.ts`, docs.

---

## Phase OSC-5 — Measurements and cursors

**Goal:** read quantitative values off the trace, Scopy-style.

**Implement:**
- `core/scope.ts` measurement functions over the captured window: **Vpp, Vmax, Vmin, mean,
  Vrms, frequency, period, duty cycle** per channel. Frequency/period from zero/level
  crossings (reuse trigger-style interpolation for accuracy).
- A measurements panel (toggleable rows), matching the existing `.marker-table` aesthetic.
- **Cursors**: two vertical (time) cursors and two horizontal (voltage) cursors with a
  readout of ΔV, Δt, and 1/Δt. Draggable or stepped — draggable preferred.

**Acceptance criteria:**
- For a known input (1 kHz, 1 V square) measurements read the expected values within
  display resolution (document expected vs actual in PROGRESS).
- Cursor deltas are correct.
- Build clean; regression canary holds.

**Files allowed:** `Oscilloscope.tsx`, `core/scope.ts`, `Instrument.css`/`index.css`
(styling only), docs.

---

## Cross-phase design notes

- **Sampling vs display.** The generator already produces samples at `samplingRate`. The
  scope's time/div selects how many of those samples fill the 10-division window. If a
  chosen time/div would need more time than the generated `duration` provides, either
  extend the capture (preferred: generate enough samples for the widest time/div) or clamp
  the time/div range. Decide in OSC-1 and document it.
- **Two generators, one clock.** CH1 and CH2 share `samplingRate` so their time axes align.
  Keep `params2.samplingRate === params.samplingRate` enforced in App.
- **Do not re-randomize the time trace per tick.** Unlike the spectrum, the scope trace is
  deterministic. Re-render on param/trigger/scale changes, not on every shimmer tick. (You
  may still want the `running` animation for a "live" feel, but the waveform itself should
  not jitter — that is the trigger's job to prevent.)
- **Reuse, don't fork, the layout CSS.** Use `.instrument-panel / .display-area /
  .settings-panel / .display-header` from `Instrument.css`.
- **Accessibility of values.** Numeric inputs alongside sliders for level/offset/scale, so a
  student can type exact values for a lab step.

## Pedagogical hooks (keep in mind, not required per phase)

This scope is a Lab 3 / Lab 5 teaching tool. Favor clarity over feature creep: visible
division grid, honest volts and time labels, measurements that match what students compute
by hand. The trigger is itself a teachable concept (why an untriggered trace "runs"). A
later guided-discovery phase (tracked separately in `CLAUDE.md`) may add in-app prompts.
