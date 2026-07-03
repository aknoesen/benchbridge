#!/usr/bin/env python3
"""
SCH-11 prototype — circuitikz symbol -> SVG (+ terminal anchors).

Renders a small starter set of stock circuitikz bipoles to standalone SVG and
extracts each symbol's pin (terminal) coordinates, so the wiring harness can
snap wires to them. Proves the tex -> PDF -> SVG + anchors pipeline before any
app integration.

RUN (on the host, where TeX Live + circuitikz + dvisvgm already exist):
    python3 build.py
Outputs:
    out/svg/<id>.svg      one clean SVG per symbol
    out/symbols.js        window.SYMBOLS = {id: {svg, pins:[{id,x,y}], viewBox}}
                          (harness.html loads this)

ANCHOR STRATEGY (the crux of "connect them up easily"):
Each symbol is authored by us, so we know its pin coordinates. We drop a tiny
filled circle in a UNIQUE fill colour at each pin, render, then locate those
colours in the SVG and read back their centres in SVG user units. That maps
tikz-space pins -> SVG-space pins with no fragile coordinate math. The markers
are then recoloured to a neutral terminal dot (or the harness can hide them).

NOTE FOR CC/Fable: dvisvgm may emit a filled circle as <circle> or as <path>.
This script handles both by bbox-centre; verify against a real render and
tighten if a symbol's dot comes out off-centre.
"""

import os
import re
import json
import math
import colorsys
import shutil
import subprocess
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SVG_DIR = os.path.join(OUT, "svg")

