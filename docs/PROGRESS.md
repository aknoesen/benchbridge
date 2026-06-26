# PROGRESS.md — session handoff log

Append-only log. Each CC session adds one entry at the **top** when it finishes (or stops).
The next session reads the latest entries to understand current state before starting.

This complements `docs/ROADMAP.md` (which holds the status table). ROADMAP says *what*
state each phase is in; PROGRESS says *how it went and what the next session needs to know*.

---

## Entry template (copy this, fill in, put newest on top)

```
### YYYY-MM-DD — <PHASE-ID> <title> — <DONE | PARTIAL | BLOCKED>

**By:** Claude Code session
**Commit:** <hash or "uncommitted">

**What I did:**
- ...

**Verification (Definition of Done):**
- build clean: yes/no
- 12-bit spectrum floor at −104 dBFS confirmed: yes/no
- math sanity check: <numbers — expected vs actual>

**State for the next session:**
- what is now true that wasn't before
- anything half-finished, any gotchas, any decisions made that future phases inherit

**Open questions / flags for andre:**
- ...
```

---

## Log

### 2026-06-26 — Bugfix: scope CH2 (2+) now reads its wired node, not generator2 — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Symptom (andre):** with 2+ wired to the circuit input (a 1 kHz square), CH2 showed a sine.
**Cause:** WIRE-3 only routed 1+ (`out`) through the `.tran`; CH2 still displayed `generator2`,
whose default is a 2 kHz sine — so 2+ ignored its wiring.

**Fix:**
- `core/schematic.ts`: `ToCircuitResult` now returns `probes: { ch1?, ch2? }` — the SPICE node
  each scope input is wired to (`ch1` = 1+ node, `ch2` = 2+ node), via the same `rename()` used
  for the netlist (so 2+ on the input resolves to `'in'`, on its own node to `'scope2'`, etc.).
- `App.tsx`: the `.tran` effect now resamples BOTH probe nodes from the one run →
  `circuitOut` (CH1) and `circuitOut2` (CH2); `measured2 = drawnValid && circuitOut2 ?
  circuitOut2 : signal2` feeds the Oscilloscope CH2. CH1 path generalised to `probes.ch1 ?? 'out'`.
- Test: `schematic.test.ts` asserts 2+ on the W1 input maps to `probes.ch2 === 'in'` and 1+ to
  `'out'`.

**Verification:** build clean; **19/19 tests** pass; `signal.ts` untouched (canary holds).

**State for the next session:**
- Both scope channels now follow their breadboard wiring through a drawn circuit (single-ended,
  GND-referenced — matches the Voltmeter's simple case). A fully differential CH (subtract the
  1-/2- node) is a later refinement if a floating-reference circuit needs it.

### 2026-06-26 — Housekeeping (refdes numbering, manual Ref, remove SPICE dev) + OSC-3 spec — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- **Component numbering** (`SchematicEditor.tsx`): replaced the single shared `idSeq` counter
  with per-prefix refdes numbering. `REFDES` maps kinds to prefixes (R/C/L, U for op-amp+in-amp,
  V for vsource); `newId(kind, comps)` returns prefix + (max existing number with that prefix)+1,
  so R1,R2,C1,L1… number independently and deletions don't renumber the rest. Fixes the old bug
  where inductor and in-amp both numbered as "I".
- **Manual numbering**: the Selected panel now has an editable **Ref** field; `setSelId` renames
  the component (rejects duplicates with a status message, keeps the selection).
- **Removed the SPICE dev panel**: deleted `components/SpiceDevPanel.tsx` and all wiring in
  `App.tsx` (import, `SHOW_SPICE_DEV`, nav button, render branch, `'spice'` instrument type).
- **OSC-3 spec** (`docs/specs/oscilloscope.md`): folded in the **free-running capture-phase
  offset** (per-frame, derived from the tick — not random) as the mechanism that makes triggering
  observable/testable, plus a concrete `core/trigger.test.ts` plan: phase-invariance property,
  edge-search unit cases, analytic sine crossings, and a pure `nextTriggerState` mode reducer.
  **No OSC-3 code yet** — andre asked to hold the build.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green; **18/18 tests** still pass.
- 12-bit canary: `signal.ts` untouched; numbering/dev-panel changes don't touch the signal path.

**State for the next session:**
- OSC-3 is fully specced (incl. the capture-phase decision) and ready to build when andre is.
- Numbering is per-type now; existing saved circuits keep their old ids (mixed prefixes are
  cosmetic only — toCircuit assigns its own SPICE refdes regardless of schematic id).
- NOTE: mount truncated `oscilloscope.md`, `SchematicEditor.tsx`, `App.tsx` on Edit-tool writes;
  the spec was recovered from `git show HEAD:` (a stale `.git/index.lock` blocked `git restore` —
  left it untouched, used read-only `git show`). All rebuilt via Python + verified by build/tests.

