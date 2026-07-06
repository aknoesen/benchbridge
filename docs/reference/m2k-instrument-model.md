# M2K instrument model — settled invariants (authoritative; do not regress)

**Status:** decision record, owned by andre. Every Claude Code / Cowork session that touches the
schematic editor, the port/instrument rendering, `toCircuit`/netlist port mapping, or the board
Check MUST read this before changing anything here. If a change appears to require violating a rule
below, STOP and flag it — do not "improve" your way past it. These rules have each been decided,
implemented, and then accidentally regressed at least once; this file exists so that stops.

Last reaffirmed: **andre, 2026-07-06.**

---

## The one governing principle

**The schematic follows the designer. The board follows the schematic. The auto-router follows
after parts are placed on the board.**

Concretely, the app may draw a connection **only** when it is a *fixed internal bond of the M2K
hardware*. It must **never** invent, add, or remove a connection that is the designer's choice. When
in doubt about whether something is "hardware-fixed" or "a design choice," it is a design choice —
leave it to the user.

**Corollary — the schematic is COMPLETE; there are NO inferred connections (andre, 2026-07-06).**
Every electrical connection that matters must be drawn. The app never silently supplies a connection
the designer omitted — not in the drawing and not in the sim. A node that needs to be grounded is
grounded by an explicit wire to GND. If a required connection is missing, the schematic is
*incomplete* — flag it; do not paper over it with an inferred/implicit connection.

## The instruments are two-terminal DEVICES, not abstract symbols

Each M2K I/O element is a real two-terminal (or multi-terminal) device with fixed internal wiring.
The schematic shows that wiring honestly.

| Device | Terminals | Fixed internal ground bond — ALWAYS drawn | Designer choice |
|--------|-----------|-------------------------------------------|-----------------|
| **W1** (`awg1`) | output + ground return | return is bonded to the M2K's internal ground (node 0) → **ground glyph always drawn** on the return | where the output goes |
| **W2** (`awg2`) | output + ground return | same as W1 → **ground always drawn** | where the output goes |
| **V+** (`vplus`) | +output, negative reference | negative reference tied to shared **GND** (delivers +V above ground) → **ground always drawn** on the reference pole | where +output goes |
| **V−** (`vminus`) | −output, positive reference | positive reference tied to shared **GND** (delivers −V below ground) → **ground always drawn** on the reference pole | where −output goes |
| **CH1** (`scope1`) | 1+ , 1− | **none** — the − is NOT internally grounded | **the − lead**: wired = differential; left open = single-ended |
| **CH2** (`scope2`) | 2+ , 2− | **none** | **the − lead**: same as CH1 |

Notes:
- The M2K V+/V− are **fixed rails referenced to the shared board ground**, not floating supplies. A
  split ±5 V arrangement grounds the midpoint; the twin draws a ground on each rail's reference pole.
- W1/W2 both returns bond to the **one** internal ground, so a drawn ground on each return is honest.

## Rule 1 — Fixed internal grounds are ALWAYS shown (sources + supplies)

W1, W2, V+, V− each **always** render their internal ground (W1/W2 return; V+/V− reference pole).
This is not optional and not a per-example decision — it is the device. Do not remove it, do not
gate it behind "unwired," do not make it depend on what the user wired. (Implemented: `awg1`/`awg2`
`drawReturnGround`; `vplus`/`vminus`/`dcrail` reference-pole ground in `renderSymbol`.)

## Rule 2 — The scope − is a DESIGNER choice; NEVER auto-ground it

CH1/CH2 have **no** internal ground on their − lead (the M2K scope inputs are differential pairs).
The designer decides the measurement type by wiring the − — and, per the completeness corollary, the
− is **always wired to something**:
- **− wired to a node** → **differential** (reads + minus −).
- **− wired to GND** → **single-ended** (referenced to ground) — an **explicit** wire the designer
  draws.
- **− left open** → **incomplete schematic** (a floating differential input). This is NOT "single-
  ended" — it is a missing connection. Flag it (an unmeasurable/floating channel); do **not** infer a
  ground, neither a drawn glyph nor a silent sim reference.

The app must draw — and simulate — **only what the designer wired**. It must not draw a ground glyph
on an unwired scope −, and the sim must not internally ground an unwired − (both are inferred
connections, forbidden by the corollary).

> **Two things considered and REJECTED (do not re-add):**
> 1. **Auto-drawing** the ground glyph on an unwired scope − ("so students don't read the − as
>    floating" — tester feedback, commit `a752c72`, 2026-07-06). It draws a connection the designer
>    did not make.
> 2. **Inferring** a ground on an unwired − *in the sim* (`toCircuit` treating an untouched − as
>    ground-referenced to keep `.tran` well-posed). Same violation, just hidden in the netlist instead
>    of the drawing.
>
> Both are replaced by the completeness corollary: single-ended means the designer **explicitly wires
> − to GND**. Examples that are single-ended carry that explicit wire (see INST-1's example audit).

## Rule 3 — M2K I/O are singletons

The real bench has exactly one of each. The schematic allows **at most one** of: **CH1** (`scope1`),
**CH2** (`scope2`), **W1** (`awg1`), **W2** (`awg2`), **V+** (`vplus`), **V−** (`vminus`). **GND is
repeatable** (it is the shared reference node; many ground symbols are all node 0). Once an
instrument is placed, its palette item is disabled/greyed and a second placement is blocked.

Rationale: one ADC and one AWG pair — you cannot have two CH1s or two W1s. (See also the shared
scope/voltmeter ADC note: CH1/CH2 are the same 1±/2± probes / one ADC.)

## Rule 4 — Scope and voltmeter share one ADC per channel (mutually exclusive)

Each channel's **1±/2± probe pair is one ADC**. The oscilloscope and the voltmeter are two *views of
the same physical measurement*, not two instruments — the schematic already models this as a single
CH1/CH2 measurement device with a `view: 'scope' | 'voltmeter'` toggle ("the shared CH input — scope
and voltmeter read the same pins"). Therefore a channel is **either** a scope **or** a voltmeter at
any moment, never both:
- If CH1's `view` = scope → CH1 is a scope channel; the **voltmeter's CH1 is unavailable**.
- If CH1's `view` = voltmeter → CH1 is a voltmeter reading; the **oscilloscope's CH1 is unavailable**.
- CH2 independent of CH1, same rule.

This follows directly from Rule 3 (one ADC per channel) — you cannot run the scope and the voltmeter
on the same channel simultaneously. The runtime instrument panels must reflect the channel's `view`:
the Oscilloscope panel shows only channels whose view is `scope`; the Voltmeter panel shows only
channels whose view is `voltmeter`; the other panel marks that channel unavailable (greyed, "in use
by the scope/voltmeter"), not blank-but-live. (Exact "unavailable" affordance is a UX detail for
andre; the invariant — never both at once on one channel — is fixed.)

## Change protocol for this area

- Touch the scope − rendering? Rule 2 — remove/keep it OFF; and DO NOT touch Rule 1's source/supply
  grounds in the same edit (they share `renderSymbol` and the `drawReturnGround` path — the scope
  branch is the only one that must change).
- Add a new source/supply? It gets its fixed internal ground drawn (Rule 1).
- Add a placement guard? Cover the full singleton set (Rule 3).
- Every change here needs a **test that locks the invariant** so the next session cannot silently
  regress it (see the spec's acceptance criteria).
