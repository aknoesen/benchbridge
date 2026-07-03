# SCH-11 — Schematic symbols: circuitikz textbook style + drawn instruments

_Phase spec. Video-driven (andre, 2026-07-02): in a demo, the breadboard's realistic part visuals pop
while the schematic's symbols read flat. Fix by matching the schematic to the **circuitikz** artwork from
andre's own course reader, and add drawn instrument symbols. Develop on a branch; merge only if small +
low-risk before survey wave 1._

## Why
- **Pedagogical consistency:** the reference is andre's course reader (circuitikz). Matching it means the
  twin's schematic looks identical to what students already read, zero translation friction.
- **Credibility + adoption:** textbook-standard symbols read as authoritative to faculty and sponsors.
- **Upgrades an existing feature:** the PNG schematic export (white-paper figures for prelabs/reports)
  becomes drop-in professional when symbols match a real lab manual.

## Scope
1. **Restyle existing components** to the reader's circuitikz: R, C, L; diode / LED / Zener; transistors
   (BJT, MOSFET); op-amp + INA125; ground; sources. Keep the part semantics; change only the artwork.
2. **Add instrument symbols** as artwork around their existing terminals: **Signal Generator (W1/W2),
   Oscilloscope, Power Supply**. circuitikz provides the signal-source and oscilloscope/scope-signal
   elements andre already uses in the reader, so these come from the **same catalog** (compose/label as
   needed; the supply as a labeled source/rail if there's no direct element). No fully custom artwork
   required.

## Reference + pipeline
- **Primary approach — reproduce the full ANSI catalog.** Batch-render the whole **circuitikz** ANSI
  symbol set to SVG (iterate the component names, one standalone render each), producing a complete,
  consistent SVG **symbol catalog** the app maps its part kinds onto. Marginal cost over converting a few
  is low because it's scripted, and every future part already has a matching symbol.
- **The reader sets the conventions:** andre's course-reader circuitikz pins down the **ANSI variant +
  style** to standardize on (which resistor form, pin conventions, line weight), so the catalog matches
  the students' own reading. andre to provide the reader's `.tex` / circuitikz snippets.
- **Enumerate the catalog:** scrape the **circuitikz manual** for the full component index + anchor names,
  and/or read the installed package source. That list drives the batch.
  Manual PDF (andre): https://ctan.dcc.uchile.cl/graphics/pgf/contrib/circuitikz/doc/circuitikzmanual.pdf
- **Conversion:** for each component, emit a standalone `\tikz` render → PDF → **SVG** (`dvisvgm` or
  `pdf2svg`) → adapt into the app's symbol components. (texlive + circuitikz + dvisvgm are installable in
  the sandbox; set up next session.)
- **Licensing:** circuitikz is open source (LPPL) and schematic symbols are industry-standard, so
  reproducing them as SVG is clean; keep an attribution note if any TikZ source is lifted verbatim.
- **Integration constraint:** preserve each symbol's **terminal anchor points** (pin coordinates) so
  `schematic.ts` wire-attach, hit targets, drag/rotate, and net computation are unchanged. Symbols are a
  pure visual layer, decoupled from the netlist. Map the current part kinds first; the rest of the catalog
  is on-hand for later parts.

## Out of scope (boundaries)
- **No `core/signal.ts` change.** Visual layer only; the 12-bit canary must be untouched.
- **Do NOT pull in WIRE-4** (always-present fixed M2K terminals — a big architectural refactor). Draw
  artwork for the ports/terminals that already exist; leave the terminal-model refactor to WIRE-4.
- No new part kinds, no netlist changes.

