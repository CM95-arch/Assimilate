// A faction: an owner id, upgrade levels (which set its stats), an energy bank and cached
// territory facts. You and every rival are the same kind of object; only the choices differ.

import { deriveStats, neutralBehavior, type Behavior, type Stats } from '../config/upgrades';
import { KeySet } from './grid';
import { LANDMARK_TYPES } from './terrain';

export interface Faction {
  id: number;
  name: string;
  color: string;
  isPlayer: boolean;
  /** Rival personality (profiles.ts); '' for the player. */
  profile: string;
  /** Per-rival multipliers on profile weights: what makes this rival unique. */
  taste: Record<string, number>;
  levels: Record<string, number>;
  /** Behaviour slider positions (free to change; set from the profile for rivals). */
  behavior: Behavior;
  stats: Stats;
  energy: number;
  /** Total energy earned this run (including a rival's starting budget). */
  earned: number;
  alive: boolean;
  spawnedAt: number;
  homeX: number;
  homeY: number;
  /** Fractional expansion attempts carried between ticks. */
  budget: number;
  // ----- territory caches (rebuilt from the grid on load) -----
  cells: number;
  frontier: KeySet;
  sumX: number;
  sumY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  // ----- statistics -----
  claimed: number;
  converted: number;
  lost: number;
  peakCells: number;
  /** Rally flag: the territory leans toward this cell (set by you, or chosen by a rival). */
  flag: { x: number; y: number } | null;
  /** Landmarks held, by type index (LANDMARK_TYPES). Kept up to date by transfer. */
  holds: number[];
  /** When a rival next reconsiders where to put its flag. */
  nextFlagThink: number;
}

export function createFaction(id: number, name: string, color: string, isPlayer: boolean, profile = '', taste: Record<string, number> = {}): Faction {
  return {
    id, name, color, isPlayer, profile, taste,
    levels: {}, behavior: neutralBehavior(), stats: deriveStats({}),
    energy: 0, earned: 0, alive: true, spawnedAt: 0, homeX: 0, homeY: 0, budget: 0,
    cells: 0, frontier: new KeySet(), sumX: 0, sumY: 0,
    minX: 0, maxX: 0, minY: 0, maxY: 0,
    claimed: 0, converted: 0, lost: 0, peakCells: 0,
    flag: null, holds: LANDMARK_TYPES.map(() => 0), nextFlagThink: 0,
  };
}

/** Recompute stats from upgrades, behaviour sliders and held landmarks. */
export function refreshStats(f: Faction) {
  const s = deriveStats(f.levels, f.behavior);
  const [spring, tower, camp, crossroads, forge] = f.holds;
  s.yield *= 1 + 0.25 * spring;
  s.conquest *= 1 + 0.25 * spring;
  s.resistance *= 1 + 0.15 * tower;
  s.power *= 1 + 0.15 * camp;
  s.rate *= 1 + 0.15 * crossroads;
  s.costMult *= 0.9 ** forge;
  f.stats = s;
}

export function centroid(f: Faction): { x: number; y: number } {
  return f.cells > 0 ? { x: f.sumX / f.cells, y: f.sumY / f.cells } : { x: f.homeX, y: f.homeY };
}

/** Typical radius of the territory if it were a disc. */
export function radius(f: Faction): number {
  return Math.sqrt(f.cells / Math.PI);
}