**Open questions / flags for andre:**
- A stale `.git/index.lock` exists in the repo (a crashed/parallel git process). I did not remove
  it. If `git` complains, delete `.git/index.lock` manually.

### 2026-06-26 — WIRE-3 (closes LOOP-1): scope/spectrum read the wired node via .tran — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: `WaveDrive` on `VSource` + `tranDriveSpec()` — transient sources now emit
  the real generator shape: SIN for sine, **PULSE** for square (duty-aware), triangle, sawtooth
  (matching `generateSignal` conventions). `applyGeneratorParams` stamps `wave` onto W1/W2.
- `core/spice.ts`: `sampleNodeTransient(result, node, tGrid)` — linear-interpolates a `.tran`
  node voltage onto a uniform time grid so the scope/spectrum (which assume uniform Fs) consume
  the circuit output like a generated waveform.
- `App.tsx`: a debounced (250 ms) effect runs a `.tran` of the drawn circuit driven by the
  generator, resamples `v(out)` (the 1+ node) onto the generator grid (captures the 2nd span so
  startup transients settle), and stores `circuitOut`. `measured = drawnValid && circuitOut ?
  circuitOut : signal` feeds the **Oscilloscope CH1 and Spectrum**; the Signal Generator panel
  still shows the raw generator. Engine runs in the existing worker; UI stays responsive.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 18/18 pass** (+2: square→PULSE netlist line; RC low-pass passband≈2 Vpp vs stopband
  attenuated through the real `.tran` + resampler).
- 12-bit canary: `signal.ts` untouched; with no circuit drawn `measured === signal` (generator),
  so the Spectrum input is byte-identical to before → floor stays −104 dBFS by construction.

**State for the next session:**
- **LOOP-1 is complete** — draw an RC filter, wire W1 → R → node → C → GND and put 1+ on the
  node: the scope/spectrum show the filtered output; the Network Analyzer shows its Bode curve.
  This is the shippable circuit-loop MVP (CLAUDE.md headline). Consider deploying + revisiting the
  Lab 3 `<!-- TWIN: -->` prelab markers.
- Two-tier resolution is in App via `measured` (not the channel bus `circuit-out` case, which
  stays unused). Only CH1/1+ (`out`) is routed; 2+ (`scope2`) for CH2 is a later refinement.
- NOTE: mount truncated `netlist.ts`, `spice.ts`, `App.tsx`, `spice.test.ts` on Edit-tool writes
  again; all rebuilt via bash/Python and verified by full build + test run.

**Open questions / flags for andre:**
- Steady-state capture grabs the 2nd generator span; a very slow circuit (τ ≳ one span) would
  still show some settling. Fine for EEC1 RC/op-amp circuits; revisit if a slow integrator appears.
- Next obvious steps: OSC-3 (triggers), LOOP-2 (live tuning + −3 dB cursor), or EDIT-1 (rubber-band).

### 2026-06-26 — Instrumentation amplifier component (INA + INA3) + symbol cleanup — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: new `InAmp` component (pins inP/inN/out/ref, `gain`). Two models — `ideal`
  (one VCVS: `E out ref inP inN gain`) and `threeopamp` (classic 3-op-amp built from ideal VCVS
  op-amps + matched 10k resistors, Rg sized to `G = 1 + 2R/Rg`). `inampLines()` namespaces
  internal nodes per instance.
- `core/schematic.ts`: SchKinds `inamp` / `inamp3`, 4 terminals, `toCircuit` mapping. Friendly
  default: an unwired REF is tied to ground so beginner circuits still solve.
- `SchematicEditor.tsx`: INA / INA3 palette tools, `V/V` gain unit, default gain 10, triangle
  symbol with +/−/out/REF pins.
- Earlier in the session (same file): inductor now draws a coil; resistor a zigzag; capacitor
  parallel plates (were all identical boxes). Save button now offers a real filename (native
  Save dialog + prompt fallback).
- Tests: ideal in-amp reads V(out)=1.0 for 0.1 V diff × gain 10; 3-op-amp reads 0.5 for 0.05 ×
  gain 10 — both via `.op` through ngspice.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 16/16 pass** (was 14; +2 in-amp).
- 12-bit spectrum canary: `signal.ts` untouched; unaffected.

**State for the next session:**
- Active analog parts available now: ideal op-amp, ideal in-amp (project INA front end), and
  3-op-amp in-amp (lab on in-amp internals). All emit via VCVS, ignore power rails (ideal).
