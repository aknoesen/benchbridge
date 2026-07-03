# SCH-11 prototype — circuitikz symbols + wiring (outside the app)

Proves the SCH-11 pipeline before any app integration: **circuitikz `.tex` → SVG with terminal anchors →
place + wire in a harness**. Throwaway, lives on branch `sch11-ansi-symbols` only. See
`../docs/specs/sch11-schematic-symbols.md`.

## Requirements (host)
- TeX Live with **circuitikz** and **dvisvgm** (andre's reader toolchain already has these).
- Python 3.

## Run
```
python build.py           # renders the starter set -> out/svg/*.svg + out/symbols.js
```
Pipeline is **latex → DVI → dvisvgm** (not pdflatex): dvisvgm refuses PDF input with
Ghostscript ≥ 10.01 and no mutool (the host has GS 10.05), and the DVI route needs neither.
The `standalone` class gets the `dvisvgm` option so the bbox comes out exact.
Then open **harness.html** in a browser. (Before build.py runs, the harness shows placeholder symbols so
it's demoable; after, it auto-loads the real ones from `out/symbols.js`.)

## What it proves
1. **Parts render** — the starter set (resistor, ground, sinusoidal source = W1/W2, oscilloscope) comes
   out as clean SVG straight from stock circuitikz bipoles (`R`, `ground`, `sV`, `oscope`, `[american]`).
2. **Usable pins** — each symbol carries terminal-anchor coordinates (see the anchor strategy in
   `build.py`: unique-colour pin markers, read back from the SVG, then recoloured to neutral dots).
3. **Interconnection** — in the harness, click a pin then another pin to wire them; the net readout
   confirms connectivity (union-find over pins).

If the scope + resistor wire up and read as one net, the pipeline is proven and the rest of the catalog
follows the same path.

## Adding symbols
Extend the `SYMBOLS` dict in `build.py` (a circuitikz body + pin coords). Source snippets live in the
EEC1 reader: `…/Development of Learning Modules for ADI/Reader_Source/<Module>/tikz_figures.tex`, and the
scope/source came from `…/organize coursematerials/03_Labs/Lab2/tikz_figures.tex`.

## Not yet
Porting into the real `SchematicEditor` is the P3 decision gate — only after the harness proves out, and
behind the SCH-11 merge gate (tests 292/292 incl. canary, no `core/signal.ts`, export + editor intact).
