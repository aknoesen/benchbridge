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
import shutil
import subprocess
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SVG_DIR = os.path.join(OUT, "svg")

# Distinct, unlikely-to-collide pin marker colours (one per pin index).
PIN_COLORS = ["#ff00ff", "#00ffff", "#ffff00", "#ff8000", "#8000ff", "#00ff80"]
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


def pin_centres(svg_text, colors):
    """{pin index: (x,y) in viewBox coords} for the marker elements, found by
    fill colour (own or inherited) and mapped through the transform chain."""
    want = {norm_color(c): i for i, c in enumerate(colors)}
    found = {}

    def walk(el, mat, fill):
        t = el.get("transform")
        if t:
            mat = mat_mul(mat, parse_transform(t))
        f = el.get("fill") or fill
        tag = el.tag.split("}")[-1]
        if tag in ("circle", "path") and el.get("fill") != "none" \
                and norm_color(f) in want and want[norm_color(f)] not in found:
            if tag == "circle":
                cx, cy = float(el.get("cx", "0")), float(el.get("cy", "0"))
            else:
                # bbox centre of the path coords (marker paths are simple
                # circle outlines: every command takes coordinate pairs)
                coords = nums(el.get("d", ""))
                xs, ys = coords[0::2], coords[1::2]
                if not xs:
                    return
                cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            found[want[norm_color(f)]] = mat_apply(mat, cx, cy)
        for ch in el:
            walk(ch, mat, f)

    walk(ET.fromstring(svg_text), MAT_ID, None)
    return found


def viewbox(svg_text):
    # dvisvgm emits single-quoted attributes
    m = re.search(r'''viewBox=["']([^"']+)["']''', svg_text)
    return m.group(1) if m else None


def main():
    if shutil.which("dvisvgm") is None:
        raise SystemExit("dvisvgm not found — run on a machine with TeX Live.")
    os.makedirs(SVG_DIR, exist_ok=True)
    catalog = {}
    for sid, sym in SYMBOLS.items():
        work = os.path.join(OUT, "_work", sid)
        os.makedirs(work, exist_ok=True)
        tex = os.path.join(work, f"{sid}.tex")
        with open(tex, "w") as f:
            f.write(tex_for(sym))
        run(["latex", "-interaction=nonstopmode", "-halt-on-error", f"{sid}.tex"], work)
        run(["dvisvgm", "--no-fonts", "--exact-bbox", f"--output={sid}.svg", f"{sid}.dvi"], work)
        svg_text = open(os.path.join(work, f"{sid}.svg")).read()

        centres = pin_centres(svg_text, PIN_COLORS[:len(sym["pins"])])
        pins = []
        for i, _ in enumerate(sym["pins"]):
            c = centres.get(i)
            if c is None:
                print(f"  WARN {sid}: pin {i} marker ({PIN_COLORS[i]}) not located")
                continue
            pins.append({"id": f"p{i}", "x": round(c[0], 3), "y": round(c[1], 3)})

        # Recolour the markers to a neutral terminal dot in the shipped SVG
        # (dvisvgm may emit either the full or the shortened hex form).
        for col in PIN_COLORS[:len(sym["pins"])]:
            for form in {col, short_hex(col)}:
                svg_text = re.sub(re.escape(form) + r"(?![0-9a-fA-F])",
                                  PIN_DOT, svg_text, flags=re.I)

        with open(os.path.join(SVG_DIR, f"{sid}.svg"), "w") as f:
            f.write(svg_text)
        catalog[sid] = {"svg": svg_text, "pins": pins, "viewBox": viewbox(svg_text)}
        print(f"  ok  {sid}: {len(pins)} pin(s)")

    with open(os.path.join(OUT, "symbols.js"), "w") as f:
        f.write("window.SYMBOLS = " + json.dumps(catalog, indent=1) + ";\n")
    print(f"\nWrote {len(catalog)} symbols -> out/symbols.js  (open harness.html)")


if __name__ == "__main__":
    main()
