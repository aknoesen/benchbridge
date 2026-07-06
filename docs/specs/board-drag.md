# SPEC — ARB-5: Board direct manipulation (drag to place / move / replace)

Read `docs/CONVENTIONS.md`, `docs/specs/breadboard.md`, and `docs/PROGRESS.md` first. **No
`core/signal.ts` change** (12-bit canary untouched). This adds *new* pure helpers to
`core/breadboard.ts` but **must not alter `checkEquivalence`, `boardNets`, hole geometry
(`buildHoles`/`PITCH`/`PAD`/`OY`), or `autoRouteJumpers`.**

**Background / why:** "Drag from the schematic" was a locked Track F decision (see ROADMAP Track F
decisions + the F-2 PROGRESS notes), but what shipped is **click-to-place** (`onNode`: pick the chip,
click hole A, click hole B). There is no drag on the board today. andre confirmed (2026-07-02) the board
should support real direct manipulation: **drag a part onto the board, drag a placed part to move it, and
drag to swap/replace or remove.** Decision (andre): **moving a part removes its associated jumpers.**

The board part model is keyed by **schematic id** — each schematic component maps to at most one placed
board part (`board.parts.filter(p => p.id !== id)` on place). So "move" = re-place the same id; "replace"
means one part displacing another off a set of holes.

---

## What to build

### 1. Drag to place (chip → board)
- Make the **"Place from schematic"** chips (parts, DIPs, transistors) draggable. On drag-drop onto the
  board SVG, place the part with **pin A at the hole nearest the drop point** and **pin B at the default
  span** along the part's default orientation (vertical across rows, same default the click flow implies),
  choosing free holes and honouring `MIN_RESISTOR_HOLES`. If no valid pair fits at the drop point, no-op
  with the existing "too tight / pick another hole" style hint.
- **Keep click-to-place working** exactly as today (select chip → click A → click B). Drag is an added
  path, not a replacement of the click flow.
- Implementation: pointer-based drag preferred (pointerdown on the chip → track → pointerup over a hole),
  or HTML5 DnD (`draggable` chip + `onDrop` on the SVG). Either is fine; snap to the nearest hole via a
  small `nearestHole(holes, x, y)` helper (screen→SVG coords). Note (from PROGRESS): the Chrome-automation
  `left_click_drag` emits **mouse**, not **pointer** events — so automated drag may not exercise pointer
  handlers; verify live. Prefer plain mouse/pointer events that a real user triggers.

### 2. Drag to move a placed part
- **pointerdown on a placed part body** (Select tool) starts a move. The part translates with the cursor,
  snapping **pin A to the nearest hole** under the cursor while **preserving the part's span/orientation**
  (pin B keeps its relative offset). Show it live during the drag.
- On drop: commit if the target holes are on-board and free (ignoring the part's *own* old holes); if the
  drop is invalid, **revert** to the original position.
- **Remove associated jumpers (andre's decision):** on a committed move, drop every jumper whose endpoint
  sat on the part's **old** holes (`aHole`/`bHole`). The student re-wires at the new location. (Jumpers not
  touching the moved part are untouched.)

### 3. Drag to replace / remove
- **Replace:** if the drop lands the part's holes onto holes already occupied by a **different** placed
  part, that other part is **displaced** — removed from the board (it returns to the "Place from schematic"
  tray, since its schematic id is now unplaced) **along with its jumpers** — and the dragged part takes the
  holes. (No two different components share holes.)
- **Remove:** dragging a placed part and dropping it **off the board area** removes it from the board
  (and its jumpers), returning its chip to the tray.
- Both reuse the same jumper-cleanup rule as move.

### 4. Pure, testable helpers (in `core/breadboard.ts`, additive only)
Add small pure functions the component calls, so the mutation rules are unit-tested (do NOT touch
`checkEquivalence`/`boardNets`/geometry):
```ts
// jumpers whose a or b endpoint is any of holeKeys — the "associated" set to drop.
export function jumpersOnHoles(board: BoardLayout, holeKeys: string[]): number[]      // indices
// move a placed part to new holes AND remove jumpers on its OLD holes; returns a new BoardLayout.
export function movePartOnBoard(board: BoardLayout, id: string, aHole: string, bHole: string): BoardLayout
// remove a placed part (part + its jumpers); returns a new BoardLayout.
export function removePartFromBoard(board: BoardLayout, id: string): BoardLayout
// (optional) displace whatever different part occupies any of holeKeys (+ its jumpers).
export function displacePartsAt(board: BoardLayout, holeKeys: string[], keepId: string): BoardLayout
```
Keep them pure (no DOM), deterministic, and covering DIP/TO-92 pin holes too where a part's footprint
occupies holes (use the existing `dipPinHoles` / `to92PinHoles` to know a part's occupied holes).

---

## Out of scope / not changing
- No `core/signal.ts`; no change to `checkEquivalence`, `boardNets`, hole geometry, `autoRouteJumpers`,
  or the schematic model. Placement/collision/jumper rules are new *additive* helpers + component wiring.
- No rotation UI in this phase (keep the current orientation model); a placed part keeps its span.
- No new runtime dependency.
- ARB-4 look and ARB-2 live behaviour (LED glow, probe) must keep working under the new interactions.

## Definition of Done
- `npm run build` clean; `npm test` green. New `core/breadboard.test.ts` cases: `jumpersOnHoles` finds
  exactly the touching jumpers; `movePartOnBoard` relocates the part and drops only its old-hole jumpers
  (others survive); `removePartFromBoard` drops the part + its jumpers; `displacePartsAt` removes the
  colliding part + its jumpers and leaves the keeper; determinism.
- **Live in Chrome:** drag a chip onto the board → part places at the drop holes; click-to-place still
  works; drag a placed part → it moves and its old jumpers are gone (per andre); drop a part onto another
  → the other returns to the tray (its jumpers gone), the dragged part takes the holes; drag a part off
  the board → it's removed. Check still validates correctly after each; ARB-2 glow/probe and ARB-4 look
  intact; 12-bit canary −104 dBFS.
- ROADMAP (ARB-5 → DONE) + PROGRESS note; one focused commit.

## Files: allowed / forbidden
**Allowed:** `src/components/Breadboard.tsx` (the drag interactions), `src/core/breadboard.ts` (the new
pure helpers ONLY — do not alter Check/boardNets/geometry/router), `src/core/breadboard.test.ts`,
`docs/PROGRESS.md`, `docs/ROADMAP.md`, this spec.
**Forbidden:** `src/core/signal.ts`; the `checkEquivalence`/`boardNets`/geometry/`autoRouteJumpers`
semantics; `src/core/schematic.ts`. If a drag rule seems to need one of those changed, STOP and flag it.