- NOTE: the mount truncated `netlist.ts`, `schematic.ts`, `SchematicEditor.tsx`, and
  `spice.test.ts` on Edit-tool writes again; all were rebuilt via bash/Python and verified by
  line count + full test run. Continue editing these large files via bash/Python, not the Edit tool.

**Open questions / flags for andre:**
- In-amp REF defaults to ground if unwired; if you want a mid-supply ref (Vref pin to a divider)
  that already works by wiring REF to the node.

### 2026-06-26 — Planning: Track E (docking/workspace) + EDIT-1 (rubber-band) — DONE (docs only)

**By:** Claude Code session (in Cowork) — project-director planning, no code
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- New spec `docs/specs/docking-workspace.md` for **Track E** — dockable panels + saveable
  workspaces. Three phases: **E-1** preset snap layouts (no new dep, generalizes the split view
  into lab-keyed multi-panel presets), **E-2** true docking via **dockview** + geometry-only
  workspace save/load, **E-3** optional full-config workspace (persist each instrument's local
  settings — the expensive tier that touches every component).
- Captured the **two-tier cost** decision: geometry save is cheap, instrument-config save is the
  real refactor (component-local state per CONVENTIONS §4 must be lifted). Director picks the tier.
- Engine call: **do not hand-roll docking**; adopt dockview behind a `Workbench.tsx` wrapper
  (swappable, mirrors the SpiceEngine adapter). New runtime dep → needs sign-off per CONVENTIONS §2.
- Added **EDIT-1** to Track D: rubber-band wires (wire endpoints follow a component when it is
  moved/rotated). Design noted in ROADMAP — pure `schematic.ts` helper + the `SchematicEditor`
  drag handler; `computeNets` preserves connectivity by construction.
- ROADMAP: added Track E block (E-1/E-2/E-3 TODO) and the EDIT-1 row (TODO).

**Verification (Definition of Done):**
- docs only; no build/test impact. signal.ts untouched; 12-bit canary unaffected.

**State for the next session:**
- Track E is specced but **deliberately not started** — finish the circuit-loop MVP (WIRE-3 /
  LOOP-1) on a stable instrument set first, then take E-1.
- EDIT-1 is a small self-contained editor win that can be slotted any time.

**Open questions / flags for andre:**
- Decide whether the course wants free docking (E-2/E-3) or whether E-1 presets are enough.
- E-2 requires approving **dockview** as a new runtime dependency.

### 2026-06-26 — PSU-1 Power Supply instrument — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: `SupplySettings` + `applySupplyRails(circuit, psu)` — overrides every DC rail
  from the instrument (V+ pins = positive rails, V- = negative; disabled → 0 V). The V+/V- pins
  drawn on the breadboard now take their voltage from the Power Supply, like the real M2K.
- `components/PowerSupply.tsx` + App "Supply" nav: two rails — V+ (0..+5 V), V- (-5..0 V) — each
  with an enable, big readout, slider + numeric, and a **tracking** mode (V- = -V+).
- `Voltmeter.tsx`: takes the `psu` prop and applies the rails before `.op`, so it reads the live
  supply. Removed per-symbol voltage editing on V+/V- (the PSU owns it).
- App nav refactored to a small `navBtn` helper.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 14/14 pass.** New: a V+ rail overridden to 3 V reads 3 V at the node via `.op`.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The full Lab-1 bench is live: Signal Gen, Scope (2ch), Spectrum, Network Analyzer, Voltmeter,
  **Power Supply**, Circuit editor (save/load). Lab 1 Parts 3–4 (set supplies, read with the
  voltmeter, single-ended + differential) are fully doable in the twin.
- Remaining: WIRE-3 (Scope/Spectrum read wired node via `.tran`), OSC-3..5 (triggers + measurements), LOOP-2.

**Open questions / flags for andre:**
- Runtime check (Lab 1 Part 3-4): Supply tab → set V+ = 3, V- = -1. Circuit tab → V+ → 1+, 1- → GND,
  add GND. Voltmeter → Ch1 ≈ 3 V. Toggle Supply tracking and watch V- follow -V+.

### 2026-06-26 — SCH-3 Save/Load circuit — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `App.tsx`: localStorage autosave/restore of the drawn circuit (`m2k-circuit-v1`) — a refresh
  or cache-clear no longer loses work. `loadStoredSchematic()` lazy-inits state; an effect
  persists on every change.
- `SchematicEditor.tsx`: **Save** (download `m2k-circuit.json`) and **Open** (file picker → parse
  → load) in the editor header. `bumpIdSeq()` advances the id counter past loaded ids so new
  parts don't collide. Validates the file shape; status shows "loaded <name>".

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- Tests: 13/13 pass (no core math touched).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- Circuits persist across refresh and can be shared/submitted as `.json`. Good for course use.
- Remaining major items: WIRE-3 (Scope/Spectrum read wired node via `.tran`), PSU-1 (Power
  Supply instrument), OSC-3..5 (triggers + measurements).

