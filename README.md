# Assimilate

One black square on a white grid. It grows by itself, one cell at a time, following a few
local rules. Over time it becomes a sprawling organism that, later in development, will compete
with coloured rival colonies, mutate and evolve across generations.

**Current build: 0.1.0, Phase 1 (Living Grid).** The colony grows on procedurally generated
soil and around rock, with smooth birth animations, soft sounds, automatic zoom-outs, saving,
statistics and settings. Biomass, upgrades, rivals and the rest of the design arrive in
later phases. Locked tabs in the game say which phase brings them.

## Play it on your phone

It's a web app, so any modern phone browser runs it. You don't need an app store or a
developer account.

- **Your own copy:** `npm run build:single` writes `dist/assimilate.html`, a single
  self-contained file you can host anywhere (GitHub Pages, Netlify Drop, any static host).
- **Home screen:** in Safari, tap Share → *Add to Home Screen* for a full-screen,
  portrait, app-like experience. Progress is stored on the device, in that browser.

Sound starts after your first tap, because browsers require a gesture before playing audio.

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install        # once
npm run dev        # start a dev server; it prints a local and a network URL
```

Open the printed URL. To try it on your phone while developing, connect the phone to the same
Wi‑Fi and open the **Network** URL that `npm run dev` prints.

| Command | What it does |
| --- | --- |
| `npm run dev` | Live-reloading dev server (also reachable from your phone on the same Wi‑Fi) |
| `npm run build` | Type-check and build the production site into `dist/` |
| `npm run build:single` | Build, then also write `dist/assimilate.html` as one self-contained file |
| `npm test` | Unit tests: growth rules, determinism, emergent shape differences, saves, formatting |
| `npm run e2e` | Plays the real game in a headless phone browser and taps every screen (run `npm run build` first) |
| `npm run patterns` | Grows colonies headlessly and prints ASCII maps + shape metrics for several rule presets |

Add `?debug` to the URL to expose `window.__assimilate` for poking at the game from the
browser console.

## Tuning the game

Every gameplay number lives in `src/config/balance.ts`: world size, tick rate, terrain,
growth traits, camera milestones, animation timings, colours, audio limits and save settings.
After changing values, run `npm run patterns` to see how the colony's shape responds, then
`npm test`.

In the game, **Settings → Developer → Rule Lab** lets you change the growth rules live and
watch the colony respond. It's a development tool and will be replaced by upgrades.

## Project layout

```
src/
  config/      all tunable numbers (balance.ts)
  sim/         pure simulation, no rendering. Shared by the game, tests and scripts
    world.ts     flat typed-array grid + active (frontier) cell list
    terrain.ts   seeded soil fertility and rock
    growth.ts    the local reproduction rule (the heart of emergence)
    colony.ts    colony identity, traits and cached totals
    sim.ts       tick loop, births, restore-from-save, cache audit
    metrics.ts   shape measurements (edge ratio, tips, fill)
    rng.ts       seeded random numbers
  render/      canvas drawing (camera, batched blocks, birth animation)
  audio/       synthesized sounds (no audio files)
  persist/     versioned saves with backup and recovery
  ui/          HUD, controls, tabs/panels, dialogs, diagnostics overlay
  game.ts      live controller: fixed tick clock, speed, zoom milestones, events
  main.ts      boot, loop, autosave, pause when hidden
tests/         unit tests (Vitest)
e2e/           browser test script (Playwright)
scripts/       pattern preview, single-file build, icon renderer
docs/          design decisions and phase report
```

See `docs/DESIGN_DECISIONS.md` for the engine choice, architecture, the open questions and
the defaults used. `docs/PHASE_REPORT.md` covers what was built, how it was tested and what
comes next.
