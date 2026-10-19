// The expansion rules: the heart of the game's emergent behaviour.
//
// Each faction gets a budget of attempts per second. For each attempt it samples a few of its own
// border cells, scores every non-owned neighbour of those cells using its priorities, picks one
// in proportion to the scores, and tries to take it. Nothing here mentions flanking, fronts or
// encirclement; those patterns come from how the priorities below interact on the board.
//
// Priorities (set by the faction's behaviour sliders, see deriveStats in config/upgrades.ts):
//   open ground vs enemy cells (Focus → aggression), many vs few own neighbours (Shape →
//   consolidation), distance from own centre (Reach → momentum), and on Posture either cells near
//   where we are being attacked and cells we lost recently (threat, recovery) or weakly-defended,
//   already-touched enemy cells (flanking).
//
// Water can't be entered, so territory flows around lakes and through river fords. A rally flag
// makes part of every attempt start from the border nearest the
// flag and favour steps toward it, so the territory leans that way without stopping elsewhere.

import { COMBAT, FLAG } from '../config/balance';
import type { Stats } from '../config/upgrades';
import type { Faction } from './faction';
import { cellKey, DX, DY, NEUTRAL, keyX, keyY, type Grid } from './grid';
import type { Rng } from './rng';
import { WATER, type Terrain } from './terrain';

export interface Candidate {
  x: number;
  y: number;
  owner: number;
  weight: number;
  /** The attacker's own border cell this target was reached from. */
  sx: number;
  sy: number;
}

/** What the scorer needs to know about the attacking faction this attempt. */
export interface Context {
  grid: Grid;
  f: Faction;
  now: number;
  cx: number;
  cy: number;
  /** Typical radius of the faction's territory, for momentum. */
  r: number;
  terrain: Terrain;
}

/** Preference weight for target (x, y), reached from own border cell (sx, sy). */
export function score(c: Context, x: number, y: number, sx: number, sy: number): number {
  const { grid, f, now } = c;
  const s = f.stats;
  const owner = grid.owner(x, y);
  let w = 1;
  if (owner !== NEUTRAL) {
    w = COMBAT.enemyBaseWeight * Math.exp(s.aggression);
    if (s.flanking > 0) {
      // Weak points: few defenders beside the cell, and sides we already touch.
      const exposure = 1 - grid.sides(x, y, owner) / 4;
      const touch = grid.sides(x, y, f.id) / 4;
      w *= Math.exp(s.flanking * (exposure + touch - 0.5));
    }
  }
  // Shape: positive bias fills gaps (compact), negative reaches into open space (branches).
  if (s.consolidation !== 0) w *= Math.exp(s.consolidation * (grid.around(x, y, f.id) - 2.5) / 2);
  // Reach: positive pushes the outermost edges (spearheads), negative fills in nearer the centre.
  if (s.momentum !== 0 && c.r > 1) {
    const d = Math.hypot(x - c.cx, y - c.cy) / c.r;
    w *= Math.exp(s.momentum * Math.min(2, d - 1));
  }
  if (s.threat > 0 && now - grid.hitAt(sx, sy) < COMBAT.threatSeconds) w *= 1 + s.threat;
  if (s.recovery > 0 && grid.recentPrev(x, y, now - COMBAT.recoverySeconds) === f.id) w *= 1 + s.recovery;
  // Rally flag: favour steps that bring the border closer to it.
  if (f.flag) w *= Math.exp(FLAG.pull * (Math.hypot(sx - f.flag.x, sy - f.flag.y) - Math.hypot(x - f.flag.x, y - f.flag.y)));
  return w;
}

/** Choose a target for one attempt, or null if the faction has nowhere to go. */
export function chooseTarget(c: Context, rng: Rng, out?: Candidate[]): Candidate | null {
  const { grid, f } = c;
  if (f.frontier.size === 0) return null;
  const list: Candidate[] = out ?? [];
  list.length = 0;
  let total = 0;
  const samples = Math.max(1, Math.round(f.stats.samples));
  const toFlag = f.flag ? Math.round(samples * FLAG.share) : 0;
  for (let k = 0; k < samples; k++) {
    const key = k < toFlag ? nearFlag(f, rng) : f.frontier.pick(rng.next());
    const sx = keyX(key);
    const sy = keyY(key);
    for (let d = 0; d < 4; d++) {
      const x = sx + DX[d];
      const y = sy + DY[d];
      const owner = grid.owner(x, y);
      if (owner === f.id || c.terrain.at(x, y) === WATER) continue;
      const weight = score(c, x, y, sx, sy);
      list.push({ x, y, owner, weight, sx, sy });
      total += weight;
    }
  }
  if (list.length === 0) return null;
  let r = rng.next() * total;
  for (const cand of list) {
    r -= cand.weight;
    if (r <= 0) return cand;
  }
  return list[list.length - 1];
}

/** The border cell nearest the flag out of a few random picks (cheap, and never the same one). */
function nearFlag(f: Faction, rng: Rng): number {
  const fl = f.flag!;
  let best = f.frontier.pick(rng.next());
  let bestD = (keyX(best) - fl.x) ** 2 + (keyY(best) - fl.y) ** 2;
  for (let i = 1; i < FLAG.tournament; i++) {
    const k = f.frontier.pick(rng.next());
    const d = (keyX(k) - fl.x) ** 2 + (keyY(k) - fl.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Size of the same-owner group containing (x, y), counting up to `limit` cells (flood fill stops
 * there). Used by Siege to spot pockets cut off from the rest of their faction.
 */
export function groupSize(grid: Grid, x: number, y: number, owner: number, limit: number): number {
  const seen = new Set<number>([cellKey(x, y)]);
  const stack = [x, y];
  while (stack.length && seen.size <= limit) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      const k = cellKey(nx, ny);
      if (seen.has(k) || grid.owner(nx, ny) !== owner) continue;
      seen.add(k);
      stack.push(nx, ny);
    }
  }
  return seen.size;
}

/**
 * Chance that faction `att` converts the cell at (x, y) held by `def`.
 * Power and resistance are each boosted by how many sides the two sides hold around the cell,
 * and the defender's resistance grows the longer it has held the cell.
 */
export function conversionChance(grid: Grid, a: Stats, attId: number, d: Stats, defId: number, x: number, y: number, now: number, resistMult = 1): number {
  const attack = a.power * (1 + a.pressure * grid.sides(x, y, attId));
  const held = Math.min(1, Math.max(0, now - grid.since(x, y)) / Math.max(1, d.entrenchSeconds));
  const defend = d.resistance * resistMult * (1 + d.reinforcement * grid.sides(x, y, defId)) * (1 + d.entrench * held);
  return COMBAT.conversionScale * (attack / (attack + defend));
}
