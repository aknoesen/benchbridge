# SPEC — ARB-4: Fritzing-style photoreal cream breadboard

Read `docs/CONVENTIONS.md`, `docs/specs/breadboard.md`, `docs/specs/active-realistic-breadboard.md`,
and `docs/PROGRESS.md` first. **Board/UI + rendering only — no `core/signal.ts` change** (12-bit canary
untouched), and **no change to the breadboard model, `checkEquivalence`, `boardNets`, hole geometry, or
`autoRouteJumpers`.** This is purely a re-skin of the existing SVG in `Breadboard.tsx` plus the part
bodies in `partvisuals.ts` / `PartBody`. Nothing about connectivity, placement, Check, or sim changes.

**Decision (andre, 2026-07-02):** go to a **full Fritzing-style cream breadboard** — the closest-to-real
look — accepting the seam against the dark app theme and reworking the dark net-colour cues to read on
cream. Supersedes ARB-1's flat dark rendering.

---

## Why

ARB-1 gave the board realistic *part identity* (colour-banded resistors, cap/LED/DIP bodies) but on a
flat near-black substrate (`#15171a`) with single-fill parts, no shading, no shadows — it reads as a tidy
diagram, not a photo. andre compared it to Fritzing and wants the Fritzing look: a **cream plastic board**
with a recessed centre channel, red/blue power rails, metal-clip sockets, and **3-D-shaded components with
drop shadows and arced jumper wires**. This is the "bridge to bench" made visually convincing — the board
should look like the thing on the student's desk.

---

## The target look (art direction — concrete)

Everything below is inside the one inline `<svg>` in `Breadboard.tsx` (the block starting ~line 487).
Add a single `<defs>` up top holding the gradients + one soft drop-shadow filter, then reference them.

### Substrate (the cream board body)
- Replace the board-body `fill="#15171a"` with a **cream vertical gradient** `boardCream`:
  top `#F3ECD8` → bottom `#E4D8B8`, with a 1 px lighter top bevel (`#FBF6E8`) and a 1 px darker bottom
  edge (`#CFC098`). Rounded corners `rx=10`. Add a subtle outer border `stroke="#B7A87E"` 1.5 px.
- Give the whole SVG a transparent background, but wrap the cream board in a **thin dark bench bezel**:
  a rounded `#0d0d0d`/`#222` frame rect 6–8 px outside the board so the cream sits *on* the dark bench
  intentionally (kills the "random cream panel" seam). Small radius, soft.
- **Centre channel:** the existing `#0d0d0d` slot becomes a **recessed groove** — a `#CFC198` fill with an
  inner shadow (a top inset line `#00000022` + bottom highlight `#FFFFFF55`), reading as a moulded valley.
- Optional but nice: faint **row letters (a–e / f–j)** and **column numbers** in `#9c8f6b` along the edges
  (Fritzing has these). Behind a flag if it clutters; ship if it reads clean.

### Sockets (holes)
- On cream, a hole is a **metal clip socket**, not a grey dot: a small **rounded-square** ~5.2 px,
  `fill="#3a3a3e"` with an inner top-left shadow and a 0.5 px `#00000066` stroke, sitting in a barely-
  lighter cream recess. Keep the existing generous invisible circular hit target and `h.x/h.y` centres —
  **geometry is frozen**, only the glyph changes.
- **Rails:** keep the red `+` and blue `−` rail lines (Fritzing-style) but on cream: `+` `#D24A3A`,
  `−` `#3B6FB0`, drawn as 2 full-length lines per rail region with the `+`/`−` glyphs. Rail sockets tint
  faintly toward their rail colour.
- **Hover / pending / Practice net-colour** must be re-tuned for cream: hover highlight → a **dark ring**
  (`#1b1b1f`) + subtle glow, NOT the current white fill (invisible on cream). Practice active-net colours
  stay saturated (they already are) but add a thin dark stroke so they read on the light board.

### Components (3-D bodies + drop shadow)
Enhance `PartBody`. Each body gets the shared soft **drop-shadow filter** (`feGaussianBlur` ~1.2 +
offset y≈1.5, `#00000055`) so parts lift off the board. Leads become **metallic** (a `#9a9ea6`→`#d7dade`
vertical gradient, 1.6 px) that visually seat into the socket.
- **Resistor:** cylindrical tube — a horizontal-axis body with a **vertical linear gradient**
  (`#F0E2BC` centre highlight → `#C9B587` top/bottom edges) to fake the tube, keep the 4 colour bands
  (`resistorBands`) but give each band a faint vertical gradient too; rounded ends.
- **Electrolytic cap** (≥1 µF): a **cylinder** — dark blue/black vertical gradient (`#3A4A73`→`#1A2440`),
  a lighter top ellipse cap, the polarity stripe kept (a lighter band with a `−` mark).
