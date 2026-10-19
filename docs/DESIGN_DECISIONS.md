# Design decisions — territory redesign

These are the choices made while implementing *ASSIMILATE — Major Gameplay Redesign*. The earlier
biology design (build 0.1.x) is replaced. Its history is in git, and saves from it are set aside
with a notice. Numbers live in `src/config/`.

## Your answers

| Question | Answer → implementation |
| --- | --- |
| Starting pace | Changed after playtesting to about 1 capture every 3 s (see Pace) |
| Being wiped out | The run ends with a summary and a new run. Prestige rewards come in a later phase |
| Rival strength | A rival gets your earned energy ±15% plus the same starting energy when it appears, spends it immediately on **its own** route (profile × a random personal twist), then earns and spends by the same rules as you |
| First contact | Changed after playtesting to about 3.5–4.5 minutes (see Pace) |

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

| Factor | Effect | Set by |
| --- | --- | --- |
| Open ground vs enemy | Enemy cells start at 0.6× preference | Focus slider |
| Own neighbours (3×3) | Prefer gaps (compact) or open space (fingers) | Shape slider |
| Distance from own centre | Prefer outermost edges, or fill in nearer the centre | Reach slider |
| Enemy cell's defenders and our touching sides | Prefer weak points and cells already half-surrounded | Posture slider (exploit) |
| Our border cell was attacked recently | Concentrate there | Posture slider (defend) |
| We lost the target recently | Retake it | Posture slider (defend) |

One target is picked at random in proportion to these scores. Nothing names flanking or
encirclement; they come from the scores interacting on the board. Tests check that each slider measurably changes behaviour.

**Conversion.** `chance = 0.75 × attack / (attack + defence)`, where
`attack = power × (1 + pressure × our sides touching the cell)` and
`defence = resistance × (1 + reinforcement × its friendly sides) × (1 + entrenchment × time held)`.
Thin lines and tips fall easily and solid blocks hold, so shape matters without special rules.
Neutral cells succeed 92% of the time.

**Energy.** You get 2 per neutral claim and 6 per conversion, before Energy Yield and Conquest
Bonus. You start with 10, enough for a first upgrade.

## Upgrades vs behaviour sliders

**Rule:** an upgrade must make a faction strictly better and must never compete with another
upgrade. Anything that trades one preference for another is a free behaviour slider instead.
A unit test enforces this: every upgrade must raise stats (or lower prices) and must not touch
the behaviour stats.

**Behaviour sliders** (Territory tab, each from −1 to +1, free to change at any time):

| Slider | − end | + end | Replaces |
| --- | --- | --- | --- |
| Focus | Claim open ground | Attack enemy cells | Aggression |
| Shape | Compact (fill gaps) | Branching (reach into open space) | Branching vs Consolidation |
| Reach | Even growth | Spearheads at the outer tips | Directional Momentum |
| Posture | Defend: reinforce where attacked, retake lost cells | Exploit: hunt thin, half-surrounded enemy cells | Threat Response + Recovery vs Flanking |

A rival's sliders come from its personality plus a random ±0.3 twist each.

**Upgrades (16):**
- **Expansion:** Expansion Rate; Outposts (some attempts plant a cell 3–5 squares beyond the
  border, on clear open ground, with a ring effect); Coordination (more border sampled per
  attempt, so slider settings are followed more precisely).
- **Combat:** Conversion Power; Pressure; Chain Reaction (a conversion may flip a neighbouring
  cell of the same enemy, up to 6 links, each 40% less likely, popping as a cascade); Siege
  (enemy groups under 150 cells and under half their faction lose resistance).
- **Defense:** Resistance; Reinforcement; Entrenchment; Counterattack (a failed attack on you
  may be answered at once against the attacking cell); Capital (resistance bonus up to
  +50% per level at home, fading to nothing 7 cells out, marked by an inset square).
- **Economy:** Energy Yield; Conquest Bonus; Tribute (+0.25 energy/s per 100 cells per
  level); Upgrade Cost Reduction.

The four starters are available from the first second. The rest unlock as you earn energy
during the run, and rivals follow the same unlock rule. New upgrades will be chosen from the
creative list in the phase report.

## Veins removed (0.2.7)

Veins went through two versions: a visible supply network of lines, then pulses rolling from the
capital to weak spots. Neither added a decision or a feeling of control in playtesting, so it was
removed. Saves that owned it simply drop the level on load.

## Steering: rally flag, landmarks and water (0.3.0)

Playtesting showed the mid-game turning passive: no way to point the territory anywhere, and
nothing on the map worth pointing at. The flag, landmarks and water work together to fix that.

**Rally flag.** Tap open ground or enemy territory to plant your flag; tap the flag (or your own
ground) to take it down. There's only one flag and no upgrades for it. While a flag is up, half of
each attempt's border samples are the nearest of 6 random border cells to the flag, and every
candidate step gets a ×e^(distance gained) preference toward it. In tests that's about 2.7× the
growth toward the flag while the opposite side keeps about half its normal growth and the total
is unchanged. The flag is taken down automatically when your territory reaches its cell.

**Landmarks.** About one in every 48×48 region (50% chance), never within 16 cells of your start or
on water. Holding the cell gives its bonus, and duplicates stack:

| Landmark | Symbol | Bonus |
| --- | --- | --- |
| Spring | ● | +25% energy (claims and conversions) |
| Watchtower | ▲ | +15% resistance |
| War Camp | ◆ | +15% conversion power |
| Crossroads | ✚ | +15% expansion rate |
| Forge | ■ | Upgrades 10% cheaper |

A held landmark cell resists 2.5× harder, so it's worth fighting over. Rivals use the same flag
mechanic: every ~8 s each rival aims at the nearest landmark it doesn't hold within 45 cells of
its territory, so you will race them, and they come for yours. Rival flags are drawn smaller in
their colour.

**Terrain: water only, drawn as empty white space.** A first version also had rough and fertile
ground in pale beige and green. It was dropped before release because the colours worked against
the minimalist white look. What's left is water: lakes and winding rivers, generated from the
world seed with value noise, so nothing is stored and it's identical after loading. Water is
about 13% of the map. It can't be claimed or crossed (Outposts can jump it), and it's drawn as
gaps in the grid, so it reads as negative space that territory flows around. Your start is always
dry for about 8 cells, fading in by 22. Rivers originally boxed territories in completely, so they
have fords every so often: chokepoints rather than walls.

**Drawing.** The ground is cached as 128×128-cell images (1 pixel per cell, or per 4×4 cells far
out) and drawn nearest-neighbour, then the gaps between cells are cut over it. Far out, open
ground is a faint off-white so the pure-white water still shows. Images are built a few
per frame, so a big zoom-out never stalls. A landmark keeps a readable size at any zoom.

## Pace (0.2.4)

- **World tempo:** every faction's expansion rate is multiplied by a tempo that rises smoothly
  from 1× to 2.2× over the first 12 minutes (about 1.5× at 5 minutes and 2× at 10), then holds.
  The Territory tab shows the current value.

- About one capture every 3 seconds at the start (`BASE_STATS.rate` 0.36).
- Energy is 2 per claim and 6 per conversion, so you still get 6–7 upgrade levels in the
  first minute.
- The first rival sits 16–19 cells away, so first contact usually comes at about 3.5–4.5
  minutes, sooner if it is a Rapid Expander.

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
