# WIRE-1 — Connection-first schematic (wires stop being editable geometry)

**Decision (andre, 2026-07-13):** *"I find polyline awkward — what other options are there?"* → **connection-first,
auto-routed.** You declare a connection (click pin A, click pin B). The app draws the route and re-draws it
whenever anything moves. There is no wire to grab, slide, tear or loop.

## Why this is the right model for BenchBridge

Nothing downstream of the drawing uses wire geometry:

- `toCircuit` → the netlist → ngspice: uses **nets**.
- The board Check (`schematicExpectation`, `checkEquivalence`, `boardNodeMap`, `autoRouteJumpers`): uses **nets**.
- The whole point of the tool: teach **connectivity**, not draftsmanship.

Wire geometry is therefore work the product asks of the student and then never uses — and it is where every bug of
2026-07-13 lived (severed connections, torn runs, closed rectangles, wire soup). Delete the geometry, delete the
bug class.

## The one architectural insight that keeps this small

Every consumer reaches nets through **one** function:

```ts
computeNets(s): Map<"gx,gy", netName>   // "what net is the pin at this point on?"
```

Nobody inspects `s.wires`. So we keep that signature and change only how it is derived: **union the pins named by
`s.connections`** instead of union-by-coordinate. `toCircuit`, `netlist.ts`, `breadboard.ts` and the Check are
then **untouched** — which is exactly what we want, because those are the protected, regression-prone paths
(`docs/reference/m2k-instrument-model.md`).

## Model

```ts
type PinRef = { id: string; pin: number }        // component id + terminal index (terminalsOf order)
type Conn   = { a: PinRef; b: PinRef }

interface Schematic {
  components: SchComponent[]
  connections: Conn[]
  wires?: Wire[]        // LEGACY ONLY — read on load, migrated, never written
}
```

- A connection is between **pins**. There are no free-floating wire vertices, so there is nothing to drag.
- **Coordinate coincidence no longer connects — SETTLED (andre, 2026-07-13).** Dropping a ground symbol on top of
  a scope − does nothing until you connect them. One way to connect, no hidden wiring. This *enforces* the
  completeness corollary (instrument model: "the schematic is COMPLETE; there are NO inferred connections") —
  today a touch-connection is an inferred connection in all but name. The migration turns every existing
  touch-connection into a real connection, so no example loses anything.

## Rendering

`routeConnections(s): Wire[]` — pure, display-only. Each connection is routed orthogonally (L or Z), with a bend
heuristic that leaves a pin along its natural direction and avoids crossing component bodies where it can.
Junction dots where routes meet. The result is **derived on every render** — it is never stored, never edited.

## Migration (lossless, electrically)

Old saves and all 23 examples carry `wires`. On load:

1. Compute nets from the geometry, the way we do today (the existing coordinate union-find).
2. For each net, take the **pins** on it and emit a spanning tree of connections between them.

Nets are preserved exactly ⇒ **the sim-equivalence baseline must stay byte-identical.** That is the acceptance
gate for the whole migration. Bare wire corners (points with no pin) simply cease to exist — they carry no
electrical meaning.

`examples.ts` keeps its `wires` for now and migrates on load; a later pass can rewrite the examples as connections.

## Editor gestures (what replaces wire editing)

- **Connect:** click pin A → click pin B. (This already exists — the pin-magnetic gesture.)
- **Disconnect:** click a route → Delete. (Deletes the *connection*, not a segment.)
- **Move a part:** routes re-draw. Nothing to rubber-band, nothing to bridge, nothing to tear.
- **Gone:** the Wire tool's free-form geometry, segment dragging, endpoint dragging, corner dragging — all of
  SCH-16/16b. Keep the code in git history; delete it from the editor.

## Open product question (defer to v1 feedback)

Auto-routing means the drawing is the app's aesthetic choice. On a dense op-amp circuit the router will sometimes
pick a route andre would have drawn better, with no way to override. **v1: no override.** If it grates, the
cheapest escape hatch is a per-connection "flip the bend" toggle (one bit, still no free geometry) rather than
re-introducing editable wires.

## Definition of Done

- `npm run build` clean; `npm test` green.
- **The sim-equivalence baseline (`__fixtures__/sch11-sim-baseline.json`) is BYTE-IDENTICAL.** This is the proof
  the migration preserved every net in every example. If it moves, stop.
- The board Check still passes on every example that passed before (rc-lp, flashlight, divider, the amps).
- The `sch11-invariance` snapshot WILL move (its point-map loses the bare wire corners) — regenerate and eyeball
  that only geometry points changed, no circuit/probe lines.
- 12-bit canary untouched (`core/signal.ts` not in the diff).
- Live: load every example — each is drawn with clean orthogonal routes; move a part and its routes follow; no
  gesture can produce a severed or duplicated connection.
- PROGRESS + ROADMAP updated; specs committed.

## Staging — REVERSIBLE UNTIL STAGE 3 (each stage ships green)

The one thing that could make this a *downgrade* is auto-routing reading worse than andre's hand-laid examples.
So the plan finds that out **before** anything is torn out: stages 1–2 are purely additive, and **Stage 2 is the
go/no-go** — andre looks at all 23 examples auto-routed, side by side with today's, and can call it off having
lost nothing but time.

| Stage | Lands | Proven by | Reversible |
|---|---|---|---|
| **1. Core** | `connections` model + lossless migration + `computeNets` derived from connections. Drawing unchanged. | **Sim baseline byte-identical** + board Check passes on every example | Yes — nothing user-visible |
| **2. Router** | `routeConnections()` draws every example from connections | **andre's eyes — GO/NO-GO** | Yes — editor untouched |
| **3. Gestures** | connect / disconnect; rip out SCH-16 wire dragging + the free-form Wire tool | live: no gesture can sever or duplicate a connection | Harder — this is the commitment |
| **4. Cleanup** | examples + save format v2 as connections | full suite | — |

**The hard gate in Stage 1:** `src/core/__fixtures__/sch11-sim-baseline.json` must stay **BYTE-IDENTICAL**. It
records every example's actual waveforms; if the migration preserved every net it cannot move. If it moves by one
bit, the migration is wrong — **stop, do not regenerate it.**
