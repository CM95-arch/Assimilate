# Design decisions

The choices behind the current game (build 0.4.0) and why they were made. Numbers live in
`src/config/`. Earlier designs (the biology prototype, then an endless world) are in git history.

## Why matches (0.4.0)

Playtesting the endless version found four structural problems:

1. **Grabbing open land always won.** The world was infinite, open land was free, and claiming it
   paid energy, so the best play was to avoid fighting, out-grow everyone, then steamroll them.
2. **No goal or ending.** Numbers going up was the only reward.
3. **Upgrades ran out.** Once everything was maxed there were no decisions left.
4. **Rivals never threatened you.** They appeared late and small.

Effects (veins and pulses), landmarks and terrain were tried as fixes and removed: none changed
the structure. The game is now played in matches.

## A match

- **Arena:** a square of open ground (49×49 in League 1). Nothing outside it can be taken.
- **Start:** you and every rival start at the same moment with the same 10 energy, spread
  evenly around a ring a third of the way from the centre. Each rival gets a random personality
  plus its own twist on that personality's sliders and upgrade tastes.
- **Win:** whoever first holds **60% of the arena** wins. If a rival gets there first, or you are
  wiped out, you lose.
- **Length:** in simulation, open land runs out at about 7 minutes and a match ends at 14–21
  minutes (`npm run sim`, `MATCHES=12`). A test checks that matches can't stall forever.

## What keeps a match interesting

**Energy comes from holding ground.** Every second a faction earns 0.6 + 0.015 per cell held.
Claiming an open cell pays only 0.5 and converting an enemy cell pays 3. Once the land is gone,
growing means fighting.

**Strength in numbers.** In a border fight the attacker's power is multiplied by
(attacker's cells ÷ defender's cells)^0.35, clamped to ×0.5…×2. Without this, two equal empires
traded cells at random for ever: in tests, half of all matches had no winner after 40 minutes.
With it, a lead turns into breakthroughs and every match ends.

**Rivals gang up on the leader.** Once one faction holds 1.15× the runner-up's cells, rivals
start preferring its cells, up to 2.2× at a 2× lead, and go easier on each other (down to 0.65×).
This applies whether the leader is you or a rival. You never gang up automatically. The HUD says
"Leading · rivals target you" when it's you. It slows runaways without making them impossible: in
simulation, leaders who got far enough ahead still broke through.

**Upgrades are a budget, not a checklist.** Eight upgrades, reset every match, with steep prices
(×1.9 per level, ×2.1 for the specials). Maxing everything costs more than three times what a
match earns (a test checks this). So you choose: an economic build, a defensive one, all-in on
attack. Rivals choose by their own tastes.

| Upgrade | Per level | Max | Unlocks after earning |
| --- | --- | --- | --- |
| Expansion Rate | +20% attempts | 15 | 0 |
| Conversion Power | +20% power | 15 | 0 |
| Resistance | +20% resistance | 15 | 0 |
| Income | +15% all energy | 15 | 0 |
| Reinforcement | +0.08 resistance per friendly side | 8 | 40 |
| Chain Reaction | +8% chance a conversion flips the next cell | 6 | 120 |
| Siege | −12% resistance for cut-off enemy pockets | 6 | 120 |
| Counterattack | +10% chance to strike back after a failed attack | 6 | 120 |

Removed in 0.4.0: Outposts, Coordination, Pressure, Entrenchment, Capital, Conquest Bonus,
Tribute and Upgrade Cost Reduction. They were either redundant with the list above or only made
sense in an endless world.

**Rule kept from before:** an upgrade must make a faction strictly better and never compete with
another upgrade. Anything that trades one preference for another is a free behaviour slider
instead (Focus, Shape, Reach, Posture). A unit test enforces this.

## Leagues (the long-term goal)

Winning a league opens the next. Any open league can be replayed to beat your best time. The
Prestige tab became the League tab.

| League | Rivals | Arena | Rival income |
| --- | --- | --- | --- |
| 1 | 3 | 49×49 | ×1.00 |
| 2 | 3 | 49×49 | ×1.05 |
| 3–4 | 4 | 55×55 | ×1.10–1.15 |
| 5–6 | 5 | 60×60 | ×1.20–1.25 |
| 7–8 | 6 | 65×65 | ×1.30–1.35 |
| 9–10 | 7 | 69×69 | ×1.40–1.45 |

The arena grows to keep about 600 cells per faction. In simulation, a player who simply buys the
cheapest upgrade and never touches the flag or sliders wins most of League 1, about half of
Leagues 2–4, and nothing from League 5 up. Those leagues need real play.

## Steering

- **Behaviour sliders** (Territory tab, free to change any time): Focus (claim land ↔ attack),
  Shape (compact ↔ branching), Reach (even ↔ spearheads), Posture (defend ↔ exploit).
- **Rally flag:** tap open ground or enemy territory to plant it; tap the flag (or your own
  ground) to take it down. Half of each expansion attempt's border samples are the nearest of 6
  random border cells to the flag, and steps toward it are preferred, so the territory leans that
  way (about 2.7× the growth toward it in tests) while still growing elsewhere. It comes down by
  itself when reached. Use it to race for open land, or to aim an attack at a rival.

## The underlying rules

**Expansion budget.** Each faction earns `rate × tempo × (1 + 0.06 × √cells)` attempts per
second. Tempo rises smoothly from 1× to 2.2× over the first 12 minutes of a match.

**Choosing a target.** Each attempt samples 4 border cells and scores every neighbouring cell
the faction doesn't own. The score combines open ground vs enemy (Focus), own neighbours
(Shape), distance from own centre (Reach), weak or recently attacked spots (Posture), the
leader rule above and the rally flag. One target is picked in proportion to the scores.

**Conversion.** `chance = 0.75 × attack / (attack + defence)`, where
`attack = power × (1 + 0.25 × attacker's sides touching the cell)` and
`defence = resistance × (1 + reinforcement × defender's sides touching it) × size edge × siege`.
Open cells are claimed 92% of the time.

## Camera

The camera follows your territory and widens in steps (17 → 25 → 37 → 55 → 80 cells across),
stopping at the first step that shows the whole arena. At that step it centres on the arena.
Drag to pan, pinch or scroll to zoom, ◎ to return.

## Saves

Save format 4 stores the match (seed, league, tick, territory, factions, upgrades, flag, winner)
plus league progress. Saves from the endless versions can't carry over. The world is set aside
with a notice, but your settings and lifetime statistics are kept.

## Open questions

1. **Offline progress:** probably unnecessary for matches. Pausing when the app is hidden may be
   enough.
2. **Rewards beyond leagues:** for example, starting choices (corner start, a head-start upgrade)
   unlocked by wins.
3. **Match length:** 14–21 minutes now. If that's too long on a phone, raise the tempo or lower
   the win share in early leagues.
