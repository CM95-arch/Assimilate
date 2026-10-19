// Reproduction: the one local rule Phase 1 is built on (§7).
//
// A cell looks only at its four neighbours (plus, weakly, the diagonals if its traits allow) and
// the 3×3 area around each. It scores every empty neighbour by three preferences — open space
// (branching), its own heading (persistence) and soil richness — picks one at random in
// proportion to those scores, then succeeds with a chance set by the soil and how crowded the
// spot is. Nothing here knows about branches, tendrils or blobs; those shapes emerge from how
// the preferences interact with each other and the terrain.

import type { GrowthTraits } from '../config/balance';
import type { Rng } from './rng';
import { EMPTY, NO_DIR, type World } from './world';

/** Explains one decision; filled only when diagnostics ask for it. */
export interface DecisionTrace {
  cell: number;
  options: { target: number; dir: number; weight: number; accept: number }[];
  chosen: number;
  success: boolean;
}

export interface GrowthResult {
  /** Index of the new cell, or -1. */
  born: number;
  dir: number;
}

const NONE: GrowthResult = { born: -1, dir: NO_DIR };

/** Crowding around a target, normalised to 0..1 (the parent itself always counts as one). */
function crowdNorm(world: World, target: number, colony: number): number {
  return Math.max(0, world.crowding(target, colony) - 1) / 7;
}

export function choiceWeight(t: GrowthTraits, crowd: number, fertility: number, straight: boolean): number {
  return Math.exp(-2 * t.branching * crowd + 2 * t.fertilityPreference * (fertility - 0.5) + (straight ? t.persistence : 0));
}

export function acceptChance(t: GrowthTraits, crowd: number, fertility: number): number {
  return t.vigor * (t.barrenFloor + (1 - t.barrenFloor) * fertility) * Math.exp(-2 * t.crowdRefusal * crowd);
}

/**
 * One reproduction attempt by cell `i`. Returns the newborn (not yet written to the world) or
 * NONE. Returns `null` when the cell has no empty neighbour left and should go dormant.
 */
export function attemptGrowth(world: World, i: number, traits: GrowthTraits, rng: Rng, trace?: DecisionTrace): GrowthResult | null {
  const colony = world.owner[i];
  const heading = world.dir[i];
  let count = 0;
  let total = 0;
  const targets = scratchTargets;
  const dirs = scratchDirs;
  const weights = scratchWeights;
  const crowds = scratchCrowds;
  const dirsToTry = traits.diagonalGrowth > 0 ? 8 : 4;
  for (let d = 0; d < dirsToTry; d++) {
    const n = world.neighbor(i, d);
    if (n === -1 || world.owner[n] !== EMPTY) continue;
    const crowd = crowdNorm(world, n, colony);
    let w = choiceWeight(traits, crowd, world.fertility[n], d === heading);
    if (d >= 4) w *= traits.diagonalGrowth;
    targets[count] = n;
    dirs[count] = d;
    weights[count] = w;
    crowds[count] = crowd;
    total += w;
    count++;
  }
  if (count === 0) return null;

  let pick = 0;
  let r = rng.next() * total;
  for (; pick < count - 1; pick++) {
    r -= weights[pick];
    if (r <= 0) break;
  }
  const target = targets[pick];
  const p = acceptChance(traits, crowds[pick], world.fertility[target]);
  const success = rng.next() < p;
  if (trace) {
    trace.cell = i;
    trace.options = [];
    for (let k = 0; k < count; k++) {
      trace.options.push({ target: targets[k], dir: dirs[k], weight: weights[k] / total, accept: acceptChance(traits, crowds[k], world.fertility[targets[k]]) });
    }
    trace.chosen = pick;
    trace.success = success;
  }
  return success ? { born: target, dir: dirs[pick] } : NONE;
}

const scratchTargets = new Int32Array(8);
const scratchDirs = new Uint8Array(8);
const scratchWeights = new Float64Array(8);
const scratchCrowds = new Float64Array(8);
