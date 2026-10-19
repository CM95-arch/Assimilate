# Design decisions — territory redesign

These are the choices made while implementing *ASSIMILATE — Major Gameplay Redesign*. The earlier
biology design (build 0.1.x) is replaced. Its history is in git, and saves from it are set aside
with a notice. Numbers live in `src/config/`.

## Your answers

| Question | Answer → implementation |
| --- | --- |
| Starting pace | About 1 neutral capture per second (`BASE_STATS.rate` 1.05 × 92% success) |
| Being wiped out | The run ends with a summary and a new run. Prestige rewards come in a later phase |
| Rival strength | A rival gets your earned energy ±15% plus the same starting energy when it appears, spends it immediately on **its own** route (profile × a random personal twist), then earns and spends by the same rules as you |
| First contact | The first rival sits 14–17 cells away. In testing, contact came after 55–90 s |

## What was reused and what was removed

- **Reused:** the web-app setup, the playable link, saving (backup, corrupt-save recovery), number
  formatting, the interface shell (HUD, tabs, panels, dialogs, toasts, the error card), sound
  synthesis, the camera's eased zoom, rounded-block drawing, the browser test harness and the
  single-file build.
- **Removed:** reproduction timers, maturation, soil fertility, rocks, the fixed board and its
  "world filled" ending, the Rule Lab, the Mutations and Evolution tabs, and all biology wording.

## The rules (where the behaviour comes from)

**Expansion budget, not per-cell timers.** Each faction earns
`rate × (1 + 0.06 × √cells)` attempts per second. Bigger territory helps only slowly, so growth is
roughly steady rather than exponential (a test checks this).

**Choosing a target.** For each attempt the faction samples a few of its own border cells (4, or
more with Frontier Coordination) and scores every neighbouring cell it doesn't own:

| Factor | Effect | Upgrade |
| --- | --- | --- |
| Open ground vs enemy | Enemy cells start at 0.6× preference | Aggression raises it |
| Own neighbours (3×3) | Prefer gaps (compact) or open space (fingers) | Consolidation / Branching |
| Distance from own centre | Prefer outermost edges | Directional Momentum |
| Enemy cell's defenders and our touching sides | Prefer weak points and cells already half-surrounded | Flanking |
| Our border cell was attacked recently | Concentrate there | Threat Response |
| We lost the target recently | Retake it | Recovery |

One target is picked at random in proportion to these scores. Nothing names flanking or
encirclement; they come from the scores interacting on the board. Tests check that Branching
gives at least 1.6× the exposed edge of Consolidation, that Momentum stretches territory, and
that Aggression and Flanking shift where attacks land.

**Conversion.** `chance = 0.75 × attack / (attack + defence)`, where
`attack = power × (1 + pressure × our sides touching the cell)` and
`defence = resistance × (1 + reinforcement × its friendly sides) × (1 + entrenchment × time held)`.
Thin lines and tips fall easily and solid blocks hold, so shape matters without special rules.
Neutral cells succeed 92% of the time.

**Energy.** You get 1 per neutral claim and 3 per conversion, before Energy Yield and Conquest
Bonus. You start with 10, enough for a first upgrade. In testing a simple player bought 10–11
levels in the first 60 seconds.

## Upgrades in this build (17 of the 27 listed)

- **Expansion:** Expansion Rate, Branching, Consolidation, Directional Momentum, Frontier
  Coordination.
- **Combat:** Conversion Power, Aggression, Pressure.
- **Defense:** Resistance, Reinforcement, Entrenchment, Recovery.
- **Strategy:** Flanking, Threat Response.
- **Economy:** Energy Yield, Conquest Bonus, Upgrade Cost Reduction.

The four starters are available from the first second. Others unlock as you earn energy during
the run, and rivals follow the same unlock rule.

**Not built yet:** Expansion Efficiency, Expansion Reach, Attack Frequency, Breakthrough,
Overrun, Counterpressure, Adaptability, Isolation, Target Selection and Passive Income. Each one
is a new stat or scoring factor, so the structure supports them without rewrites. Expansion
Reach (claiming non-adjacent cells) is the one that needs a small rule addition.

## Infinite world

- The grid is stored in 32×32 chunks, created only where territory has existed. Empty space costs
  nothing.
- Each faction keeps an exact set of its border cells, and all work happens there. A test audits
  these caches against the grid after long battles.
- **Rivals appear** every 2 s if fewer than `2 + reach/28` rivals are near you, at
  `reach + 26–46` cells from your centre. The site must be empty for a 13×13 area and at least
  12 cells from any territory. At most 9 rivals are alive at once. Eliminated rivals free their
  slot, so the world never stays crowded.
- **Dormancy:** factions more than about 140 cells beyond your reach pause until you come near.
  This keeps an infinite world affordable. A rival that is paused behind you doesn't grow;
  simulating distant regions coarsely is planned with offline progress.

## Camera

The camera follows your territory and widens at 11 scale steps (17 → 680 cells across). Each
step eases over 2.4 s with a banner. Drag to pan, pinch or scroll to zoom (0.25×–4×). The ◎
button returns to the automatic view. Opening a panel shortens the view without changing the zoom.

## Open questions for later phases

1. **Prestige formula:** I suggest points from peak territory, rivals eliminated and energy
   earned, with diminishing returns so short runs don't farm. I'll propose numbers when building it.
2. **Offline progress:** I suggest an aggregate model: territory and energy grow at your recent
   rates, fronts move by their recent net rate, capped at 12 h. A run can't be lost while you're
   away; it pauses at a minimum size instead.
3. **Ending a run on purpose:** prestige needs a way to cash in a run. I suggest an "End run"
   button that becomes available after a territory milestone.
