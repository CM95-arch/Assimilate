# Phase report — build 0.1.0 (Phase 1: Living Grid)

## 1. What was built

- **Living grid.** A 200×320 world of pale soil blocks with small gaps and rounded corners.
  Soil fertility varies (slightly darker means richer) and light-grey rock clusters act as
  obstacles. Both are generated from the world seed.
- **One black starting cell** that reproduces automatically using the local rule in
  `src/sim/growth.ts` (see *Emergence* in `DESIGN_DECISIONS.md`).
- **Birth animation.** Each newborn appears at half size, expands and settles with a small
  elastic bounce. Births are spread across each tick, so growth reads as continuous. Newborns
  start dark grey and turn black as they mature, which shows the growing front.
- **Automatic zoom.** Seven scales, triggered at population milestones (70, 220, 650, 1.7K,
  4.2K, 10K), or earlier if the colony nears the edge of the view. Each zoom eases over 2.6 s
  with a banner and a soft whoosh.
- **HUD:** population with births/s, territory share, and status (Growing / Slowing /
  Dormant / Paused / Filled) with scale and speed.
- **Simulation controls:** pause/resume and 1×/2×/4× speed, always visible above the tabs.
  The space bar also pauses on a computer.
- **Panels:** Colony (live facts, plain-language rules, replay or new world), Stats (this
  world and lifetime), Settings (sound, volume, reduce motion, diagnostics, Rule Lab, save
  now, reset). Upgrades, Mutations and Evolution are visibly locked and say which phase brings
  them.
- **Sound:** synthesized soft pops for births (rate-limited and quieter when busy), clicks,
  and a zoom whoosh.
- **Saving:** automatic every 10 s and when the app is hidden. The save is versioned and
  validated, with a backup copy. A corrupted save starts fresh with a message.
- **Developer tools:** a diagnostics overlay and a Rule Lab with live trait sliders.

## 2. How to test it (step by step)

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Open the game fresh | One black square in the middle of pale soil, and a dark tip at the top. "Got it" dismisses it for good |
| 2 | Watch for 10–20 s | The square divides; newborns pop in grey, bounce slightly, darken to black. Population and births/s climb |
| 3 | Tap anywhere, then listen | Soft pops as cells are born (sound needs one tap first) |
| 4 | Wait ~30–60 s | A smooth zoom-out with a "Scale 2" banner. More soil and rock come into view |
| 5 | Tap ⏸ | Growth stops; status says Paused. Tap ▶ to resume |
| 6 | Tap 4× | Growth runs four times faster. The shapes look the same as 1×, just sooner |
| 7 | Tap each bottom tab | Each panel opens; the colony stays visible above it. Close with ✕, the same tab, or Esc |
| 8 | Colony → Replay world → Replay | Same terrain, back to one cell |
| 9 | Colony → New world → New world | New terrain (new seed), back to one cell |
| 10 | Settings → Developer → Open Rule Lab, drag **Branching** to 3+ and **Crowd refusal** to 2+ | New growth becomes lacy and finger-like within seconds. *Restore default rules* resets it |
| 11 | Drag **Branching** to −2 and Crowd refusal to 0 | New growth fills in compactly |
| 12 | Turn on **Diagnostics** | A small dark readout shows fps, tick rate, frontier size and one live decision with its option weights |
| 13 | Close the browser and reopen | Same colony, scale, speed and settings |
| 14 | Settings → Reset all progress… | Delete stays disabled until you tick the box. After deleting, everything starts over |

Automated:

- `npm test`: 25 unit tests, covering determinism, growth only into adjacent empty
  non-rock cells, cache consistency, dormancy, maturation, filling the world, the decision
  rule, emergent shape differences between rule sets, round (not diamond) shapes, early
  pacing, save round-trips, backup recovery, corrupt and future saves, storage failures and
  number formatting.
- `npm run e2e`: 24 browser scenarios on a 390×844 phone and a 320×568 small phone. They
  cover every tab and close method, pause and speed (measured tick rates), live values, the
  zoom animation and banner, settings persisting, progress persisting, Rule Lab, the
  replay/new-world/reset dialogs (cancel, backdrop and confirm paths), the filled-world
  dialog, corrupted-save recovery, overlap and touch-target checks, and a 15,000-cell
  performance check.

**Not yet tested on a physical iPhone or Android device.** That is the first thing to do with
this build.

## 3. Defects found and fixed during this phase

- **Diamond-shaped colonies.** Pure 4-neighbour growth with a branching preference let
  axis-aligned tips outrun diagonal edges. Measured and fixed by adding a weak diagonal growth
  option (20%). A test now guards against it.
- **Seams between blocks at far zoom.** Square blocks used the smaller of their rounded
  width and height, leaving uneven one-pixel lines (a moiré). Each edge is now rounded to
  device pixels separately, and gaps turn off below 6 px per cell.
- **Reset didn't reset.** The page saved itself again while reloading after "Delete
  everything", restoring the old game. Saves are now blocked during a reset. Found by the
  e2e suite.
- **Number formatting.** `2.3B` displayed as `2.29B` because of floating-point rounding
  (this also affects Accrete's formatter). Fixed with a small epsilon.
- **Rock layout.** The first rock noise lined up in visible rows. Rotated sample coordinates
  and a second octave now make the clusters irregular.

## 4. UI / UX audit (§20.6)

✓ = checked in the e2e suite and/or by reviewing screenshots. ◐ = needs a real device.

| Check | Status |
| --- | --- |
| Every button functions | ✓ |
| Every menu opens and closes (tab, ✕, Esc, backdrop) | ✓ |
| Values update live | ✓ |
| Locked features clearly identified | ✓ (lock badge + phase note) |
| Popups always dismissible | ✓ |
| Touch targets ≥ 38 px (most 44+) | ✓ |
| No overlap at 390×844 and 320×568 | ✓ |
| Safe areas respected | ◐ (uses `env(safe-area-inset-*)`, not yet seen on a notched phone) |
| Settings persist | ✓ |
| Save/load preserves progress | ✓ |
| Corrupted saves handled | ✓ |
| Numbers formatted consistently | ✓ |
| Responsive with many cells | ✓ (15K cells: ~0.03 ms/tick, ~3 ms/frame headless) |
| Reduced motion respected | ✓ (system setting + in-game toggle) |

## 5. Next: Phase 2 (Biomass Economy)

Proposed design, for your review:

- Every living cell produces biomass in proportion to its soil fertility, and pays a flat
  upkeep. New cells cost biomass, so the colony can only grow as fast as its economy allows.
  Rich soil becomes economically valuable, not just a growth preference.
- HUD: Biomass total with net/s replaces Territory as the first stat, and Territory moves to
  the middle.
- First upgrades (§13.1–13.2): Reproduction Rate, Growth Efficiency, Cell Maturation,
  Branching Tendency, Biomass Production, Metabolic Efficiency. Each one maps onto an
  existing trait or an economy number, so its effect is visible in the colony's shape or
  speed.
- Progressive starvation (§8.5): when net biomass is negative and reserves are empty,
  division slows, then the poorest-soil edge cells lose health and die. The colony contracts
  until it's sustainable again.
- The Rule Lab stays as a developer tool until upgrades fully cover it.
