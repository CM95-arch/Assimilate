// The infinite grid, stored in fixed-size chunks that exist only where territory has been.
// Unvisited space is implicitly neutral, so the world never runs out and never fills up.

import { GRID } from '../config/balance';

export const NEUTRAL = 0;
const CS = GRID.chunk;
const OFF = 2 ** 24;
const SPAN = 2 ** 25;

/** Pack integer cell coordinates (|x|, |y| < 16M) into one number usable as a Map/Set key. */
export const cellKey = (x: number, y: number) => (x + OFF) * SPAN + (y + OFF);
export const keyX = (k: number) => Math.floor(k / SPAN) - OFF;
export const keyY = (k: number) => (k % SPAN) - OFF;

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export class Chunk {
  readonly owner = new Uint8Array(CS * CS);
  /** Sim time (s) the current owner took the cell. */
  readonly since = new Float32Array(CS * CS);
  /** Previous owner and when they lost it (for Recovery). */
  readonly prev = new Uint8Array(CS * CS);
  readonly lostAt = new Float32Array(CS * CS);
  /** Last time this cell was attacked (for Threat Response). Negative = never. */
  readonly hitAt = new Float32Array(CS * CS).fill(-1e9);
  /** Owned (non-neutral) cells in this chunk. */
  count = 0;
  /** Bumped on every ownership change, so renderers know when to refresh a cached image. */
  version = 0;
  constructor(readonly cx: number, readonly cy: number) {}
}

export class Grid {
  readonly chunks = new Map<number, Chunk>();

  private chunkAt(x: number, y: number, create: boolean): Chunk | undefined {
    const cx = Math.floor(x / CS);
    const cy = Math.floor(y / CS);
    const k = cellKey(cx, cy);
    let c = this.chunks.get(k);
    if (!c && create) {
      c = new Chunk(cx, cy);
      this.chunks.set(k, c);
    }
    return c;
  }

  private static idx(x: number, y: number) {
    return (y - Math.floor(y / CS) * CS) * CS + (x - Math.floor(x / CS) * CS);
  }

  owner(x: number, y: number): number {
    const c = this.chunkAt(x, y, false);
    return c ? c.owner[Grid.idx(x, y)] : NEUTRAL;
  }

  since(x: number, y: number): number {
    const c = this.chunkAt(x, y, false);
    return c ? c.since[Grid.idx(x, y)] : 0;
  }

  hitAt(x: number, y: number): number {
    const c = this.chunkAt(x, y, false);
    return c ? c.hitAt[Grid.idx(x, y)] : -1e9;
  }

  markHit(x: number, y: number, t: number) {
    const c = this.chunkAt(x, y, true)!;
    c.hitAt[Grid.idx(x, y)] = t;
  }

  /** Previous owner if they lost the cell at or after `after`, else NEUTRAL. */
  recentPrev(x: number, y: number, after: number): number {
    const c = this.chunkAt(x, y, false);
    if (!c) return NEUTRAL;
    const i = Grid.idx(x, y);
    return c.lostAt[i] >= after ? c.prev[i] : NEUTRAL;
  }

  /** Change ownership. Returns the previous owner. */
  set(x: number, y: number, owner: number, t: number): number {
    const c = this.chunkAt(x, y, true)!;
    const i = Grid.idx(x, y);
    const old = c.owner[i];
    if (old === owner) return old;
    if (old !== NEUTRAL) {
      c.prev[i] = old;
      c.lostAt[i] = t;
      c.count--;
    }
    if (owner !== NEUTRAL) c.count++;
    c.owner[i] = owner;
    c.version++;
    c.since[i] = t;
    return old;
  }

  /** Same-owner cells among the 4 side neighbours of (x, y). */
  sides(x: number, y: number, owner: number): number {
    let n = 0;
    for (let d = 0; d < 4; d++) if (this.owner(x + DX[d], y + DY[d]) === owner) n++;
    return n;
  }

  /** Same-owner cells among the 8 surrounding cells of (x, y). */
  around(x: number, y: number, owner: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.owner(x + dx, y + dy) === owner) n++;
    return n;
  }

  /** True if (x, y) belongs to `owner` and touches a cell that doesn't (it can expand from here). */
  isFrontier(x: number, y: number, owner: number): boolean {
    if (this.owner(x, y) !== owner) return false;
    for (let d = 0; d < 4; d++) if (this.owner(x + DX[d], y + DY[d]) !== owner) return true;
    return false;
  }

  /** Every owned cell (for saves, audits and rebuilding caches). */
  forEachOwned(fn: (x: number, y: number, owner: number, since: number) => void) {
    for (const c of this.chunks.values()) {
      if (c.count === 0) continue;
      for (let i = 0; i < CS * CS; i++) {
        const o = c.owner[i];
        if (o !== NEUTRAL) fn(c.cx * CS + (i % CS), c.cy * CS + ((i / CS) | 0), o, c.since[i]);
      }
    }
  }
}

/** A set of cell keys with O(1) add/remove and uniform random picks. */
export class KeySet {
  private keys: number[] = [];
  private pos = new Map<number, number>();

  get size() {
    return this.keys.length;
  }

  has(k: number) {
    return this.pos.has(k);
  }

  add(k: number) {
    if (this.pos.has(k)) return;
    this.pos.set(k, this.keys.length);
    this.keys.push(k);
  }

  delete(k: number) {
    const p = this.pos.get(k);
    if (p === undefined) return;
    const last = this.keys.pop()!;
    if (last !== k) {
      this.keys[p] = last;
      this.pos.set(last, p);
    }
    this.pos.delete(k);
  }

  pick(r: number): number {
    return this.keys[Math.floor(r * this.keys.length)];
  }

  values(): readonly number[] {
    return this.keys;
  }

  clear() {
    this.keys = [];
    this.pos.clear();
  }
}