**Open questions / flags for andre:**
- Runtime check: draw something, Save → a `m2k-circuit.json` downloads; Clear; Open it back.
  Refresh the page → the last circuit is still there (autosave).

### 2026-06-26 — WIRE-2 analysis-aware sources + DMM-1 Voltmeter — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `core/netlist.ts`: `applyGeneratorParams(circuit, w1, w2)` stamps the Signal Generator
  settings onto the W1/W2 sources (dc=offset, AC 1, SIN(offset,amp,freq)). `buildNetlist`
  already switches the emitted line by analysis (AC 1 for `.ac`, SIN for `.tran`, DC for `.op`),
  so the SAME drawn circuit now drives correctly under every instrument. (schematic.ts untouched.)
- `core/spice.ts`: `nodeVoltage` / `hasNode` / `differentialVoltage` read a real `.op`/`.dc`
  result.
- `components/Voltmeter.tsx` + App "Voltmeter" nav: M2K-style 2-channel DC voltmeter. Runs
  `.op` on the drawn circuit and shows Ch1 = V(1+)-V(1-), Ch2 = V(2+)-V(2-) — single-ended when
  the '-' input is on GND, differential otherwise. ±25 V / ±2.5 V ranges with Lab-1 resolution
  (20 mV / 2 mV).

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green.
- **Tests: 13/13 pass.** New: a divider `.op` reads V(out)=2.5 V and a differential = 2.5 V.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- Voltmeter is live and reads the wired ADC ports (Lab 1 Part 4: single-ended + differential
  supply measurements). Analysis-aware sourcing is proven end to end.
- Remaining (WIRE-3 / LOOP-1 scope half): make the **Scope/Spectrum** read their wired node via
  a `.tran` of the circuit (today they still read the generator directly), and add square→PULSE.

**Open questions / flags for andre:**
- Runtime check: Circuit tab — wire V+ → 1+, 1- → GND, add GND. Open Voltmeter → Ch1 ≈ +5 V.
  Make it differential by moving 1- to V- and watch Ch1 read the full span.

### 2026-06-26 — WIRE-1b Exact M2K pin nomenclature + colors — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Source of truth:** EEC1 Lab 1 + the adaptor-board silkscreen images. Top row `1+ 2+ ⏚ V+ W1 ⏚ TI`,
bottom row `1- 2- ⏚ V- W2 ⏚`. The twin's breadboard ports now match exactly.

**What I did:**
- `src/core/schematic.ts`: added the differential ADC terminals `adc1n` (1-) / `adc2n` (2-) and
  split supply into `vplus` (V+) / `vminus` (V-). `toCircuit` maps them: 1+→`out`, 1-→`out_n`,
  2+→`scope2`, 2-→`scope2_n`; V+/V- → DC rails (+5/-5 default). (Differential reading lands with
  the Voltmeter / WIRE-2.)
- `src/components/SchematicEditor.tsx`: palette is now W1, W2, 1+, 1-, 2+, 2-, V+, V-, GND;
  symbols + colors per the agreed scheme — **V+ red, V- blue, GND black (rendered light for
  contrast), W1/W2 yellow, 1± orange (Ch1), 2± cyan (Ch2)**; added an in-editor M2K pin legend
  so students map straight from the Lab 1 handout.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules).
- Tests: 12/12 pass (W1+Scope1 RC still simulates to ~1 kHz).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The breadboard vocabulary is M2K-accurate. WIRE-2 still owed: instruments READ from their
  wired node (direct generateSignal fast path; SPICE .tran through a circuit), and differential
  ADC reading V(1+) - V(1-). Pairs naturally with DMM-1 (Voltmeter does single-ended + differential).

**Open questions / flags for andre:**
- ENVIRONMENT (recurring): the mount truncated `schematic.ts` AND `SchematicEditor.tsx` on
  Edit-tool writes this session; I rewrote both via reliable bash writes and verified
  tsc/build/tests. **Always run `npm run build` locally before committing these two files.**
- Color note: GND is the "black" wire but is drawn light-gray so it's visible on the near-black
  canvas. Say the word if you'd prefer a different GND rendering.

### 2026-06-26 — WIRE-1 Breadboard ports (schematic = patch panel) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**Decision:** the Circuit editor IS the breadboard. Instrument I/O are ports you place and wire,
mirroring the M2K bench. (See ROADMAP Track D.)

