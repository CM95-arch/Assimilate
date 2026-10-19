// The expansion rules: the heart of the game's emergent behaviour.
//
// Each faction gets a budget of attempts per second. For each attempt it samples a few of its own
// border cells, scores every non-owned neighbour of those cells using its priorities, picks one
// in proportion to the scores, and tries to take it. Nothing here mentions flanking, fronts or
// encirclement; those patterns come from how the priorities below interact on the board.
//
// Priorities (all set by upgrades):
//   open ground vs enemy cells (aggression), few vs many own neighbours (branching vs
//   consolidation), distance from own centre (momentum), weakly-defended or already-touched
//   enemy cells (flanking), cells near where we are being attacked (threat response), and cells
//   we lost recently (recovery).

import { COMBAT } from '../config/balance';
import type { Stats } from '../config/upgrades';
import type { Faction } from './faction';
import { DX, DY, NEUTRAL, keyX, keyY, type Grid } from './grid';
import type { Rng } from './rng';

export interface Candidate {
  x: number;
  y: number;
  owner: number;
  weight: number;
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
  const shape = s.consolidation - s.branching;
  if (shape !== 0) w *= Math.exp(shape * (grid.around(x, y, f.id) - 2.5) / 2);
  if (s.momentum > 0 && c.r > 1) {
    const d = Math.hypot(x - c.cx, y - c.cy) / c.r;
    w *= Math.exp(s.momentum * Math.min(2, d - 1));
  }
  if (s.threat > 0 && now - grid.hitAt(sx, sy) < COMBAT.threatSeconds) w *= 1 + s.threat;
  if (s.recovery > 0 && grid.recentPrev(x, y, now - COMBAT.recoverySeconds) === f.id) w *= 1 + s.recovery;
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
  for (let k = 0; k < samples; k++) {
    const key = f.frontier.pick(rng.next());
    const sx = keyX(key);
    const sy = keyY(key);
    for (let d = 0; d < 4; d++) {
      const x = sx + DX[d];
      const y = sy + DY[d];
      const owner = grid.owner(x, y);
      if (owner === f.id) continue;
      const weight = score(c, x, y, sx, sy);
      list.push({ x, y, owner, weight });
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

/**
 * Chance that faction `att` converts the cell at (x, y) held by `def`.
 * Power and resistance are each boosted by how many sides the two sides hold around the cell,
 * and the defender's resistance grows the longer it has held the cell.
 */
export function conversionChance(grid: Grid, a: Stats, attId: number, d: Stats, defId: number, x: number, y: number, now: number): number {
  const attack = a.power * (1 + a.pressure * grid.sides(x, y, attId));
  const held = Math.min(1, Math.max(0, now - grid.since(x, y)) / Math.max(1, d.entrenchSeconds));
  const defend = d.resistance * (1 + d.reinforcement * grid.sides(x, y, defId)) * (1 + d.entrench * held);
  return COMBAT.conversionScale * (attack / (attack + defend));
}
