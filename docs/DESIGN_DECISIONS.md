# Design decisions

Choices made while implementing the *ASSIMILATE Complete Game Design & Claude Development
Specification*. Each one can be revisited. Gameplay numbers live in `src/config/balance.ts`.

## Engine and platform (§21.1)

**Chosen: a browser-first web app (TypeScript + Canvas 2D + Vite)**, the same stack as Accrete.

- No installs on the phone, no developer accounts, no app-store review. It runs the same on
  iPhone and Android, and you test by opening a link.
- The grid is drawn procedurally on one canvas. The interface is ordinary HTML/CSS layered on
  top, which keeps text crisp and accessible and buttons easy to test.
- Performance is not a concern at this scale. A 200×320 world (64,000 cells) runs a
  15,000-cell colony at about 0.03 ms per simulation tick and about 3 ms per frame to draw in
  headless Chromium. Interior cells drop out of the update loop, so cost follows the colony's
  edge, not its area.
- *Shipping to app stores later:* wrap the same code with **Capacitor**. iOS needs a Mac with
  Xcode and an Apple Developer account; Android needs Android Studio.
- *Alternatives considered:* Godot 4 has excellent 2D, but its web export is heavy and phone
  testing needs export templates. Unity is overkill for flat squares and has slower iteration.
  Neither would make the simulation more emergent.

## Architecture (§21.3)

| Concern | Where | Notes |
| --- | --- | --- |
| Simulation state | `sim/world.ts` | Flat typed arrays: owner, birth direction, fertility, birth tick, next decision tick |
| Colony decision logic | `sim/growth.ts` | One local rule; colonies differ only by trait numbers |
| Colony identity and traits | `sim/colony.ts`, `config/balance.ts` | Rivals (Phase 3) will be more colonies with different traits, not separate AI |
| Tick loop | `sim/sim.ts` | Deterministic per seed; speed only changes ticks per second |
| Rendering | `render/` | Cached soil/rock layer, batched block paths, birth animations |
| UI | `ui/` | Panels are modules, so later tabs (Upgrades, Mutations, …) slot in |
| Persistence | `persist/save.ts` | Versioned, validated, backup copy, corruption-safe |
| Combat, economy, offline, upgrades, mutations | *not yet* | Each will be its own `sim/` module and `config/` file |

## Emergence (§11, the most important requirement)

Every cell decides alone, on its own jittered timer, using only what's next to it:

1. **Where to try**: each empty neighbour gets a weight from three preferences:
   - *branching*: open ground (few friendly cells in the 3×3 around the target) versus gaps;
   - *persistence*: continuing in the direction the cell itself was born;
   - *soil seeking*: fertility of the target.
2. **Whether it works**: the chance of success depends on soil richness and on how crowded
   the target is (*crowd refusal*).

Nothing in the code mentions branches, tendrils or blobs. Raising branching and crowd
refusal makes the colony reach out in lacy fingers that thicken over time. Negative branching
makes it fill gaps into a compact mass. Strong soil seeking makes it follow fertile veins.
Rock makes it flow around obstacles and wall off pockets. Unit tests check that different
traits produce measurably different shapes: at equal population, branch-seeking colonies
have more than 2.5× the exposed edge and more than 2× the branch tips of gap-filling ones.

`npm run patterns` prints ASCII maps of each preset so you can see this without a phone.

## Decisions where the spec left room

| Question | Default used |
| --- | --- |
| Engine | Web app (see above) |
| Neighbourhood (§6.2) | Four cardinal neighbours, plus diagonals at **20% weight**. Pure 4-neighbour growth tested as an obvious diamond: axis tips outran diagonal edges (shape ratio 1.24, where 1.0 is round). The small diagonal weight rounds it out (ratio ≈ 0.95) and keeps the block look. It's a trait, so a colony type can set it to 0 |
| Resource regions (§6, §11.5) | Soil fertility is a smooth noise field, shown as slightly darker soil. Rock clusters are the environmental obstacles. Both come from the world seed |
| Simulation clock (§6.3) | 10 ticks/s; 1×/2×/4× change ticks per second, never the rules |
| Zoom (§16) | Introduced early because a growing colony otherwise leaves the screen within a minute. Seven scales triggered by population milestones, or early if the colony nears the edge. 2.6 s eased zoom with a soft whoosh |
| World size | 200×320, portrait like the phone, so the final scale shows the whole world. Larger worlds come with Phase 7 |
| When the world fills | A dismissible dialog offers a new world. With no economy or rivals yet, there's nothing else to do |
| Navigation (§20.1) | Six bottom tabs: Colony, Upgrades, Mutations, Evolution, Stats, Settings. Tabs for later phases are visibly locked and open an honest preview of what's coming, with no fake controls. Pause and speed sit above the tabs so they're never hidden in a menu |
| Saving (§21.6) | Phase 8 in the roadmap, but basic saving is built now so progress and settings persist from day one. Offline *growth* is not yet simulated: the colony resumes where it was |
| Debug tools (§21.5) | Settings → Developer: a diagnostics overlay (fps, draw time, tick rate and cost, frontier size, births/s, a live decision with its option weights) and a Rule Lab for the growth traits. Both are off by default |

## Conflicts, gaps and over-complex parts to settle before later phases

1. **"Do not hardcode encirclement" vs. "Predatory/Opportunistic Attack prioritises weak
   positions" (§11.3, §13.6, §14.10).** These are compatible if "weak" means locally
   measurable things (low health, few friendly neighbours of the defender). The plan is to
   score attack targets the same way growth targets are scored now.
2. **Mutations are "per generation" (§14) but "Cellular Memory" keeps upgrades (§17.5).**
   This needs a rule for which run upgrades persist and how many. Proposed: Cellular Memory
   keeps a percentage of *behavioural* upgrade levels only.
3. **Regional resource pools (§15.3) vs. starvation per cell (§8.5).** Proposed: each
   connected region has one biomass pool. Starvation applies to the whole region, and cells
   with the lowest health (or furthest from a core) die first. This keeps it cheap and still
   produces the "overextended branch collapses" moment.
4. **Aggregated distant regions (§16.3–16.4) are not needed yet.** The 200×320 grid runs at a
   tiny fraction of the frame budget. Aggregation should only be added if Phase 7 worlds grow
   past roughly a million cells. Until then every cell is simulated exactly, which avoids the
   "false scale" risk entirely.
5. **Offline combat (§18.2).** Recommended default: while away, rivals expand only into
   neutral ground, and border fighting resolves at a capped, predictable rate. The player can
   never lose more than a fixed share of territory offline. Extinction offline is impossible;
   the colony is held at its last core.
6. **Sound volume.** Births are capped at 9 pops per second, and each pop gets quieter as the
   birth rate rises, so a busy colony sounds like soft rain rather than a hundred clicks.

## Open questions for you (with the default I'll use if you don't mind)

1. **Platform target:** browser + home-screen app now, Capacitor app-store builds later?
   *Default: yes.*
2. **Session length:** how long should a typical generation last before evolving feels
   right? *Default: 20–40 minutes active, with idle progress on top.*
3. **First rival timing (§23):** *Default: the orange Spreader appears at about 2–3 minutes
   or around 300 cells, whichever comes first, at a distant edge.*
4. **Diagonal growth:** keep the subtle 20% diagonal growth (rounder, more organic), or go
   strictly 4-neighbour (more geometric, but visibly diamond-shaped)? *Default: keep it.*
5. **Monetisation:** none is planned in the spec. *Default: none; no ads, no purchases.*