# Distinct pin marker colours, one per pin index. Generated as evenly-spaced
# hues so a many-pin part (e.g. a 16-pin DIP) still gets a unique, well-separated
# marker per pin; the extractor canonicalises dvisvgm's shortened hex before matching.
def _pin_palette(n=24):
    pal = []
    for i in range(n):
        r, g, b = colorsys.hsv_to_rgb(i / n, 0.95, 0.9)
        pal.append("#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255)))
    return pal


PIN_COLORS = _pin_palette(24)
PIN_DOT = "#222222"   # neutral colour the markers are recoloured to in the output
MARKER_R = "1.6pt"    # marker radius in the tex source

# --- Starter set -----------------------------------------------------------
# Each symbol: a circuitikz body drawn between explicit coordinates, plus the
# pin coordinates (tikz cm) that get the coloured markers. All [american].
# 'pre' is extra setup emitted before the drawing (e.g. oscope waveform off).
SYMBOLS = {
    "resistor": {
        "pre": "",
        "body": r"\draw (0,0) to[R] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "ground": {
        "pre": "",
        "body": r"\draw (0,0) node[ground]{};",
        "pins": [(0, 0)],
    },
    "vsource_sin": {  # W1/W2 signal generator: sinusoidal voltage source
        "pre": "",
        "body": r"\draw (0,0) to[sV] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "oscilloscope": {  # stock circuitikz `oscope` bipole (grid screen)
        "pre": r"\ctikzset{bipoles/oscope/waveform=none}",
        "body": r"\draw (0,0) to[oscope] (0,-3);",
        "pins": [(0, 0), (0, -3)],
    },
    # --- expanded catalog (reader-matched circuitikz elements) --------------
    "capacitor": {
        "pre": "",
        "body": r"\draw (0,0) to[C] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "inductor": {
        "pre": "",
        "body": r"\draw (0,0) to[L] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "diode": {
        "pre": "",
        "body": r"\draw (0,0) to[D] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "led": {
        "pre": "",
        "body": r"\draw (0,0) to[leD] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "zener": {
        "pre": "",
        "body": r"\draw (0,0) to[zD] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "battery": {  # reader uses battery1/battery2 for DC
        "pre": "",
        "body": r"\draw (0,0) to[battery1] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "dc_source": {  # american voltage source (circle, +/-)
        "pre": "",
        "body": r"\draw (0,0) to[V] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "current_source": {  # reader uses isource; [american] `I`
        "pre": "",
        "body": r"\draw (0,0) to[I] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "voltmeter": {  # reader draws the meter as smeter with t=V
        "pre": "",
        "body": r"\draw (0,0) to[smeter, t=V] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "opamp": {  # multi-terminal: pins are named anchors, not coords (inP/inN/out)
        "pre": "",
        "body": r"\node[op amp] (A) at (0,0){};",
        "pins": ["A.+", "A.-", "A.out"],
    },
    # --- waveform sources (signal-gen modes: square / triangle / sawtooth) --
    "vsource_square": {  # stock square source; glyph is symmetric (not duty-tunable)
        "pre": "",
        "body": r"\draw (0,0) to[sqV] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "vsource_tri": {  # stock triangle source (vsourcetri)
        "pre": "",
        "body": r"\draw (0,0) to[tV] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "vsource_saw": {  # no stock sawtooth glyph -> empty source circle + drawn ramps
        "pre": "",
        "body": r"""\draw (0,0) to[esource] (0,-2);
\draw (-0.3,-1.14) -- (-0.02,-0.86) -- (-0.02,-1.14) -- (0.26,-0.86) -- (0.26,-1.14);""",
        "pins": [(0, 0), (0, -2)],
    },
    "photodiode": {  # stock circuitikz photodiode variant (TIA front-end)
        "pre": "",
        "body": r"\draw (0,0) to[pD] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    "polarized_cap": {  # electrolytic / polar capacitor (circuitikz pC)
        "pre": "",
        "body": r"\draw (0,0) to[pC] (0,-2);",
        "pins": [(0, 0), (0, -2)],
    },
    # --- transistors (node-based, named anchors like the op-amp) ------------
    "bjt_npn": {
        "pre": "",
        "body": r"\node[npn] (Q) at (0,0){};",
        "pins": ["Q.base", "Q.collector", "Q.emitter"],
    },
    "bjt_pnp": {
        "pre": "",
        "body": r"\node[pnp] (Q) at (0,0){};",
        "pins": ["Q.base", "Q.collector", "Q.emitter"],
    },
    "nmos": {
        "pre": "",
        "body": r"\node[nmos] (Q) at (0,0){};",
        "pins": ["Q.gate", "Q.drain", "Q.source"],
    },
    "pmos": {
        "pre": "",
        "body": r"\node[pmos] (Q) at (0,0){};",
        "pins": ["Q.gate", "Q.drain", "Q.source"],
    },
    "njfet": {
        "pre": "",
        "body": r"\node[njfet] (Q) at (0,0){};",
        "pins": ["Q.gate", "Q.drain", "Q.source"],
    },
    "pjfet": {
        "pre": "",
        "body": r"\node[pjfet] (Q) at (0,0){};",
        "pins": ["Q.gate", "Q.drain", "Q.source"],
    },
}

# Generic DIP ICs — circuitikz `dipchip`; pins are named anchors ".pin 1".. ".pin N".
# The chip is what op-amps / INA125 / any packaged part boards onto. Orientation
# cues: keep the topmark notch, AND draw a pin-1 dot on the body next to pin 1
# (circuitikz numbers dipchip pin 1 at the TOP-left, then down the left side —
# so the dot sits in the top-left corner, real-chip style). Offset measured on
# render: lead tip -> body edge is ~0.30, so 0.45 puts the dot just inside.
for _n in (8, 14, 16):
    SYMBOLS[f"ic_dip{_n}"] = {
        "pre": "",
        "body": (rf"\node[dipchip, num pins={_n}, hide numbers] (U) at (0,0){{}};"
                 "\n" r"\fill (U.pin 1) ++(0.45,0.10) circle (1.6pt);"),
        "pins": [f"U.pin {i}" for i in range(1, _n + 1)],
    }


def tex_for(sym):
    # `#` is a TeX macro-parameter char, and TikZ wants named colours — so the
    # hex marker colours are \definecolor'd in the preamble (xcolor ships with
    # circuitikz) and referenced by name in the \fill.
    defs = "\n".join(
        rf"\definecolor{{pin{i}}}{{HTML}}{{{PIN_COLORS[i].lstrip('#').upper()}}}"
        for i in range(len(sym["pins"]))
    )
    # A pin is either a numeric (x,y) coordinate or a raw tikz coordinate
    # expression string (e.g. an op-amp anchor "A.+"), so multi-terminal parts
    # can mark their named anchors, not just bipole endpoints.
    def _coord(p):
        return f"({p[0]},{p[1]})" if isinstance(p, (tuple, list)) else f"({p})"
    marks = "\n".join(
        rf"\fill[pin{i}] {_coord(p)} circle ({MARKER_R});"
        for i, p in enumerate(sym["pins"])
    )
    # [dvisvgm] class option: emit raw bbox specials for the latex->DVI->dvisvgm
    # route (dvisvgm can't read PDFs with Ghostscript >= 10.01 and no mutool).
    return rf"""\documentclass[dvisvgm,border=3pt]{{standalone}}
\usepackage{{circuitikz}}
{defs}
\begin{{document}}
\begin{{circuitikz}}[american]
{sym['pre']}
{sym['body']}
{marks}
\end{{circuitikz}}
\end{{document}}
"""


def run(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def nums(s):
    return [float(n) for n in re.findall(r"-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?", s)]


# --- SVG transform math ------------------------------------------------------
# dvisvgm wraps the drawing in transform groups (translate+scale with a y-flip),
# so raw marker path coords are NOT viewBox coords. Walk the tree composing the
# transform chain as SVG 2x3 matrices [a b c d e f] and map centres through it.

MAT_ID = [1, 0, 0, 1, 0, 0]


def mat_mul(m, n):
    a1, b1, c1, d1, e1, f1 = m
    a2, b2, c2, d2, e2, f2 = n
    return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
            a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
            a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]


def mat_apply(m, x, y):
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def parse_transform(s):
    m = MAT_ID
    for name, args in re.findall(r"(\w+)\(([^)]*)\)", s or ""):
        v = nums(args)
        if name == "translate":
            n = [1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0.0]
        elif name == "scale":
            n = [v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0]
        elif name == "matrix":
            n = v
        elif name == "rotate":
            a = math.radians(v[0])
            n = [math.cos(a), math.sin(a), -math.sin(a), math.cos(a), 0, 0]
            if len(v) == 3:
                n = mat_mul(mat_mul([1, 0, 0, 1, v[1], v[2]], n),
                            [1, 0, 0, 1, -v[1], -v[2]])
        else:
            n = MAT_ID
        m = mat_mul(m, n)
    return m


def norm_color(c):
    """#f0f -> #ff00ff (dvisvgm emits shortened hex)."""
    c = (c or "").strip().lower()
    if re.fullmatch(r"#[0-9a-f]{3}", c):
        c = "#" + "".join(ch * 2 for ch in c[1:])
    return c


def short_hex(c):
    """#ff00ff -> #f0f when a short form exists, else unchanged."""
    c = c.lower()
    if re.fullmatch(r"#[0-9a-f]{6}", c) and all(c[i] == c[i + 1] for i in (1, 3, 5)):
        return "#" + c[1] + c[3] + c[5]
    return c


def hex_rgb(c):
    c = norm_color(c)
    if re.fullmatch(r"#[0-9a-f]{6}", c):
        return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    return None


def pin_centres(svg_text, colors, tol=3):
    """({pin index: (x,y) in viewBox coords}, {raw fill strings that matched})
    for the marker elements, found by fill colour (own or inherited) and mapped
    through the transform chain. Matching is tolerant to `tol` per channel:
    the palette hex round-trips through xcolor's float rgb, so dvisvgm can
    emit values a couple of LSBs off the authored colour."""
    want = {i: hex_rgb(c) for i, c in enumerate(colors)}
    found, matched_fills = {}, set()

    def match(f):
        fr = hex_rgb(f)
        if fr is None:
            return None
        best, bd = None, tol + 1
        for i, wr in want.items():
            d = max(abs(a - b) for a, b in zip(fr, wr))
            if d < bd:
                best, bd = i, d
        return best

    def walk(el, mat, fill):
        t = el.get("transform")
        if t:
            mat = mat_mul(mat, parse_transform(t))
        f = el.get("fill") or fill
        tag = el.tag.split("}")[-1]
        if tag in ("circle", "path") and el.get("fill") != "none":
            i = match(f)
            if i is not None and i not in found:
                if tag == "circle":
                    cx, cy = float(el.get("cx", "0")), float(el.get("cy", "0"))
                    ok = True
                else:
                    # bbox centre of the path coords (marker paths are simple
                    # circle outlines: every command takes coordinate pairs)
                    coords = nums(el.get("d", ""))
                    xs, ys = coords[0::2], coords[1::2]
                    ok = bool(xs)
                    if ok:
                        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
                if ok:
                    found[i] = mat_apply(mat, cx, cy)
                    matched_fills.add(f)
        for ch in el:
            walk(ch, mat, f)

    walk(ET.fromstring(svg_text), MAT_ID, None)
    return found, matched_fills


def viewbox(svg_text):
    # dvisvgm emits single-quoted attributes
    m = re.search(r'''viewBox=["']([^"']+)["']''', svg_text)
    return m.group(1) if m else None


def latex_error(work, sid):
    """Pull the '! ...' error line(s) out of the latex log for a SKIP message."""
    log = os.path.join(work, f"{sid}.log")
    try:
        lines = open(log, errors="replace").read().splitlines()
    except OSError:
        return "(no log)"
    errs = [ln for ln in lines if ln.startswith("!")]
    return " | ".join(errs[:2]) if errs else "(no '!' line in log)"


def build_symbol(sid, sym):
    work = os.path.join(OUT, "_work", sid)
    os.makedirs(work, exist_ok=True)
    tex = os.path.join(work, f"{sid}.tex")
    with open(tex, "w") as f:
        f.write(tex_for(sym))
    run(["latex", "-interaction=nonstopmode", "-halt-on-error", f"{sid}.tex"], work)
    run(["dvisvgm", "--no-fonts", "--exact-bbox", f"--output={sid}.svg", f"{sid}.dvi"], work)
    svg_text = open(os.path.join(work, f"{sid}.svg")).read()

    centres, matched_fills = pin_centres(svg_text, PIN_COLORS[:len(sym["pins"])])
    pins = []
    for i, _ in enumerate(sym["pins"]):
        c = centres.get(i)
        if c is None:
            print(f"  WARN {sid}: pin {i} marker ({PIN_COLORS[i]}) not located")
            continue
        pins.append({"id": f"p{i}", "x": round(c[0], 3), "y": round(c[1], 3)})

    # Recolour the markers to a neutral terminal dot in the shipped SVG.
    # Substitute the EXACT colour strings dvisvgm emitted (collected during the
    # walk) plus the authored long/short forms — the palette can come back a
    # couple of LSBs off after the xcolor float round-trip.
    forms = set(matched_fills)
    for col in PIN_COLORS[:len(sym["pins"])]:
        forms.update({col, short_hex(col)})
    for form in forms:
        svg_text = re.sub(re.escape(form) + r"(?![0-9a-fA-F])",
                          PIN_DOT, svg_text, flags=re.I)

    with open(os.path.join(SVG_DIR, f"{sid}.svg"), "w") as f:
        f.write(svg_text)
    print(f"  ok  {sid}: {len(pins)} pin(s)")
    return {"svg": svg_text, "pins": pins, "viewBox": viewbox(svg_text)}


def main():
    if shutil.which("dvisvgm") is None:
        raise SystemExit("dvisvgm not found — run on a machine with TeX Live.")
    os.makedirs(SVG_DIR, exist_ok=True)
    catalog = {}
    skipped = []
    for sid, sym in SYMBOLS.items():
        # Fault-tolerant: a bad macro/anchor in one symbol must not halt the
        # batch — report SKIP with the latex error and keep going.
        try:
            catalog[sid] = build_symbol(sid, sym)
        except subprocess.CalledProcessError as e:
            work = os.path.join(OUT, "_work", sid)
            detail = latex_error(work, sid) if "latex" in e.cmd[0] else str(e)
            print(f"  SKIP {sid}: {detail}")
            skipped.append(sid)
        except Exception as e:  # extraction/parse failures
            print(f"  SKIP {sid}: {type(e).__name__}: {e}")
            skipped.append(sid)

    with open(os.path.join(OUT, "symbols.js"), "w") as f:
        f.write("window.SYMBOLS = " + json.dumps(catalog, indent=1) + ";\n")
    print(f"\nWrote {len(catalog)} symbols -> out/symbols.js  (open harness.html)")
    if skipped:
        print(f"SKIPPED {len(skipped)}: {', '.join(skipped)}")


if __name__ == "__main__":
    main()
