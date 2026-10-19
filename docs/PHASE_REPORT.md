# Phase report — build 0.2.0 (territory redesign, first playable)

## 1. What was built

- Infinite chunked grid. Every faction starts as a random connected cluster of 5–9 cells.
- Budget-based expansion at about one capture per second at the start, with a square-root
  territory bonus.
- Border combat using power, resistance, side support and entrenchment. Eliminated rivals are
  removed, and if you are wiped out the run ends with a summary and a new run.
- Energy from claims and conversions, with an HUD readout of the total and the per-second rate.
- 17 upgrades in five categories. Prices escalate, there is ×1/×10/Max buying, unlocks are tied
  to energy earned, and each card shows its current → next effect.
- Rivals with five personalities plus a random personal twist each. They get progress matching
  yours when they appear and buy upgrades as they earn. New ones appear as your reach grows, and
  distant ones go dormant.
- Camera: follows you, widens at milestones, supports drag, pinch and scroll zoom, and has a
  re-centre button.
- Capture pop animations that keep the old colour underneath, a small flinch on failed attacks,
  and rate-limited sounds.
- Notices for first contact, new rivals, eliminations and scale changes. The status reads
  Expanding, At war, Losing ground, Paused or Defeated.
- Panels: Territory (your numbers and build, every rival's profile, build and distance),
  Upgrades, Prestige (a preview with no controls), Stats (this run and lifetime), Settings.
- Version-2 saves. Old biology saves are set aside with a notice.

## 2. How to test it

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Open fresh | A small black cluster and a tip. The Upgrades tab has a green dot (you can afford something) |
| 2 | Watch 10 s | About one square captured per second, each with a pop |
| 3 | Upgrades → Expansion Rate → Buy | Energy drops, the level rises, and expansion visibly speeds up |
| 4 | Tap a greyed-out upgrade | It shakes and tells you how much more energy you need |
| 5 | Wait ~1–1.5 min | A "Contact" notice, status *At war*, and borders flickering where cells are fought over |
| 6 | Territory tab | You and each rival, with personality, top upgrades and size |
| 7 | Buy Branching (or Consolidation) a few times | New growth becomes finger-like (or compact) |
| 8 | Drag the map; scroll or pinch | It pans and zooms. ◎ returns to following |
| 9 | Keep playing | The view widens with "Scale N" banners, and new rivals are announced as you reach further |
| 10 | Close and reopen | Same territory, upgrades and rivals |
| 11 | Settings → New run… | Confirm starts a fresh world; Cancel keeps yours |

Automated:

- `npm test`: 36 tests. They cover the grid, starting clusters, pace, the size bonus, combat
  odds, elimination and defeat, Branching vs Consolidation shapes, Momentum, Aggression,
  Flanking, the first-minute economy, pricing, rival budgets and distinct builds, spawning,
  dormancy, determinism, and saves (including old, corrupt and tampered ones).
- `npm run e2e`: 29 browser scenarios on 390×844 and 320×568 phones. They cover every tab and
  dialog, purchases (including refusals, ×10 and Max), locked upgrades unlocking live, pan, zoom
  and re-centre, contact, scale milestones, persistence, new run, defeat, reset, error recovery,
  old and corrupt saves, and a performance check. In that check a ~25,000-cell battle across 6
  factions runs at about 0.15 ms per tick and draws in about 7–8 ms.

## 3. Defects found and fixed while building

- Opening a panel shrank the battlefield and zoomed it out. Zoom now uses a fixed reference size,
  so the view only gets shorter.
- Rival distance was measured between territory centres ("17 cells away" while touching). It now
  measures the gap between edges.
- Events from the tick that ended a run weren't processed if the game stopped right after,
  which would hide the defeat summary. They're now processed even while stopped.
- Notices covered the pause/speed controls. They now sit above the controls, or above an open
  panel.

## 4. Next steps (proposed order)

1. **Upgrade catalogue and AI depth:** add the remaining upgrades from the design (Breakthrough,
   Overrun, Counterpressure, Isolation, Adaptability, Passive Income and others) and an
   "Adaptive" rival that reacts to who is attacking it.
2. **Prestige:** an "End run" option, a points formula and permanent upgrades.
3. **Offline progress** with a "While you were away" summary.
4. **Performance for very large worlds:** cached chunk drawing and coarse simulation of distant
   regions.
5. **Polish pass:** sound, small animations and a full interface audit on a real phone.
