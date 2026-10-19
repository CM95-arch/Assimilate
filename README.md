# Assimilate

A territory-conquest game for phones, played in matches. You are the black territory in a white
square arena with a few coloured rivals. Everyone's territory expands on its own; you don't move
anything by hand. Behaviour sliders and a rally flag decide where your territory goes, and energy
(earned by holding ground) buys upgrades. The first to hold 60% of the arena wins, but rivals gang
up on whoever is clearly ahead. Winning a league opens the next, with more and richer rivals.

**Current build: 0.4.0.** Matches in a square arena, 10 leagues, 8 upgrades that reset each match
and can't all be afforded, four behaviour sliders, a rally flag, strength in numbers, rivals with
five personalities that gang up on the leader, a standings bar, an end-of-match summary, saving,
statistics and settings. See `docs/DESIGN_DECISIONS.md` for why it works this way.

## Play it on your phone

It's a web app, so any modern phone browser runs it. You don't need an app store or a developer
account.

- **Your own copy:** `npm run build:single` writes `dist/assimilate.html`, one self-contained file
  you can host anywhere.
- **Home screen:** in Safari, tap Share → *Add to Home Screen* for a full-screen, portrait,
  app-like experience. Progress is stored on the device, in that browser.

Sound starts after your first tap, because browsers require a gesture before playing audio.

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install        # once
npm run dev        # start a dev server; it prints a local and a network URL
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Live-reloading dev server (also reachable from your phone on the same Wi‑Fi) |
| `npm run build` | Type-check and build the production site into `dist/` |
| `npm run build:single` | Build, then also write `dist/assimilate.html` as one self-contained file |
| `npm test` | Unit tests: grid, expansion pace, combat, behaviour upgrades, economy, rivals, saves |
| `npm run e2e` | Plays the real game in a headless phone browser and taps every screen (run `npm run build` first) |
| `npm run sim` | Plays a run headlessly and prints pacing, rival builds and an ASCII map |

Add `?debug` to the URL to expose `window.__assimilate` in the browser console, including
`grant(factionId, levels)` for experiments.

## Tuning the game

All gameplay numbers live in `src/config/`:

- `balance.ts`: base faction stats, combat, energy, matches and leagues, ganging up on the
  leader, camera, animation and colours.
- `upgrades.ts`: every upgrade's cost, unlock point and what it changes, plus how the
  behaviour sliders map onto priorities.
- `profiles.ts`: rival personalities (slider positions and how much each type values each
  upgrade).

After changing numbers, run `npm run sim` to play a match headlessly, or `MATCHES=12 npm run sim`
for a win rate and match lengths across many seeds (add `LEAGUE=5`, `POLICY=none` or
`BUILD=power,resistance`). Then run `npm test`.

## Project layout

```
src/
  config/      tunable numbers: balance, upgrades, rival profiles
  sim/         pure simulation shared by the game, tests and scripts (no rendering)
    grid.ts       chunked grid + key sets
    faction.ts    a faction: levels → stats, energy, territory caches
    expansion.ts  the rules: target scoring and conversion chance (where emergence comes from)
    world.ts      a match: arena, starts, tick loop, income, captures, leader, win check, rival shopping
    economy.ts    prices, unlocks, purchases (shared by you and rivals)
    rng.ts        seeded random numbers
  render/      camera (follow, milestones, pan/zoom), batched drawing, capture animations
  audio/       synthesized sounds
  persist/     versioned saves with backup and recovery
  ui/          HUD, controls, panels, dialogs, error card, diagnostics
  game.ts      live controller: tick clock, events → effects/notices, camera framing
  main.ts      boot, loop, autosave, pause when hidden
tests/ e2e/ scripts/ docs/
```
