// Headless pacing check: plays a run with a simple player policy and prints milestones,
// rival builds and an ASCII map. Use it after changing numbers in src/config.
//   npm run sim                      default seed, 5 minutes
//   SEED=3 MINUTES=10 npm run sim
//   POLICY=none npm run sim          player never buys anything
//   BUILD=branching,momentum         player favours these upgrades (comma list)

import { TIME } from '../src/config/balance';
import { PROFILE_BY_ID } from '../src/config/profiles';
import { UPGRADES } from '../src/config/upgrades';
import { buy, isUnlocked, upgradeCost } from '../src/sim/economy';
import { centroid } from '../src/sim/faction';
import { NEUTRAL } from '../src/sim/grid';
import { PLAYER, World } from '../src/sim/world';

const SEED = Number(process.env.SEED ?? 1);
const MINUTES = Number(process.env.MINUTES ?? 5);
const POLICY = process.env.POLICY ?? 'cheapest';
const BUILD = (process.env.BUILD ?? '').split(',').filter(Boolean);
const VIEW = Number(process.env.VIEW ?? 80);

const w = World.create(SEED);
const p = w.player;
const fmt = (s: number) => (s < 120 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(1)}m`);
const buys: string[] = [];
let firstContact: number | null = null;
const marks = [10, 30, 60, 120, 180, 300, 420, 600, 720, 900, 1200];

for (let t = 0; t < MINUTES * 60 * TIME.ticksPerSecond && !w.ended; t++) {
  w.step();
  w.events.length = 0;
  if (POLICY !== 'none') {
    for (let i = 0; i < 5; i++) {
      let best: string | null = null;
      let bestCost = Infinity;
      for (const d of UPGRADES) {
        if (!isUnlocked(d, p) || (p.levels[d.id] ?? 0) >= d.maxLevel) continue;
        const c = upgradeCost(d, p.levels[d.id] ?? 0, p.stats.costMult) / (BUILD.includes(d.id) ? 4 : 1);
        if (c < bestCost) {
          bestCost = c;
          best = d.id;
        }
      }
      if (!best || !buy(p, best).ok) break;
      if (buys.length < 12) buys.push(`${best}@${fmt(w.time)}`);
    }
  }
  if (firstContact === null && w.contacts().length) firstContact = w.time;
  if (marks.includes(Math.round(w.time * 10) / 10)) {
    const rivals = [...w.factions.values()].filter((f) => !f.isPlayer);
    console.log(
      `${fmt(w.time).padStart(5)} | you ${String(p.cells).padStart(5)} cells, ${p.energy.toFixed(0).padStart(5)} energy (+${w.energyRate().toFixed(1)}/s), ` +
        `${Object.values(p.levels).reduce((a, b) => a + b, 0)} levels | rivals: ` +
        rivals.map((f) => `${f.name}${f.alive ? '' : '✗'} ${f.cells}`).join(', '),
    );
  }
}
console.log(`\nfirst upgrades: ${buys.join(' ')}`);
console.log(`you: converted ${p.converted}, lost ${p.lost} | first contact: ${firstContact === null ? "none" : fmt(firstContact)}${w.ended ? ' | YOU WERE DEFEATED' : ''}`);
for (const f of w.factions.values()) {
  if (f.isPlayer) continue;
  const top = Object.entries(f.levels).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`${f.name.padEnd(7)} ${PROFILE_BY_ID[f.profile].name.padEnd(15)} ${f.alive ? 'alive' : 'gone '} ${String(f.cells).padStart(5)} cells | ${top}`);
}

// Map around the player: █ you, letters for rivals.
const c = centroid(p);
const glyph = (o: number) => (o === NEUTRAL ? ' ' : o === PLAYER ? '█' : String.fromCharCode(95 + o));
const half = VIEW >> 1;
for (let y = Math.round(c.y) - half; y < Math.round(c.y) + half; y += 2) {
  let line = '';
  for (let x = Math.round(c.x) - half; x < Math.round(c.x) + half; x++) {
    const a = w.grid.owner(x, y);
    line += glyph(a !== NEUTRAL ? a : w.grid.owner(x, y + 1));
  }
  console.log(line);
}
