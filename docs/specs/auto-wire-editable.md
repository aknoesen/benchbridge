# SPEC — ARB-3b: Auto wiring is a seed you can edit (click a generated jumper to take over)

Read `docs/CONVENTIONS.md`, `docs/specs/board-autoroute.md` (ARB-3, the manual/hint/auto engine), and
`docs/PROGRESS.md` first. **Board / UI only — no `core/signal.ts`; no change to `checkEquivalence` /
`boardNets` / `autoRouteJumpers` semantics.** Small interaction addition on top of the shipped ARB-3.

## Problem
In **Auto** routing the generated jumpers are **read-only** and are not even stored in `board.jumpers`
(the component renders `autoJumpers` computed on the fly). So a student who sees an awkward auto-route —
e.g. a feedback resistor wired with a needless crossing — **cannot delete that one jumper and rewire it**;
their only option is to abandon Auto and rebuild in Manual. This blocks the core lesson: *auto gives you a
correct starting board, then you refine the ugly parts by hand.*

## Decision locked (andre, 2026-07-02)
**Auto wiring becomes an editable seed via click-to-grab.** In Auto, **clicking any generated jumper**:
1. **Bakes the full generated set into `board.jumpers`** (materialise `autoRouteJumpers(...)` → plain
   `{a,b}` jumpers — the *same* materialisation the auto-mode Save already uses, factor it into one shared
   helper so Save and take-over agree).
2. **Deletes the clicked jumper** from that now-editable set.
3. **Switches `boardRouting` from `auto` → `manual`** so the board is now the student's own wiring, and
   normal Manual editing applies (click a jumper to delete, Jumper tool to add). **Check grades
   `board.jumpers`** from here as in Manual.
4. Takes **one undo `snapshot`** so the whole take-over (bake + delete) is a single Ctrl-Z.

After take-over the student is simply in Manual with a pre-filled board. Re-selecting **Auto** regenerates
the read-only wiring as before (their manual edits remain in `board.jumpers`, ignored by Auto's display
until they switch back to Manual — acceptable; a small "switching to Auto replaces the view, your edits are
kept in Manual" nuance, no guard needed for v1).

## UX / feedback
- The Auto banner ("Auto wiring — jumpers are generated (read-only)") must update the moment the student
  takes over — since we flip to Manual, the existing mode indicator/banner should reflect Manual
  automatically; verify it does and isn't stuck on the Auto text.
- Optional tiny hint near the Auto control: "click a wire to take over and edit it." Keep it short.

## Implementation
- One shared pure-ish helper to materialise generated jumpers (used by both Save and take-over), e.g.
  `materializeAutoJumpers(autoJumpers) → Jumper[]` (strip the `note`), so the two paths can't diverge.
- The click handler lives on the **auto** jumper render group (today `routing === 'auto' && autoJumpers.map`
  in `Breadboard.tsx`, the read-only block): on click → `setBoard(b => ({...b, jumpers: baked-minus-clicked}))`,
  `onRoutingChange('manual')`, `snapshot()`, `setCheck(null)`.
- **No engine change:** `autoRouteJumpers` and `checkEquivalence` are untouched; this only changes what a
  click in Auto does and where the jumpers are stored.

## Out of scope
- No `core/signal.ts`; no change to the routing engine, Check, or net logic.
- Not building per-jumper editing *while staying labelled "Auto"* — taking over means becoming Manual
  (simplest, honest model). Hint mode is unchanged (its ghost is never editable).

## Definition of Done
- In Auto, clicking a generated jumper bakes the rest into the student's editable jumpers, removes the
  clicked one, and drops the board into Manual; the student can then delete/add any jumper and Check grades
  their wiring. One undo restores the pre-click Auto state. Save still persists correctly (the shared
  materialiser). `npm run build` clean; a test on the shared materialiser (auto set → `board.jumpers`,
  clicked one removed). No `core/signal.ts`; 12-bit canary −104 dBFS.
- ROADMAP note (ARB-3b → DONE) + PROGRESS entry.

## Files
**Allowed:** `src/components/Breadboard.tsx` (the click-to-grab handler + the shared materialiser call),
`src/core/breadboard.ts` (only if the shared materialiser helper lands here — pure, additive), tests,
`docs/*`.
**Forbidden:** `core/signal.ts`; `autoRouteJumpers` / `checkEquivalence` / `boardNets` behaviour.