**What I did:**
- `src/core/schematic.ts`: new port kinds `awg1`/`awg2` (W1/W2 generator outputs) and
  `scope1`/`scope2` (Scope CH1/CH2 input probes). `toCircuit` maps them to nets
  (`awg1`→`in`, `awg2`→`in2`, `scope1`→`out`, `scope2`→`scope2`); AWG ports emit a V source to
  ground (AC 1). `vsource`/`probe` kept for back-compat. Connectivity warnings reworded.
- `src/components/SchematicEditor.tsx`: palette now W1/W2/Scope 1/Scope 2 + V+/V- (was V src/
  Probe/Supply); SVG symbols for the new ports (generator circles, CH1/CH2 probe diamonds).
- Test: W1+Scope1 RC schematic → engine → -3 dB ~1 kHz.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules).
- Tests: 12/12 pass.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session — WIRE-2 (important):**
- Today the standalone scope/spectrum STILL read the generator directly; the ports are wired
  vocabulary + netlist mapping only. WIRE-2 makes each scope/spectrum input read the VOLTAGE AT
  ITS WIRED NODE: direct fast path (`generateSignal`) when wired straight to a generator (keeps
  all waveforms + ADC noise), else a SPICE `.tran` of the node. This also completes LOOP-1's
  scope half (route the circuit transient into `channelInputs.circuitOut`).

**Open questions / flags for andre:**
- ENVIRONMENT: the mount truncated large files mid-write TWICE today (`SchematicEditor.tsx`,
  `schematic.ts`). I rebuilt the tails and verified line counts/builds. Recommend confirming
  `npm run build` locally after pulling. If this keeps happening, prefer smaller edits.
- Runtime check: open Circuit, place W1 + R + C + Gnd + Scope 1, wire them, press Simulate.

### 2026-06-26 — OSC-2 Second scope channel (CH2) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `App.tsx`: `setParams2` added; a `signal2` (CH2 = second generator) resolved each tick via the
  channel bus and passed to the scope; `onParams2Change` lets the scope edit CH2 freq/amplitude.
- `Oscilloscope.tsx`: CH2 support — enable toggle, per-channel Volts/div + Offset, compact CH2
  source (freq/amplitude). Switched the y-axis to a **graticule-division** scale (±4 div) so two
  channels with different Volts/div share one grid, matching Scopy. CH1 orange, CH2 cyan; header
  + readout show both. `--ch2-color` added to index.css.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB).
- Tests: 11/11 pass (capture math unchanged; division mapping is display-only).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The scope is now two-channel. CH2's source is a second generator; the **circuit-output**
  source (`circuit-out`) for the full LOOP-1 scope half is still pending wiring (route a
  `.tran` of the drawn circuit into `channelInputs.circuitOut`, then let the scope select it
  for CH2). Consider finishing LOOP-1's scope half next, or proceed to Track C.
- Per andre: **PSU-1 (Power Supply)** and **DMM-1 (Voltmeter)** are queued next — do not skip.

**Open questions / flags for andre:**
- Runtime check: open Scope, tick "Enable CH2" — a cyan trace appears; adjust CH2 freq/Volts-div
  independently of CH1. Note the y-axis now reads in divisions (each channel scaled by its V/div).

### 2026-06-26 — LOOP-1 (Bode half) drawn circuit → Network Analyzer — IN PROGRESS

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- Lifted the schematic to `App` state (`schematic` + `setSchematic`); `SchematicEditor` is now
  controlled via props. App computes `toCircuit(schematic)` and passes the result to the
  Network Analyzer (`circuit` + `dutName`) ONLY when the drawing is valid (no warnings).
- The Network Analyzer now sweeps **your drawn circuit** and labels the DUT accordingly; it
  falls back to the built-in default RC when the drawing is empty/invalid.
- File-recovery note: a flaky mount write truncated `SchematicEditor.tsx` mid-file; I rebuilt
  the lost tail (closing tags + `renderSymbol`). Watch for this — verify file line counts after
  large edits to that file.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB).
- Tests: 11/11 pass. The schematic test already covers drawn-RC → engine → -3 dB ≈ 1 kHz,
  which is exactly the LOOP-1 path (editor circuit → netlist → transferFunction).
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**Why IN PROGRESS (not DONE):**
- The **Bode half is done** (draw a circuit → see its Bode in the Network Analyzer).
- The **scope/transient half** (input on CH1 vs circuit output on CH2 via `.tran` → `circuit-out`)
  still needs **OSC-2** (the second channel). `channelInputs.circuitOut` is still null.
- Flip LOOP-1 to DONE once OSC-2 lands and the transient output is routed to Scope CH2.

**Open questions / flags for andre:**
- Runtime check: draw V src → R → out(C→Gnd) + Probe on out in the Circuit tab, then open the
  Network tab — the Bode should reflect YOUR R/C values (change C and re-open to see fc move).
  An empty/invalid drawing shows the default RC.

