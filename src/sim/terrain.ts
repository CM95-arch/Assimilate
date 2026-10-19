// Terrain (open ground or water) and landmarks, generated from the world seed. Water is drawn as
// empty white space: holes in the grid that territory has to flow around. Nothing is stored: any cell's ground can
// be worked out at any time, so the infinite world stays free where nobody has been.

import { GRID, LANDMARKS, TERRAIN } from '../config/balance';
import { cellKey } from './grid';
import { hash2 } from './rng';

export const PLAIN = 0;
export const WATER = 1;

export interface LandmarkType {
  id: string;
  name: string;
  /** Short description of the bonus, e.g. for toasts and the Territory tab. */
  bonus: string;
}

/** Each held landmark adds its bonus once (holding two Springs doubles it). */
export const LANDMARK_TYPES: LandmarkType[] = [
  { id: 'spring', name: 'Spring', bonus: '+25% energy' },
  { id: 'tower', name: 'Watchtower', bonus: '+15% resistance' },
  { id: 'camp', name: 'War Camp', bonus: '+15% conversion power' },
  { id: 'crossroads', name: 'Crossroads', bonus: '+15% expansion rate' },
  { id: 'forge', name: 'Forge', bonus: 'Upgrades 10% cheaper' },
];

export interface Landmark {
  x: number;
  y: number;
  type: number;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Two octaves of value noise, roughly 0..1 around 0.5. */
function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, seed) * 0.65 + valueNoise(x * 2.03 + 5.1, y * 2.03 + 1.7, seed + 17) * 0.35;
}

export class Terrain {
  /** Off in rule tests, so they measure the base rules on plain ground. */
  enabled = true;
  private cells = new Map<number, Uint8Array>();
  private regions = new Map<number, Landmark | null>();

  constructor(readonly seed: number) {}

  /** Ground type at a cell, computed from noise (no cache; see `at`). */
  sample(x: number, y: number): number {
    if (!this.enabled) return PLAIN;
    const s = this.seed;
    const T = TERRAIN;
    // 0 at your start, 1 once clear of the safe area.
    const safe = Math.min(1, Math.max(0, (Math.hypot(x, y) - T.safeRadius) / T.safeFade));
    if (fbm(x / 34, y / 34, s + 1) > T.lake + (1 - safe) * 0.5) return WATER;
    // Rivers wind through some regions, with shallow fords every so often where they can be crossed.
    if (safe > 0 && fbm(x / 160, y / 160, s + 3) > 0.5 && Math.abs(fbm(x / 60, y / 60, s + 2) - 0.5) < T.river * safe && fbm(x / 7, y / 7, s + 6) < T.ford) return WATER;
    return PLAIN;
  }

  /** Ground type at a cell, cached per 32×32 chunk (the simulation asks about the same cells often). */
  at(x: number, y: number): number {
    if (!this.enabled) return PLAIN;
    const CS = GRID.chunk;
    const cx = Math.floor(x / CS);
    const cy = Math.floor(y / CS);
    const k = cellKey(cx, cy);
    let c = this.cells.get(k);
    if (!c) {
      // Bounded: an enormous explored world simply recomputes chunks it hasn't touched lately.
      if (this.cells.size > 6000) this.cells.clear();
      c = new Uint8Array(CS * CS);
      for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) c[j * CS + i] = this.sample(cx * CS + i, cy * CS + j);
      this.cells.set(k, c);
    }
    return c[(y - cy * CS) * CS + (x - cx * CS)];
  }

  /** The landmark of region (rx, ry), if it has one. */
  regionLandmark(rx: number, ry: number): Landmark | null {
    const k = cellKey(rx, ry);
    let l = this.regions.get(k);
    if (l !== undefined) return l;
    l = null;
    const s = this.seed + 7;
    if (this.enabled && hash2(rx, ry, s) < LANDMARKS.chance) {
      const R = LANDMARKS.region;
      const x = rx * R + 6 + Math.floor(hash2(rx, ry, s + 1) * (R - 12));
      const y = ry * R + 6 + Math.floor(hash2(rx, ry, s + 2) * (R - 12));
      if (Math.hypot(x, y) >= LANDMARKS.minDistance && this.sample(x, y) !== WATER) {
        l = { x, y, type: Math.floor(hash2(rx, ry, s + 3) * LANDMARK_TYPES.length) };
      }
    }
    if (this.regions.size > 20000) this.regions.clear();
    this.regions.set(k, l);
    return l;
  }

  /** Landmark type at (x, y), or -1. */
  landmarkAt(x: number, y: number): number {
    if (!this.enabled) return -1;
    const R = LANDMARKS.region;
    const l = this.regionLandmark(Math.floor(x / R), Math.floor(y / R));
    return l && l.x === x && l.y === y ? l.type : -1;
  }

  /** Every landmark whose region overlaps the rectangle [x0, x1] × [y0, y1]. */
  landmarksIn(x0: number, y0: number, x1: number, y1: number, out: Landmark[] = []): Landmark[] {
    out.length = 0;
    const R = LANDMARKS.region;
    for (let ry = Math.floor(y0 / R); ry <= Math.floor(y1 / R); ry++) {
      for (let rx = Math.floor(x0 / R); rx <= Math.floor(x1 / R); rx++) {
        const l = this.regionLandmark(rx, ry);
        if (l && l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1) out.push(l);
      }
    }
    return out;
  }
}
