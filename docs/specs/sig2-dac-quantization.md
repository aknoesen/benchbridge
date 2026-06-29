# SPEC — SIG-2: Optional DAC quantization on W1/W2 (Track I)

Read `docs/CONVENTIONS.md`, `CLAUDE.md` ("Things NOT to change"), and `docs/PROGRESS.md` first.
This phase **modifies `core/signal.ts`** (the protected path) and **depends on SIG-1 (DONE)**. It must
ship **default OFF** so the ADC bit-depth Learning Mode and the 12-bit canary stay clean.

**Status: spec refined; CC builds only on andre's explicit go.**

---

## Goal

Model the M2K's **12-bit AWG DAC** as an optional, default-OFF quantization noise floor in the
Spectrum Analyzer. With SIG-1's settable ADC sample rate and the existing ADC bit-depth Learning Mode,
this completes the digitization story: **the DAC sets a floor on the way out, the ADC sets a floor on
the way in, and the noisier of the two converters dominates** — a great ADC can't recover detail a
coarse DAC already discarded. Sample rate (SIG-1) is the knob between them.

## DECISIONS (locked with andre, 2026-06-28)

**D1 — Model = SYNTHETIC noise floor, NOT actual quantization.** Mirror the ADC: add a synthetic
Gaussian noise term calibrated to the DAC's TPDF quantization variance, rather than actually rounding
the waveform. Rationale (andre, from the ADC experience): actual quantization makes deterministic
distortion products that look like peaks and muddy the spectrum (the exact reason `computeSpectrum`
uses synthetic ADC noise — see CLAUDE.md "Things NOT to change"). Synthetic keeps the spectrum clean,
stays consistent with the ADC, and still teaches the key point. *Consequence:* like the ADC bit-depth
mode, this is **spectral-only** — it shows in the Spectrum Analyzer, not on the scope time-domain.
*Rejected alternative:* actual time-domain quantization (would show a scope staircase, but only at
exaggerated low bit depths — the real M2K is 12-bit where lsb≈mV is invisible — and it reintroduces
the distortion-as-peaks problem).

**D2 — Bit depth = SELECTABLE knob, default 12.** A DAC selector (4/8/12, default 12 = real M2K AWG),
parallel to the ADC selector. Selectable so students can move the DAC floor independently of the ADC
floor and watch the worse converter dominate — the whole lesson of this phase.

## Implement

- **Location: the Spectrum Analyzer**, alongside the existing ADC bit-depth selector and SIG-1's Fs
  control — this becomes a coherent "digitization" Learning-Mode cluster (DAC out → Fs → ADC in).
  **`generateSignal` is NOT touched**, so the canary is preserved by construction.
- Add **off-by-default** DAC state in `SpectrumAnalyzer.tsx`: `dacEnabled` (default false) + `dacBits`
  (default 12). A small **"DAC model" toggle + 4/8/12 selector**, clearly labelled **DAC (output)**,
  distinct from the **ADC** bit-depth control.
- In `computeSpectrum` (`core/signal.ts`), add an **optional, gated** DAC noise term: when enabled, add
  a second synthetic Gaussian contribution per bin calibrated to the DAC's quantization variance
  (TPDF, same construction as the existing ADC noise), using the DAC full-scale range and `dacBits`.
  When disabled, the function is **byte-identical** to today. Pass the new params as optional args with
  defaults so existing callers/tests are unaffected.
- The two floors combine in power (variance adds). Update the **theoretical noise-floor reference line**
  to show the *combined* ADC+DAC floor when the DAC is on (or draw the DAC floor as a second reference)
  so students can see which converter dominates.
- Define the DAC full-scale from the AWG output range; confirm against existing generator/`adcRangeV`
  conventions rather than inventing a new magic number.
- **Do NOT touch** the protected internals: `tau`, `buildWindow` denominator, `bluesteinFFT`, and the
  **existing ADC** synthetic-noise term. SIG-2 *adds* a parallel DAC term; it must not alter the ADC one.

## Acceptance criteria (DoD §7 + phase-specific)

- **Default OFF is byte-identical:** with the DAC disabled (and for all existing callers that don't pass
  the new args), `computeSpectrum` output is unchanged. The **12-bit ADC canary still ≈ −104 dBFS**
  (square/1kHz/100kSa/s/16ms/Hanning, DAC off).
- **DAC ON raises the floor correctly:** a Vitest asserts the floor rises by the predicted DAC
  contribution at the selected `dacBits`, and that with a coarse DAC (e.g. 4-bit) + a fine ADC (12-bit)
  the **DAC floor dominates** (the "worst converter wins" lesson), matching the theoretical line.
- **No leakage regression:** between harmonics the spectrum still sits at/near the (now combined) floor,
  no inter-harmonic spikes, at the default and at each Fs preset.
- `npm run build` clean; no console errors. `docs/PROGRESS.md` appended; `docs/ROADMAP.md` SIG-2 → DONE;
  one focused commit.

## Files: allowed / forbidden

**Allowed:** `src/core/signal.ts` (the gated DAC noise term in `computeSpectrum` + DAC full-scale const
— NOT the protected math, NOT the ADC term), `src/core/signal.test.ts` (new tests),
`src/components/SpectrumAnalyzer.tsx` (DAC toggle + bit selector + theory-line update), `docs/PROGRESS.md`,
`docs/ROADMAP.md`, this spec.
**Forbidden / unchanged behavior:** `generateSignal`, `tau`, `buildWindow` denominator, `bluesteinFFT`,
and the existing ADC synthetic-noise term. If SIG-2 seems to need any of these, stop and flag in
`docs/PROGRESS.md`.

## Commit

`scope: SIG-2 optional DAC quantization floor (default OFF, M2K 12-bit AWG)` with the §8 body, including
`verification: build clean; DAC-off byte-identical; 12-bit ADC canary −104 dBFS; DAC-dominates test passes`.