### 2026-06-26 — SCH-2 Simulate + validation (plus SCH-1 polish) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/schematic.ts`: connectivity validation in `toCircuit` — flags a floating source
  (`in` net with <2 component terminals) and a floating output (`out` with no component
  terminal), on top of the existing no-ground / no-source / no-probe warnings.
- `src/components/SchematicEditor.tsx`: a **Simulate** button that builds the netlist from the
  drawing and runs it through the SPICE worker, reporting points + (-3 dB cutoff if it reads
  as a low-pass) or the engine error. Blocks with the validation message if the circuit is
  incomplete.
- SCH-1 polish in the same area: **DC supply rail** part (`dcrail` → SPICE `DCRail`, editable
  volts, default +5 V) and **op-amp +/- input labels**; rotate-after-place (click any part to
  select, then R / Rotate button).
- Tests: added missing-ground and floating-source validation cases.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB; engine still in the
  worker chunk only).
- **Tests: 11/11 pass** (netlist 3, scope 3, bode 1, schematic 4). Validation tests confirm
  missing-ground and floating-source warnings.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The editor can now draw → validate → simulate a circuit end to end inside the Circuit panel.
- LOOP-1: lift the editor's `result.circuit` to App and pass it to `<NetworkAnalyzer circuit=…>`
  (the prop already exists) and to Scope CH2 (transient via `circuit-out`). Needs OSC-2 (CH2)
  for the scope side; the Bode side can land first.

**Open questions / flags for andre:**
- Runtime check: open Circuit, draw V src→R→out(C→Gnd) with a Probe on out, press Simulate;
  expect "OK — simulated N points · -3 dB ≈ 1.00 kHz".

### 2026-06-26 — SCH-1 Browser schematic editor — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/schematic.ts`: schematic model (`SchComponent`, `Wire`, `terminalsOf`),
  `computeNets()` (union-find over grid points + wires), and `toCircuit()` → SPICE-2 `Circuit`
  with net labelling (ground→`0`, V-source `+`→`in`, probe→`out`) plus validation warnings.
- `src/components/SchematicEditor.tsx`: SVG grid editor. Palette (Select/Wire/R/C/L/V/Op-amp/
  Ground/Probe); click-to-place, drag-to-move, Delete/Clear, two-click wiring, value inspector
  with eng-notation parsing (1k, 159n). Live circuit validity readout from `toCircuit`.
- `App.tsx`: "Circuit" nav entry; `src/index.css`: `--node-color`, `--wire-color`.
- `src/core/schematic.test.ts`: hand-built RC schematic.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (30 modules; index.js ~4.84 MB).
- **Tests: 9/9 pass** (netlist 3, scope 3, bode 1, schematic 2). Schematic test: a hand-drawn
  RC converts to R[in,out]/C[out,0]/V[in,0] and simulates to -3 dB in (900,1100) Hz.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- `toCircuit(schematic)` is the seam for SCH-2: wire the editor's circuit into the Network
  Analyzer (`circuit` prop) and Scope CH2. The editor already computes a valid Circuit live.
- SCH-2 = "Simulate" action + friendlier validation surfacing; LOOP-1 = full generator→circuit
  →instruments wiring + transient to Scope CH2.

**Open questions / flags for andre:**
- Rotation supported (press R, or Rotate button; rotates the selected part, else the place
  angle). Still click-to-place; richer symbols can come later if wanted.
- Runtime visual check: open "Circuit", place V src + R + C + Ground + Probe, wire them, and
  confirm the "valid" readout. (Interactions are build-verified but need your eyes.)

### 2026-06-26 — NET-1 Network Analyzer (Bode) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/spice.ts`: added `transferFunction(result, out, in)` → `{freq, magDb, phaseDeg}`
  computing H = V(out)/V(in) (complex division) from a complex AC `SimResult`.
- `src/components/NetworkAnalyzer.tsx`: Scopy-style Bode instrument — stacked magnitude (dB)
  and phase (deg) plots vs log frequency. Controls: start/stop frequency, points/decade,
  magnitude min/max (defaults -90..10 dB; phase fixed -180..180, 45° ticks). Runs an `.ac`
  sweep through the SPICE worker on a default RC low-pass; marks the -3 dB cutoff.
- `App.tsx`: "Network" nav entry; renders in single view. Component accepts an optional
  `circuit` prop so LOOP-1 can feed the drawn circuit instead of the default RC.
- `src/core/spice.test.ts`: Vitest for the Bode math.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (28 modules; index.js ~4.83 MB; engine still isolated
  to the 20 MB worker chunk).
