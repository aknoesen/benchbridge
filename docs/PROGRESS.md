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