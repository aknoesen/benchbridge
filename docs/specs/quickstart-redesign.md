# SPEC — QS-4: Quickstart redesign (orientation + quick win + modular tour)

Read `docs/CONVENTIONS.md`, `docs/specs/quickstart.md` (QS-1/QS-2, the current content), and
`docs/PROGRESS.md` first. **UI/content only — no `core/` math, no `core/signal.ts`.** This is the
onboarding the **beta test** (`docs/private/BETA-TEST-PLAN.md`) and the later sponsor traffic will land on,
so it's on the critical path to "promotion-ready."

## Why
The Quickstart grew by accretion (QS-1 divider-first, then QS-2 tour appended) into one long linear scroll
of ~9 text-heavy step-lists with **no orientation up front and no way to see its shape or pick a start**. It
front-loads the single-ended-vs-differential lecture and makes a newcomer draw supply rails (8 steps) before
any payoff. Content is good; the **architecture** is what needs fixing.

## Principle: RE-ARCHITECT, don't rewrite
**Reuse the existing, proven step content** (the load-then-look steps, the examples, the SVG diagrams) —
re-sequence it into the structure below and add the two new pieces (an orientation screen + a chapter/
progress rail). Lower risk than a from-scratch rewrite, which matters right before the beta.

## Structure (chapters, in order — reader-aligned, course-NEUTRAL)
Follows the **development arc of the course reader** (a universal intro-electronics progression, so it stays
course-neutral — no course/lab labels): first circuit → measurement → signals → the same circuit in time
then frequency → amplifiers → devices → build for real. Order locked with andre 2026-07-02.
1. **Orientation (NEW — one screen).** What BenchBridge is in a line; the one big idea (*every panel mirrors a
   real bench instrument, so skills transfer to hardware*); a labelled **signal-flow** visual (DAC out →
   circuit → ADC in); "what you'll be able to do." Buttons: **"Take the tour"** (starts ch. 3) and **"Jump to
   an instrument."** Neutral, simulation-honest voice.
2. **The bench at a glance.** The instrument-map table (real ↔ app, Open buttons) + one signal-flow diagram.
3. **The flashlight — the opener.** The simplest possible circuit: a supply drives an **LED** through a
   resistor and it lights up. **Reuse the existing LED example/components — use the LED, do NOT build a
   filament/bulb component; "turning on the supply" is the switch, so no switch component either.** The
   visceral first "aha": you built a circuit and it does something (ARB-2 LED glow). Mirrors the reader's
   opening ("A Flashlight's Tale").
4. **The voltage divider — first measurement (~2 min).** Load `divider`, open the Supply, open the Voltmeter,
   read ~5 V / ~2.5 V. **Fold single-ended-vs-differential in HERE.**
5. **Generate a signal → spectrum + digitization** (andre: a separate module **right after the divider**).
   Generate a waveform on the **Signal Generator**, then show its **Spectrum** and the **digitization story**
   (12-bit, dBFS, the quantization floor — the app's original pedagogy; tie to the Spectrum Learning Mode).
6. **RC (or RL) in the time domain.** Drive an RC/RL with the Signal Gen and watch the response on the
   **Scope** — the circuit's behaviour in time.
7. **RC (or RL) in the frequency domain.** The **same** RC/RL swept on the **Network Analyzer** (Bode) — the
   circuit in frequency. *(Same circuit, two views — the teaching beat.)*
8. **Op-amps.** Op-amp (and instrumentation-amp) examples — gain, inversion.
9. **I-V curves** (moved after op-amps — andre). Diode/Zener in **Scope XY** + the **Curve Tracer** (transistor
   families).
10. **Build it for real — the capstone.** Circuit → simulation → **Breadboard → Check** (Practice vs Bench).
    Move the 8-step "draw the supply rails" content here, reframed as building — not the newcomer's first task.
11. **Where next.** One-click example loaders + About.

## Navigation — paginated, NOT one long scroll (andre, 2026-07-02)
- **A chapter menu drives a one-page-at-a-time view: each chapter is its own page, so the user never scrolls
  the whole Quickstart.** Clicking a menu item **swaps the main area** to that chapter — an **in-app view
  swap**, not a new browser tab (keeps the load-example buttons and the return-to-Quickstart behaviour). The
  guided sequence (ch. 3–9: Flashlight · Voltage divider · Signal + Spectrum · RC in time · RC in frequency ·
  Op-amps · I-V curves) can be flat top-level items or grouped under a **Tour** parent — CC's discretion; each
  is its own page.
- **Next / Back** buttons advance through chapters in order (the guided-tour spine); the **menu doubles as the
  progress indicator** (current highlighted, visited checked). "Take the 5-minute tour" starts the sequential
  flow; the menu lets you jump anywhere.
- **Keep each chapter short enough to fit with little/no scrolling** on a laptop screen — that's the point.
- Keep the existing **load-example + navigate action buttons** and the **"return to Quickstart" gold-pulse**
  (`quickstartSeen` / `.nav-hint`) — reused as-is.
- **Estimated time** per chapter (small, e.g. "~2 min"). *Optional (nice-to-have):* deep-link each chapter
  via a URL hash so a step is linkable/returnable.

## Content rules
- **Simulation honesty:** a short, plain "this is a fast simulation, not a physical M2K / not a Scopy
  replacement" note (consistent with the front page + FB-4).
- **Course-NEUTRAL — no course names or lab numbers anywhere (andre, 2026-07-02).** Do not reference "EEC1,"
  "Lab 1 / Lab 3 / Lab 5," or any course-specific label. Anchor relevance to **universal concepts and
  measurements** every EE recognizes (a voltage divider, a Bode / frequency-response plot, an I-V curve,
  a quantization floor), not a specific course's lab. **Scrub any EEC1 / Lab-N references out of the reused
  content** while re-sequencing. (Naming the modelled hardware — the M2K bench — is fine and honest; it's
  *courses/labs* that must go.)
- Keep each step's "load X → open Y → read Z" pattern (it's reliable because the examples preset generators +
  Volts/div and reset the tool to Select).

## Out of scope
- No `core/` change; no `core/signal.ts`; no new runtime dependency. No video/screenshots (still QS-3 future).
- Not changing the example library or the instruments — only the Quickstart panel's structure/content and its
  entry points.

## Definition of Done
- Quickstart reachable from the nav and the Welcome screen; the **orientation screen** shows first with the
  two branch buttons; the **chapter menu (with the Tour submenu)** switches pages one at a time (**no long
  scroll**), **Next/Back** advance in order, and the current chapter is highlighted.
- The quick-win path works: from orientation → voltage divider → Voltmeter reads ~5 V / ~2.5 V. The modular
  tour sections each load their example + navigate. The capstone reaches the Breadboard + Check.
- Reads cleanly on a **small laptop screen** (this is the beta audience) — no overflow/overlap; mirrors the
  Welcome responsive fix.
- `tsc` + `npm run build` clean; **no `core/signal.ts` change** (12-bit canary untouched). ROADMAP
  (Track H: QS-4 → DONE) + PROGRESS note.

## Files
**Allowed:** `src/components/Quickstart.tsx` (the restructure + orientation + rail), `src/App.tsx` (only if
the nav entry / `renderPanel` needs a small touch — keep minimal), `src/App.css` / `Instrument.css` (rail +
responsive styling), `docs/*`. **Forbidden:** `core/signal.ts`; the example library math; the instruments.

## Note
Structure is andre-approved in principle (2026-07-02); he may tweak chapter order/copy before build. Confirm
the current Quickstart's SVG diagrams (single-ended/differential, dBFS) are reused, not redrawn.
