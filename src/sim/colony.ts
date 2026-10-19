// A colony is an owner id, a set of traits (its "genes"), and cached totals.
// Rival colonies (Phase 3) will be more of these with different traits — not separate AI code.

import type { GrowthTraits } from '../config/balance';

export interface Colony {
  id: number;
  name: string;
  color: string;
  traits: GrowthTraits;
  population: number;
  peakPopulation: number;
  /** Cells ever created by this colony. */
  totalBorn: number;
  /** Bounding box of territory ever held (cells). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function createColony(id: number, name: string, color: string, traits: GrowthTraits): Colony {
  return {
    id, name, color, traits: { ...traits },
    population: 0, peakPopulation: 0, totalBorn: 0,
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
  };
}

export function includeInBounds(c: Colony, x: number, y: number) {
  if (x < c.minX) c.minX = x;
  if (x > c.maxX) c.maxX = x;
  if (y < c.minY) c.minY = y;
  if (y > c.maxY) c.maxY = y;
}