## Source images (andre's modules — per-symbol visual references)
Rendered figures showing the exact reader style to match. **Prefer the underlying circuitikz `.tex`
(vector, clean anchors) if it exists; the PNGs are the visual target if we must trace.** Each output SVG
must carry **explicit named terminal-anchor points** (pin ids/coords) so wires can attach — a PNG cannot.
- Base A = `…\EEC1 Spring 2026\Development of Learning Modules for ADI\Bite_Size_Modules\`
- Base B = `…\EEC1 Spring 2026\organize coursematerials\Labs_2027\Lab3\media\`

| Symbol | Source image |
|--------|--------------|
| Resistor | A\SecretsofDCCircuits\media\ParallelResistors-1.png · A\IVMenagerie\media\IVCurveResistor-1.png |
| Voltage source | A\IVMenagerie\media\IVCurveVSource-1.png |
| Voltmeter | A\IVMenagerie\media\ex1_circuit-1.png |
| Battery | A\IVMenagerie\media\ex1_circuit-1.png |
| Capacitor | A\InductorsCapacitors\media\Cap_Basic.png |
| Inductor | A\InductorsCapacitors\media\Cap_Basic.png  ⚠ same file as capacitor — likely wrong; need the correct inductor image |
| Diode | A\IVMenagerie\media\IVCurveDiode-1.png |
| Op-amp | A\OperationalAmplifiers\media\OpAmp_KCL-1.png |
| INA (symbol) | A\InstrumentationAmplifiers\media\DiffAmpl6-1.png |
| INA (internal detail) | A\InstrumentationAmplifiers\media\DiffAmpl5-1.png |
| Oscilloscope | B\connection-1.png |
| Signal Generator | B\connection-1.png |

Access: `EEC1 Spring 2026` is outside the repo — connect it (request failed once, retry) or copy the
crops into the branch `prototype/`. **First few for P0:** resistor, capacitor, ground, voltage source
(2-terminal wiring test) + op-amp (multi-pin test).

## Feasibility confirmed (2026-07-02)
The "hardest" symbol, the **oscilloscope**, is a **stock circuitikz bipole** (`to[oscope]`, with
`\ctikzset{bipoles/oscope/waveform=none}`) — the rounded grid-screen with two terminals (Ch+ top, Ch−
bottom), not a custom drawing. The **signal generator (W1/W2)** is the standard **sine voltage source**
bipole. Both are `[american]`-style, same class as R / ground / source. Source: `organize coursematerials/
03_Labs/Lab2/tikz_figures.tex` (~L183-203); rendered `…/Lab2/media/labConnnection1-1.png`.
**Implication:** every symbol converts by the same uniform path (tex → PDF → SVG), and pin anchors are the
bipole endpoints. Strong go signal — no bespoke instrument artwork required.

## Prototype first — prove it outside the app (andre, 2026-07-02)
De-risk the two unknowns in an **isolated standalone harness** before touching `SchematicEditor`.
Chosen over an in-app form: a standalone page keeps the prototype off the app's build/state and iterates
fast. Single self-contained **HTML page** (runs in any browser, no app build), living on the fork in a
`prototype/` dir, app-independent → zero risk to main/beta.

The prototype must answer exactly two questions:
1. **Parts render + usable pins** — circuitikz→SVG quality, and can we pin explicit terminal anchor coords.
2. **Interconnection** — place parts, draw a wire between anchors, confirm connectivity reads correctly.

Phases:
- **P0** — convert a small **starter set** (resistor, capacitor, ground, a source, an op-amp) circuitikz→
  SVG with explicit pin anchors.
- **P1** — harness renders the symbols and marks their anchor points (proves conversion + pins).
- **P2** — add placement + wire-drawing between anchors + a minimal connectivity readout (proves
  interconnection).
- **P3** — decision gate: if artwork + wiring both hold, define the port into the real `SchematicEditor`
  (map part kinds → catalog, preserve anchors) and integrate behind the merge gate. Not before.

## Workflow
- Branch **`sch11-ansi-symbols`** off `main` (CC cuts it; sandbox git is unreliable). Cowork stages the
  SVG symbol edits on the branch; CC commits. `main` stays the stable beta (Render deploys `main` only, so
  the branch never touches the live app or the current testers).
- Ambition is safe on the branch: attempt the full set; bail with zero cost if it's not ready in time.

## Merge gate (all must hold to merge to main before wave 1)
- Tests **292/292** green, including the 12-bit canary.
- `tsc && vite build` clean.
- **Zero** `core/signal.ts` changes.
- PNG export still produces clean schematic figures.
- Editor interactions intact: wire anchors, hit targets, drag, rotate, select, net computation.
- Visual QA on every restyled/added symbol.

## Open inputs
- **andre:** provide the reader's circuitikz source (`.tex` / snippets) for the components + any instrument
  artwork you already have.
- **Design:** decide the visual treatment for the 3 instrument symbols (labeled instrument block vs.
  stylized icon), consistent with the circuitikz line style.
