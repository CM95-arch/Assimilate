// Veins (pulses): every so often a faction's capital sends a pulse through its territory to the
// places that need help most: tips that are spread thin, and ground that is being surrounded.
//
// The pulse travels as a wave by distance through the faction's own territory (a cheapest-path
// search over 4×4 blocks, larger for huge territories), so it flows around gaps and cannot reach
// regions that are cut off. When it reaches a weak spot it leaves a boost zone there for a few
// seconds. The renderer draws the moving wave front; the rules only care about arrival times.

import { SPECIAL } from '../config/balance';
import { pulseBoost, pulseInterval, pulseTargets } from '../config/upgrades';
import type { Faction } from './faction';
import { cellKey, DX, DY, keyX, keyY, NEUTRAL, type Grid } from './grid';
import type { Rng } from './rng';

const BASE = SPECIAL.veinBlock;

export interface PulseTarget {
  x: number;
  y: number;
  /** Sim time the wave reaches it. */
  arrive: number;
  done: boolean;
}

export interface Pulse {
  start: number;
  /** Block width in cells for this pulse's distance field. */
  size: number;
  /** Block key → distance from the capital in cells along the territory. */
  dist: Map<number, number>;
  maxDist: number;
  targets: PulseTarget[];
  /** Blocks on (or next to) the routes from the capital to the targets: the wave is brightest here. */
  corridor: Set<number>;
  /** Block keys and distances sorted by distance, so drawing only visits the band in motion. */
  order: { keys: number[]; dists: Float64Array };
}

export interface BoostZone {
  x: number;
  y: number;
  start: number;
  until: number;
}

/** Keep a faction's per-block tallies current; called by World.transfer on every change. */
export function adjustBlock(f: Faction, x: number, y: number, delta: 1 | -1) {
  const k = cellKey(Math.floor(x / BASE), Math.floor(y / BASE));
  const s = f.blockStats.get(k);
  if (!s) {
    if (delta > 0) f.blockStats.set(k, [1, x, y]);
    return;
  }
  s[0] += delta;
  s[1] += delta * x;
  s[2] += delta * y;
  if (s[0] <= 0) f.blockStats.delete(k);
}

/** Distances (cells, along the territory) from the capital's block to every reachable block. */
export interface Field {
  size: number;
  dist: Map<number, number>;
  /** Block → the block it was reached from (towards the capital). */
  parent: Map<number, number>;
  maxDist: number;
}

export function distanceField(f: Faction): Field {
  let scale = 1;
  while (f.blockStats.size / (scale * scale) > SPECIAL.veinMaxBlocks) scale *= 2;
  const size = BASE * scale;
  const counts = new Map<number, number>();
  for (const [k, [n]] of f.blockStats) {
    const key = scale === 1 ? k : cellKey(Math.floor(keyX(k) / scale), Math.floor(keyY(k) / scale));
    counts.set(key, (counts.get(key) ?? 0) + n);
  }
  const dist = new Map<number, number>();
  const parent = new Map<number, number>();
  const passable = (k: number) => (counts.get(k) ?? 0) >= SPECIAL.veinBlockMin * scale * scale;
  // Start from the capital's block, or the held block nearest the centre if the capital fell.
  let root = cellKey(Math.floor(f.homeX / size), Math.floor(f.homeY / size));
  if (!passable(root)) {
    if (f.cells === 0) return { size, dist, parent, maxDist: 0 };
    const cx = f.sumX / f.cells / size;
    const cy = f.sumY / f.cells / size;
    let best = Infinity;
    root = -1;
    for (const k of counts.keys()) {
      if (!passable(k)) continue;
      const d = (keyX(k) - cx) ** 2 + (keyY(k) - cy) ** 2;
      if (d < best) {
        best = d;
        root = k;
      }
    }
    if (root < 0) return { size, dist, parent, maxDist: 0 };
  }
  // Dijkstra over blocks (8 directions, diagonal √2) so the wave front stays round.
  const heap: [number, number][] = [[0, root]];
  dist.set(root, 0);
  let maxDist = 0;
  while (heap.length) {
    let bi = 0;
    // Small heaps: a linear scan is simpler and fast enough at ≤ veinMaxBlocks blocks.
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
    const [d, k] = heap[bi];
    heap[bi] = heap[heap.length - 1];
    heap.pop();
    if (d > (dist.get(k) ?? Infinity)) continue;
    if (d > maxDist) maxDist = d;
    if (k !== root && !passable(k)) continue; // thin blocks are reached but not passed through
    const bx = keyX(k);
    const by = keyY(k);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = cellKey(bx + dx, by + dy);
        if (!counts.has(n)) continue;
        const nd = d + size * (dx && dy ? Math.SQRT2 : 1);
        if (nd >= (dist.get(n) ?? Infinity)) continue;
        dist.set(n, nd);
        parent.set(n, k);
        heap.push([nd, n]);
      }
    }
  }
  return { size, dist, parent, maxDist };
}

