// Shape measurements used by tests and the patterns script to check that different traits
// really produce different colony structures (§3.4 visible consequences).

import type { Simulation } from './sim';
import { EMPTY, PLAYER } from './world';

export interface ShapeMetrics {
  /** Exposed cell edges ÷ population. ~0.1 for a solid disc this size, higher for tendrils. */
  edgeRatio: number;
  /** Cells with exactly one friendly 4-neighbour: branch tips. */
  tips: number;
  /** Population ÷ bounding-box area. */
  fill: number;
  /** Empty cells inside the bounding box with friendly cells on all four sides. */
  enclosedEmpty: number;
}

export function shapeMetrics(sim: Simulation, colonyId = PLAYER): ShapeMetrics {
  const w = sim.world;
  const c = sim.colony(colonyId);
  let edges = 0;
  let tips = 0;
  let enclosed = 0;
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      const i = w.index(x, y);
      let friendly = 0;
      for (let d = 0; d < 4; d++) {
        const n = w.neighbor(i, d);
        if (n !== -1 && w.owner[n] === colonyId) friendly++;
      }
      if (w.owner[i] === colonyId) {
        edges += 4 - friendly;
        if (friendly === 1) tips++;
      } else if (w.owner[i] === EMPTY && friendly === 4) enclosed++;
    }
  }
  const area = Math.max(1, (c.maxX - c.minX + 1) * (c.maxY - c.minY + 1));
  return { edgeRatio: edges / Math.max(1, c.population), tips, fill: c.population / area, enclosedEmpty: enclosed };
}
