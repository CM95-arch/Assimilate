// Headless match check: plays matches with a simple player policy and prints how they went.
// Use it after changing numbers in src/config.
//   npm run sim                         one match, league 1, seed 1, with a map at the end
//   SEED=3 LEAGUE=4 npm run sim
//   MATCHES=20 npm run sim              many seeds: win rate and match lengths (no map)
//   POLICY=none npm run sim             player never buys anything
//   POLICY=rival npm run sim            player shops like a Balanced rival
//   BUILD=rate,yield npm run sim        player favours these upgrades (comma list)

import { TIME } from '../src/config/balance';
import { PROFILE_BY_ID } from '../src/config/profiles';
import { UPGRADES } from '../src/config/upgrades';
import { buy, isUnlocked, upgradeCost } from '../src/sim/economy';
import { centroid } from '../src/sim/faction';
import { NEUTRAL } from '../src/sim/grid';
import { PLAYER, World } from '../src/sim/world';

const SEED = Number(process.env.SEED ?? 1);
const LEAGUE = Number(process.env.LEAGUE ?? 1);
const MATCHES = Number(process.env.MATCHES ?? 1);
const POLICY = process.env.POLICY ?? 'cheapest';
const BUILD = (process.env.BUILD ?? '').split(',').filter(Boolean);
const LIMIT_MIN = Number(process.env.LIMIT ?? 40);
const fmt = (s: number) => (s < 120 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(1)}m`);

function shop(w: World) {
  const p = w.player;
  if (POLICY === 'none') return;
  if (POLICY === 'rival') {
    p.profile = 'balanced';
    w.rivalShop(p);
    return;
  }
  for (let i = 0; i < 5; i++) {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const d of UPGRADES) {
      if (!isUnlocked(d, p) || (p.levels[d.id] ?? 0) >= d.maxLevel) continue;
      const c = upgradeCost(d, p.levels[d.id] ?? 0) / (BUILD.includes(d.id) ? 4 : 1);
      if (c < bestCost) {
        bestCost = c;
        best = d.id;
      }
    }
    if (!best || !buy(p, best).ok) break;
  }
}

function play(seed: number, verbose: boolean) {
  const w = World.create(seed, LEAGUE);
  const p = w.player;
  const area = w.size * w.size;
  let firstContact: number | null = null;
  let landGone: number | null = null;
  const share = (n: number) => `${Math.round((n / area) * 100)}%`;
  for (let t = 0; t < LIMIT_MIN * 60 * TIME.ticksPerSecond && !w.ended; t++) {
    w.step();
    w.events.length = 0;
    shop(w);
    if (firstContact === null && w.contacts().length) firstContact = w.time;
    if (landGone === null) {
      let held = 0;
      for (const f of w.factions.values()) held += f.cells;
      if (held > area * 0.9) landGone = w.time;
    }
    if (verbose && w.tick % (TIME.ticksPerSecond * 60) === 0) {
      const all = [...w.factions.values()].sort((a, b) => b.cells - a.cells);
      console.log(
        `${fmt(w.time).padStart(5)} | ${all.map((f) => `${f.isPlayer ? 'YOU' : f.name}${f.alive ? '' : '✗'} ${share(f.cells)}${w.leader === f.id ? '*' : ''}`).join('  ')}` +
          ` | you +${w.energyRate().toFixed(1)}/s, ${Object.values(p.levels).reduce((a, b) => a + b, 0)} levels`,
      );
    }
  }
  const winner = w.factions.get(w.winner);
  return { w, time: w.time, won: w.winner === PLAYER, winner: winner ? (winner.isPlayer ? 'YOU' : `${winner.name} (${PROFILE_BY_ID[winner.profile].name})`) : w.ended ? 'wiped out' : 'unfinished', firstContact, landGone };
}

if (MATCHES === 1) {
  const r = play(SEED, true);
  const w = r.w;
  console.log(`\nLeague ${LEAGUE}, ${w.size}×${w.size}: ${r.winner} after ${fmt(r.time)} | first contact ${r.firstContact === null ? 'none' : fmt(r.firstContact)} | land 90% taken ${r.landGone === null ? 'never' : fmt(r.landGone)}`);
  for (const f of w.factions.values()) {
    const top = Object.entries(f.levels).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`${(f.isPlayer ? 'You' : f.name).padEnd(7)} ${(f.isPlayer ? '' : PROFILE_BY_ID[f.profile].name).padEnd(15)} ${f.alive ? 'alive' : 'gone '} ${String(f.cells).padStart(5)} cells | ${top}`);
  }
  // Map of the arena: █ you, letters for rivals.
  const glyph = (o: number) => (o === NEUTRAL ? '·' : o === PLAYER ? '█' : String.fromCharCode(95 + o));
  for (let y = 0; y < w.size; y += 2) {
    let line = '';
    for (let x = 0; x < w.size; x++) line += glyph(w.grid.owner(x, y));
    console.log(line);
  }
  void centroid;
} else {
  let wins = 0;
  const times: number[] = [];
  const winners: Record<string, number> = {};
  for (let s = 1; s <= MATCHES; s++) {
    const r = play(s, false);
    if (r.won) wins++;
    times.push(r.time);
    const k = r.won ? 'YOU' : r.winner.split(' ')[0] === 'wiped' ? 'wiped out' : r.winner.replace(/^\w+ /, '');
    winners[k] = (winners[k] ?? 0) + 1;
    console.log(`seed ${String(s).padStart(2)}: ${r.winner.padEnd(28)} ${fmt(r.time).padStart(6)}  contact ${r.firstContact === null ? '-' : fmt(r.firstContact)}  land gone ${r.landGone === null ? '-' : fmt(r.landGone)}`);
  }
  times.sort((a, b) => a - b);
  console.log(`\nLeague ${LEAGUE} · policy ${POLICY}: you won ${wins}/${MATCHES} · median match ${fmt(times[times.length >> 1])} (${fmt(times[0])}–${fmt(times[times.length - 1])})`);
  console.log(Object.entries(winners).map(([k, v]) => `${k} ${v}`).join(' · '));
}