/**
 * Weak spots: border cells with the most non-friendly ground around them (spread thin) and the
 * most enemy contact (being surrounded), favouring ones far from the capital. Kept apart so one
 * pulse helps several different places.
 */
export function weakSpots(grid: Grid, f: Faction, field: Pick<Field, 'size' | 'dist'>, count: number, rng: Rng): { x: number; y: number; d: number }[] {
  const border = f.frontier.values();
  if (!border.length) return [];
  const scored: { x: number; y: number; d: number; s: number }[] = [];
  const n = Math.min(border.length, SPECIAL.veinSample);
  for (let i = 0; i < n; i++) {
    const k = border.length <= SPECIAL.veinSample ? border[i] : border[Math.floor(rng.next() * border.length)];
    const x = keyX(k);
    const y = keyY(k);
    const d = field.dist.get(cellKey(Math.floor(x / field.size), Math.floor(y / field.size)));
    if (d === undefined) continue; // cut off: the pulse can't get there
    // Thin: little of our own ground in the 5×5 around. Pressed: enemy ground in it, and enemy
    // cells directly touching. Pressure counts most; distance from home breaks ties.
    let thin = 0;
    let pressed = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const o = grid.owner(x + dx, y + dy);
        if (o === f.id) continue;
        thin++;
        if (o !== NEUTRAL) pressed++;
      }
    }
    let touching = 0;
    for (let dd = 0; dd < 4; dd++) {
      const o = grid.owner(x + DX[dd], y + DY[dd]);
      if (o !== NEUTRAL && o !== f.id) touching++;
    }
    scored.push({ x, y, d, s: thin + 1.5 * pressed + 3 * touching + d * 0.05 });
  }
  scored.sort((a, b) => b.s - a.s);
  const out: { x: number; y: number; d: number }[] = [];
  for (const c of scored) {
    if (out.length >= count) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < SPECIAL.pulseSpread)) continue;
    out.push(c);
  }
  return out;
}

function sortedByDistance(dist: Map<number, number>): Pulse['order'] {
  const entries = [...dist].sort((a, b) => a[1] - b[1]);
  return { keys: entries.map((e) => e[0]), dists: Float64Array.from(entries, (e) => e[1]) };
}

/** First index in a sorted array whose value is ≥ v. */
export function lowerBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Launch a pulse now; returns null if there is nowhere to send it. */
export function launchPulse(grid: Grid, f: Faction, now: number, rng: Rng): Pulse | null {
  const level = Math.round(f.stats.veins);
  const field = distanceField(f);
  if (field.dist.size === 0) return null;
  const spots = weakSpots(grid, f, field, pulseTargets(level), rng);
  if (!spots.length) return null;
  // The routes to the targets (plus a block either side) form the bright corridors of the wave.
  const corridor = new Set<number>();
  for (const s of spots) {
    let k = cellKey(Math.floor(s.x / field.size), Math.floor(s.y / field.size));
    for (let guard = 0; guard < 100000; guard++) {
      const bx = keyX(k);
      const by = keyY(k);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) corridor.add(cellKey(bx + dx, by + dy));
      const p = field.parent.get(k);
      if (p === undefined) break;
      k = p;
    }
  }
  return {
    start: now,
    size: field.size,
    dist: field.dist,
    maxDist: Math.max(...spots.map((s) => s.d)) + field.size,
    targets: spots.map((s) => ({ x: s.x, y: s.y, arrive: now + s.d / SPECIAL.pulseSpeed, done: false })),
    corridor,
    order: sortedByDistance(field.dist),
  };
}

/**
 * Distance from the capital at cell (x, y), blended between the four nearest block centres so the
 * drawn wave is smooth and round rather than stepping block by block.
 */
export function cellDistance(p: Pulse, x: number, y: number): number | undefined {
  const fx = (x + 0.5) / p.size - 0.5;
  const fy = (y + 0.5) / p.size - 0.5;
  const bx = Math.floor(fx);
  const by = Math.floor(fy);
  const tx = fx - bx;
  const ty = fy - by;
  let sum = 0;
  let wsum = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const d = p.dist.get(cellKey(bx + i, by + j));
      if (d === undefined) continue;
      const wgt = (i ? tx : 1 - tx) * (j ? ty : 1 - ty) + 1e-6;
      sum += d * wgt;
      wsum += wgt;
    }
  }
  return wsum > 0 ? sum / wsum : undefined;
}

/** Seconds until the next pulse for a faction at its current level. */
export function nextPulseDelay(f: Faction): number {
  return pulseInterval(Math.round(f.stats.veins));
}

/** Power/resistance multiplier at (x, y) from any active boost zone of `f`. */
export function pulseMult(f: Faction, x: number, y: number, now: number): number {
  if (!f.zones.length) return 1;
  const r2 = SPECIAL.pulseRadius * SPECIAL.pulseRadius;
  for (const z of f.zones) {
    if (now < z.until && (z.x - x) ** 2 + (z.y - y) ** 2 <= r2) return 1 + pulseBoost(Math.round(f.stats.veins));
  }
  return 1;
}
