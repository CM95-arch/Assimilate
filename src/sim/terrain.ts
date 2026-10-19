// Procedural terrain: soil fertility and rock obstacles from smooth value noise.
// Fertility is the "resource-rich region" of §11.5; rocks are §6's environmental obstacles.

import { TERRAIN, WORLD } from '../config/balance';
import { hash2 } from './rng';
import { EMPTY, ROCK, type World } from './world';

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Bilinear value noise in [0, 1) with smoothstep interpolation. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fill fertility and rocks. The start area is kept open and moderately fertile. */
export function generateTerrain(world: World, seed: number, startX: number, startY: number) {
  const { width, height } = world;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const base = valueNoise(x, y, TERRAIN.fertilityScale, seed);
      const detail = valueNoise(x, y, TERRAIN.detailScale, seed ^ 0x5bd1e995);
      let f = base * (1 - TERRAIN.detailWeight) + detail * TERRAIN.detailWeight;
      f = 0.5 + (f - 0.5) * TERRAIN.contrast;
      world.fertility[i] = Math.min(1, Math.max(0, f));

      const dist = Math.hypot(x - startX, y - startY);
      // Rotated sample coordinates hide the noise lattice, so rocks don't line up in rows.
      const rx = x * 0.866 - y * 0.5;
      const ry = x * 0.5 + y * 0.866;
      const rock = valueNoise(rx, ry, TERRAIN.rockScale, seed ^ 0x27d4eb2f) * 0.7 + valueNoise(ry, rx, TERRAIN.rockDetailScale, seed ^ 0x165667b1) * 0.3;
      world.owner[i] = rock > TERRAIN.rockThreshold && dist > WORLD.startClearRadius ? ROCK : EMPTY;
    }
  }
  // A guaranteed decent first neighbourhood so every world starts well.
  const r = WORLD.startClearRadius;
  for (let y = Math.max(0, startY - r); y <= Math.min(height - 1, startY + r); y++) {
    for (let x = Math.max(0, startX - r); x <= Math.min(width - 1, startX + r); x++) {
      const i = y * width + x;
      const k = 1 - Math.hypot(x - startX, y - startY) / (r + 1);
      if (k > 0) world.fertility[i] = Math.max(world.fertility[i], 0.45 * k + world.fertility[i] * (1 - k));
    }
  }
}
