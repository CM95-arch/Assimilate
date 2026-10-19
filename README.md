# Assimilate

An idle territory-conquest game for phones. You are the black territory on an endless white grid.
Your territory expands on its own, and so do coloured rival factions. You don't move anything by
hand. Behaviour sliders decide what your territory goes after, and energy buys upgrades that make
it stronger. Every rival plays by the same rules with its own settings and build, so each border
becomes a different fight.

**Current build: 0.3.1.** Infinite blank grid, a rally flag you plant with a tap to steer your
growth, expansion that starts at about one cell every 3
seconds and speeds up gently over 12 minutes, energy, four behaviour sliders, 16 upgrades in
four categories (including Outposts, Chain Reaction, Siege, Counterattack, Tribute and
Capital), rivals
with five personalities that appear as you expand, border combat, a camera you can drag and zoom,
saving, statistics and settings. Prestige, offline progress and the rest of the upgrade list come
next (see `docs/PHASE_REPORT.md`).

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

- `balance.ts`: base faction stats, combat, energy, rival spawning, camera, animation and colours.
- `upgrades.ts`: every upgrade's cost, unlock point and what it changes, plus how the
  behaviour sliders map onto priorities.
- `profiles.ts`: rival personalities (slider positions and how much each type values each
  upgrade).

After changing numbers, run `npm run sim` (try `SEED=3 MINUTES=10`, or `BUILD=power,resistance`)
and then `npm test`.

## Project layout

```
src/
  config/      tunable numbers: balance, upgrades, rival profiles
  sim/         pure simulation shared by the game, tests and scripts (no rendering)
    grid.ts       infinite chunked grid + key sets
    faction.ts    a faction: levels → stats, energy, territory caches
    expansion.ts  the rules: target scoring and conversion chance (where emergence comes from)
    world.ts      tick loop, captures, elimination, rival spawning, rival shopping, dormancy
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