- **Tests: 7/7 pass** (netlist 3, scope 3, bode 1). Bode test on the default RC: passband
  ~0 dB, -3 dB cutoff in (950, 1050) Hz, phase at 1 kHz in (-50, -40)° — i.e. ≈ -45°.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- The Network Analyzer is a working Bode instrument over a default RC. LOOP-1 will pass the
  schematic-editor circuit in via the `circuit` prop and route transient output to Scope CH2.
- Remaining for the circuit loop: SCH-1 (editor), SCH-2 (editor→netlist), then LOOP-1.

**Open questions / flags for andre:**
- Runtime visual check: open the Network tab; expect a low-pass roll-off with the -3 dB
  marker near 1 kHz and phase passing -45° at the cutoff.

### 2026-06-26 — OSC-1 Oscilloscope panel (timebase + CH1) — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/scope.ts`: added display helpers `captureWindow()` (horizontal slice of the CH1
  capture to a 10-div window, downsampled to <=2000 pts), `voltsAxisRange()`, and
  `SCOPE_H_DIVS`/`SCOPE_V_DIVS` (10x8 graticule).
- `src/components/Oscilloscope.tsx`: time-domain Plotly panel, CH1 trace in orange, with
  Time/div (100 µs..1 ms, 1-2-5), CH1 Volts/div (50 mV..1 V), vertical Offset, Run/Stop, and
  a readout. Gridlines align to divisions (xaxis dtick = time/div, yaxis dtick = volts/div).
- `App.tsx`: "Scope" nav entry; scope renders in single view (consumes CH1 from the bus).
- `src/core/scope.test.ts`: Vitest for the capture math.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green (26 modules; index.js ~4.82 MB).
- **Tests: scope 3/3 + netlist 3/3 pass.** captureWindow at 1 ms/div → 1000 pts over a 10 ms
  window; 1 kHz period (1 ms) spans exactly one division. Downsample caps at 2000 pts;
  voltsAxisRange(0.5)=[-2,2].
- 12-bit spectrum canary: signal.ts untouched; App still resolves CH1 identically — unaffected.

**OSC-1 scope decision (documented per spec):**
- The scope reads the existing CH1 capture (16 ms at default params), so Time/div is capped
  at 1 ms/div (10 ms window fits 16 ms). Wider time/div needs a scope-specific longer capture
  — deferred (a later phase can regenerate at the scope window or extend duration).
- Scope is single-view only for now; adding it to Split view is deferred (OSC-2 / layout
  refactor). Split still shows SignalGen + Spectrum.

**State for the next session:**
- OSC-2 enables CH2 (params2 already in the bus) + per-channel vertical controls + `--ch2-color`.
- Per ROADMAP sequence after OSC-1: OSC-2, then NET-1 (per andre: OSC-1 then NET-1).

**Open questions / flags for andre:**
- Runtime visual check: open the Scope tab, confirm the 1 kHz square shows ~1 period/division
  at 1 ms/div and scales with Volts/div.


### 2026-06-26 — SPICE-2 circuit graph + netlist generator — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- `src/core/netlist.ts`: typed `Circuit` graph (`Resistor`, `Capacitor`, `Inductor`,
  `VSource`, `DCRail`, `OpAmp`, `Ground`), `Analysis` union (`tran`/`ac`/`op`/`dc`), and
  `buildNetlist(circuit, analysis)` → ngspice string. Ground aliases (`0`/`gnd`/declared
  ground net) normalise to `0`. Op-amp emits an ideal high-gain VCVS (E device).
- Groundwork for Track C (per spec): `DCRail` represents Power Supply rails; op-amp carries
  `vpos`/`vneg` rail nets; `buildNetlist` supports `.op`/`.dc` for the Voltmeter.
- SignalParams→source mapping: `makeInputSource()` / `sineFromParams()` (sine→`SIN(...)`,
  AC sweeps use `AC 1`). Non-sine transient drive (PULSE/PWL) deferred.
- Added Vitest (`vitest@^4.1.9` devDep, `npm test` = `vitest run`); `src/core/netlist.test.ts`.
- tsconfig: excluded `*.test.ts(x)` from the production `tsc` (vitest typechecks/runs tests).
- Docs in this commit also add NET-1 (Network Analyzer) and Track C (PSU-1/DMM-1) and the
  SPICE-2 accommodation notes.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green in sandbox. netlist.ts is library-only (not imported
  by the app entry yet) so the bundle is unchanged.
- **Tests: 3/3 pass** (`vitest run`). Includes an engine integration test: the GENERATED RC
  netlist simulates to a -3 dB cutoff in (900, 1100) Hz and flat passband (310 ms).
- Netlist-string test asserts `V1 in 0 DC 0 AC 1`, `R1 in out 1000`, `C1 out 0 1.59155e-7`,
  `.ac dec 20 10 1000000`; ground-alias + `.op`/`.tran` directive tests pass.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**State for the next session:**
