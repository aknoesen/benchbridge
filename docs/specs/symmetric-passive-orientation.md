# ARB-7 — Symmetric passives are orientation-agnostic in the board Check + auto-router

**Status:** spec (Cowork, 2026-07-06) — ready for Claude Code to build/test/commit.
**Scope:** pure core (`src/core/breadboard.ts`) + tests. **No `core/signal.ts`** (12-bit canary untouched).
**Trigger:** andre, 2026-07-06 — building the voltage divider, a resistor placed/flipped so its
"wrong" leg faces R1 makes `checkEquivalence` report *"R1 pin A and R2 pin B are different nodes,
but your board connects them,"* even with Auto wiring on. A resistor is electrically symmetric; the
app should not care which physical leg is terminal A.

---

## The bug

`PLACEABLE_KINDS` (breadboard.ts) treats **all** 2-leg parts identically:

```
PLACEABLE_KINDS = { resistor, capacitor, inductor, diode, led, zener, photodiode }
```

Both `checkEquivalence` and `autoRouteJumpers` hard-bind a placed part's physical legs to fixed
schematic terminals:

```ts
schem.set(`${p.id}.A`, p.a); brd.set(`${p.id}.A`, bn(pl.aHole))   // check
schem.set(`${p.id}.B`, p.b); brd.set(`${p.id}.B`, bn(pl.bHole))
addPin(p.a, pl.aHole, `${p.id}.A`); addPin(p.b, pl.bHole, `${p.id}.B`)  // router
```

For a **polarized** part (diode/LED/zener/photodiode) that leg→terminal identity is correct and is
the pedagogical point — a backwards LED must fail. For a **symmetric** part (R/C/L) it is wrong:
terminal A vs B is an arbitrary label on the schematic, so a physically valid board that orients the
part the other way is rejected.

## Desired behavior

- **Symmetric parts** — `resistor`, `capacitor`, `inductor`: either leg may serve either schematic
  terminal. Any orientation that reproduces the schematic's *topology* passes Check; the router
  produces a passing wiring regardless of how the student oriented the part.
- **Polarized parts** — `diode`, `led`, `zener`, `photodiode`: unchanged. Orientation still matters;
  a reversed part still fails Check. (`rotatePartOnBoard` already treats the leg→net remap as "the
  point" for these — keep that.)

### Open decisions (flag to andre if you disagree)
1. **Electrolytic capacitors.** SCH-10 added a polarized electrolytic variant, but there is no
   separate `SchKind` for it and the netlist's `C` element is electrically symmetric (polarity is a
   physical/safety property the sim does not model). **Recommendation: treat all `capacitor` as
   symmetric for now.** If andre wants the board Check to enforce electrolytic polarity, that is a
   separate flag (a `polarized?: boolean` on the component) and its own spec — do not fold it in here.
2. **Non-goal:** this does not change the *schematic*-side net computation or the netlist. Only the
   board↔schematic equivalence mapping and the router change.

---

## Design

Add one predicate near `PLACEABLE_KINDS`:

```ts
export const SYMMETRIC_KINDS = new Set<SchKind>(['resistor', 'capacitor', 'inductor'])
// polarized 2-leg parts = PLACEABLE_KINDS \ SYMMETRIC_KINDS (diode, led, zener, photodiode)
```

The correct equivalence is: **there exists a bijection φ between board-nets and schematic-nets such
that every anchored pin maps consistently, every polarized part's ordered leg pair maps in order, and
every symmetric part's leg pair maps as an unordered pair.** Anchors (ports, polarized part legs,
DIP/TO-92 pins) partially fix φ; symmetric parts propagate it.

### `checkEquivalence`
Replace the "fixed A→a / B→b for every part" pin construction with an orientation resolution for
symmetric parts:

1. Seed φ from all **fixed-identity** pins: ports (`exp.ports`), DIP `pinNets`, TO-92 `pinNets`, and
   **polarized** part legs (`aHole→a`, `bHole→b`). Build board-net→schem-net and the reverse.
2. Propagate through **symmetric** parts as undirected edges to a fixpoint: for a symmetric part with
   board nets `(X, Y)` and schematic nets `(a, b)` —
   - if exactly one endpoint is mapped (`φ(X)=a` ⇒ force `φ(Y)=b`; `φ(X)=b` ⇒ force `φ(Y)=a`);
   - if both mapped, **verify** `{φ(X), φ(Y)} == {a, b}` (else conflict → not equivalent);
   - if neither mapped, defer to a later pass.
3. Any symmetric part still ambiguous after fixpoint (a floating R/C/L with no anchored path — rare
   in these labs) is resolved by **bounded backtracking** over the remaining symmetric parts (count
   is tiny). If no assignment yields a consistent complete φ, not equivalent.
4. **Verdict + messages.** Once φ is fixed, the existing pairwise partition test still gives the
   student-friendly messages — keep `pinLabel` and both "should be the same node — run a jumper" /
   "are different nodes, but your board connects them." wordings. A symmetric-part conflict maps to
   the same messages using its resolved orientation.

Keep all current *pre-checks* (part-missing, DIP rails, INA125 straps, single-supply V−→GND) exactly.

### `autoRouteJumpers`
The router pairs pins the same fixed way (`addPin(p.a, pl.aHole, …)`). For symmetric parts, bind each
leg to the schematic terminal that keeps nets **consistent with the fixed anchors** (same propagation
as the Check), so the generated jumper set realizes the student's actual orientation and the (new)
Check accepts it. Determinism must hold (stable hole ordering already does this).

> Note: because the Check becomes orientation-agnostic, a router that still emitted `aHole→a` would
> usually produce an *electrically valid* board the new Check accepts — but it can also merge two
> distinct nets into one column for an orientation the student did not intend. Resolving symmetric
> orientation from the anchors (above) avoids that and matches what the student built.

---

## Acceptance criteria / tests (add to `breadboard.test.ts`)

1. **Flipped resistor passes.** Voltage-divider schematic; place R2 (or R1) with `aHole`/`bHole`
   swapped vs the schematic's terminal order; a correct jumper set → `checkEquivalence` **ok: true**.
   (This is the exact reported failure — it must go green.)
2. **Divider both orientations.** Check passes for all four R1×R2 orientation combinations given
   topologically-correct wiring.
3. **Reversed diode/LED still fails.** Flashlight schematic; place the LED reversed → `ok: false`
   (polarity preserved). A reversed diode in a diode example → `ok: false`.
4. **Auto round-trips a flipped placement.** `checkEquivalence(s, { ...board, jumpers:
   materializeAutoJumpers(autoRouteJumpers(s, boardWithFlippedR, holes)) }, holes)` → **ok: true**.
5. **No regressions.** Every existing example's pre-built board still checks ok; full suite green;
   `sch11-sim-baseline` untouched (this is board-Check only, not the sim path).

## Definition of Done
- `SYMMETRIC_KINDS` added; `checkEquivalence` + `autoRouteJumpers` orientation-agnostic for symmetric
  parts, unchanged for polarized; all pre-checks and student messages preserved.
- New unit tests (1–5) added and green; `npm test` all green; `tsc && vite build` clean; canary
  untouched; **no `core/signal.ts` diff**.
- Live check in Chrome: rebuild the divider with a resistor flipped → Auto (or a correct manual
  wiring) → Check passes; reverse the flashlight LED → Check still fails.
- Update `ROADMAP.md` (ARB-7 → DONE), `PROGRESS.md`, and append the commit hash to the handoff log.
