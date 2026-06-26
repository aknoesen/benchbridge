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

### 2026-06-26 — Planning — DONE

**By:** project-director session (planning, no code)
**Commit:** docs only

**What I did:**
- Created the `docs/` planning set: `CONVENTIONS.md`, `ROADMAP.md`,
  `specs/oscilloscope.md`, `specs/schematic-ngspice.md`, this file.
- Selected the SPICE engine: **eecircuit-engine** (ngspice-WASM, MIT), behind a swappable
  `SpiceEngine` adapter. Fallbacks noted: tscircuit/ngspice, ngspiceX.
- Added a `docs/` pointer to `CLAUDE.md`.

**State for the next session:**
- No production code changed yet. Tracks A (oscilloscope) and B (schematic+SPICE) are fully
  specced and phased.
- **First phase to implement: ARCH-1** (channel bus). Recommended second: SPICE-1 (de-risk
  WASM early). See `ROADMAP.md` → "Recommended session sequence".
- Each phase lists allowed/forbidden files and acceptance criteria. Honor them.

**Open questions / flags for andre:**
- None blocking. Confirm whether the Bode plot should be a new mode inside the Spectrum
  Analyzer (recommended in LOOP-1) or a separate instrument — flagged for the LOOP-1 session.