- `buildNetlist` + `Circuit` are ready for SCH-2 (editor → graph) and NET-1/LOOP-1.
- A test harness now exists; later phases should add tests in the same style.
- Per ROADMAP sequence, next is OSC-1 (scope) or SCH-1 (editor) or NET-1.

**Open questions / flags for andre:**
- Op-amp is an ideal VCVS (no rail clipping yet). Fine for EEC1 filters; revisit if a lab
  needs saturation behaviour.


### 2026-06-26 — SPICE-1 ngspice-WASM engine integration — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1`)

**What I did:**
- Added dependency `eecircuit-engine@^1.7.0` (ngspice-WASM, MIT) to package.json.
- `src/core/spice.ts`: engine-agnostic `SpiceEngine` interface, `SimResult` shape
  (`columns` carry real values or complex re/im/mag/phaseDeg), `normalizeResult()` mapping
  the engine `ResultType` → `SimResult`, and a `WorkerSpiceEngine` that runs everything in
  a Web Worker. Only TYPES are imported from eecircuit-engine here (erased at compile), so
  the 20 MB engine never enters the main bundle.
- `src/core/spice.worker.ts`: hosts the `Simulation`, lazily `start()`s it once, runs
  netlists, posts back normalized results.
- `src/components/SpiceDevPanel.tsx`: throwaway dev panel (gated by `SHOW_SPICE_DEV` in
  App.tsx) that runs a hardcoded RC low-pass AC sweep and reads the -3 dB cutoff.
- App.tsx: gated "SPICE dev" nav entry.

**Verification (Definition of Done):**
- build clean: `tsc && vite build` green in the Linux sandbox copy.
- Engine correctness proven directly in Node: RC low-pass (R=1k, C=159.155n) gives DC gain
  -0.00 dB and **-3 dB cutoff = 1000.0 Hz** (= 1/2pi.R.C). Same code path the worker uses.
- Worker isolation confirmed: engine emitted as a SEPARATE `dist/assets/spice.worker-*.js`
  chunk (20 MB); main `index.js` unchanged at ~4.8 MB.
- Base path confirmed: worker referenced as `new URL('/m2k-scopy-web/assets/spice.worker-*.js',
  import.meta.url)`; NO standalone .wasm asset (inlined) — so the GitHub Pages base-path
  hazard is moot. Worker chunk loads lazily only when the SPICE panel mounts.
- 12-bit spectrum canary: signal.ts untouched; unaffected.

**Runtime check — CONFIRMED in browser (2026-06-26):** preview build, clicked SPICE dev -> Run RC sweep -> "done in 248 ms", -3 dB cutoff 1000.0 Hz, no console errors. Worker spawns and round-trips in-browser under the base path.

**(original check instructions, for reference):**
- `npm install` (to pull eecircuit-engine) then `npm run build && npm run preview`, open the
  served URL, click "SPICE dev" -> "Run RC sweep", confirm it prints cutoff ~1000 Hz with no
  console errors. This confirms the worker actually spawns in-browser under the base path.

**State for the next session:**
- A working, swappable SPICE engine exists behind `createSpiceEngine()`. SPICE-2 (netlist
  generator) and the circuit loop build on `SimResult`.
- `SHOW_SPICE_DEV`/SpiceDevPanel are throwaway — remove or replace at LOOP-1.
- Bundle size is large (20 MB worker). Acceptable for now; revisit if needed.


### 2026-06-26 — ARCH-1 Channel bus — DONE

**By:** Claude Code session (in Cowork)
**Commit:** uncommitted (run `.\push.ps1` to commit/push)

**What I did:**
- New `src/core/scope.ts`: `ChannelId`, `ChannelSource` (`generator` | `generator2` |
  `circuit-out`), `ScopeChannel`, `Samples`, `ChannelInputs`, `DEFAULT_CHANNELS`, and
  `resolveChannelSamples(channel, inputs)`.
- `src/App.tsx`: added `params2` (CH2 default: sine 2 kHz, 0.5 V, disabled), `channels`
  state from `DEFAULT_CHANNELS`, a memoized `channelInputs`, and `channelSignals` resolved
  via the bus. `signal` (CH1) now derives from `channelSignals.CH1` — byte-identical to the
  previous `generateSignal(params)` path, so the two existing instruments are unchanged.
- Nav icon glyphs converted to HTML entities (render identically) to avoid a file-sync
  issue with raw multibyte chars in this environment.
- Added `push.ps1` helper in repo root.

**Verification (Definition of Done):**
- build clean: `tsc --noEmit` exits 0. NOTE: full `vite build` could not run in the Linux
  sandbox (Windows-native 