- **Ceramic cap** (<1 µF): the classic **blue/tan disc** with a radial gradient (light centre → darker
  rim) and a small lead kink.
- **Diode / Zener:** glass/black cylinder gradient with the cathode band kept (silver, slight sheen).
- **LED:** translucent **domed lens** — radial gradient of `ledColor` (bright centre → saturated rim),
  a specular white highlight, and a subtle base flange. **Keep ARB-2 glow exactly** (the `glow` halo
  circles stay; layer them under the lens). This is the one dynamic part — do not regress the current
  current-proportional glow.
- **Photodiode:** clear-domed variant of the LED lens (bluish, no glow).
- **Inductor:** moulded body gradient.

### IC / DIP (glossy black chip)
`PartBody`'s DIP-on-board render (the placed DIP, not the sidebar `DipPinoutLegend`): a **glossy black
body** — vertical gradient `#2A2A2E`→`#0C0C0E` with a top **specular sheen** stripe, a **pin-1 dimple**
(small dark circle) and the half-moon notch, and **silver legs** down both sides (a small shaded
trapezoid per pin seating into its socket). Drop shadow under the chip. (The sidebar pinout legend can
stay as-is or get the same body gradient — optional.)

### Jumper wires (arced, insulated)
Replace the straight `<line>` jumpers (student, power, and auto) with a **gentle arc**: a quadratic
Bézier bowing ~8–14 px perpendicular to the span (short jumpers barely bow, long ones bow more). Each
wire = a **drop-shadow arc** (`#00000040`, offset down) + a **casing arc** (the insulation colour, round
caps, 3.4 px) + a thin **top-highlight arc** (`#FFFFFF55`, 1 px) for the glossy insulation. Keep the
existing net-based `wireColor`. End junction dots become small **plated cups** (metal ring seating in the
socket). The F-7 **auto** dashed-centre overlay and the **hint** ghost overlay keep their semantics —
just drawn in this new arced style (auto: same casing with the dashed centre; hint: translucent/ghosted).

---

## Practice / Bench / net-colour on cream (don't lose the teaching cues)
- Practice-mode active-net colouring stays, but re-tuned: saturated hole tint + thin dark stroke; the
  net-coloured pin dots on parts keep working.
- Hover highlight = dark ring (not white).
- Bench mode unchanged in behaviour.
- The colour palette (`SUPPLY_HOLE`, `SUPPLY_LINE`, `TERM_COLOR`, the active-net colour ramp) may be
  **re-tuned for contrast on cream**, but the *semantics* (which net = which colour) must not change.

---

## Out of scope / explicitly NOT changing
- No `core/signal.ts`. No change to `core/breadboard.ts` model, `checkEquivalence`, `boardNets`,
  `autoRouteJumpers`, hole geometry (`buildHoles`, `PITCH`, `PAD`, `OY`), or placement/drag logic.
- No new runtime dependency (pure SVG gradients/filters). No raster/photo assets.
- ARB-2 live behaviour (LED glow, node-voltage probe/readout) must be **preserved** — this is a re-skin
  around it, not a rewrite.
- The M2K connector strips keep their function; they may be restyled to match (a brushed-navy adaptor).

## Definition of Done
- `npm run build` clean; `npm test` green (rendering-only; existing tests unaffected). If any
  `partvisuals` helper changes signature, update its test.
- **Live in Chrome (the real check — this is visual):** load an example, place R / C / LED / a DIP, wire
  a few jumpers → the board reads as a cream Fritzing-style board: shaded cylindrical parts with shadows,
  arced glossy wires, socket holes, red/blue rails, glossy DIP with pin-1. Practice net-colouring and
  hover still legible on cream. LED glow still tracks current (ARB-2). Auto/hint jumper styles intact.
- No `core/signal.ts` change (canary −104 dBFS, no-circuit). ROADMAP (ARB-4 → DONE) + PROGRESS note; one
  focused commit. Export-PNG (`{ light: true }`) still produces a clean figure.

## Files: allowed / forbidden
**Allowed:** `src/components/Breadboard.tsx` (the SVG re-skin + `<defs>`), `src/components/PartBody`
(same file), `src/core/partvisuals.ts` (any new colour/gradient-stop helpers, pure), `src/index.css` /
`src/components/Instrument.css` (only if a wrapper bezel needs a class), `docs/PROGRESS.md`,
`docs/ROADMAP.md`, this spec.
**Forbidden:** `src/core/signal.ts`; `src/core/breadboard.ts` (model/Check/router/geometry);
`src/core/schematic.ts`. If a realistic touch seems to need a geometry change, STOP and flag it.

---

## Note — iteration expected
Realism is art-directed; the first pass will need one visual tuning round after it deploys (andre + Cowork
eyeball the deployed board and adjust gradient stops / shadow strength / arc bow). Build the gradient
stops and the shadow filter as a few **named constants at the top of the render** so tuning is a
one-line change, not a hunt.
